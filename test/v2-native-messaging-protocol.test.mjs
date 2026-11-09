import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createV2NativeMessageDecoder,encodeV2NativeMessage,
 createV2ChromeNativeHostManifest,respondV2NativeOwnerPreflight}
 from '../src/v2-native-messaging-protocol.mjs';

const origin='chrome-extension://'+'a'.repeat(32)+'/';
const different='chrome-extension://'+'b'.repeat(32)+'/';
const hello={schema:1,type:'owner_preflight',requestId:'bridge-123'};
const parser=()=>createV2NativeMessageDecoder();
const code=e=>e?.code??e?.message;

test('Chrome Native Messaging frames survive fragmented UTF8 data and multiple records',()=>{
 const one=encodeV2NativeMessage({...hello,requestId:'r-1'});
 const two=encodeV2NativeMessage({...hello,requestId:'r-2'});
 const combined=Buffer.concat([one,two]);
 const d=parser();
 assert.deepEqual(d.push(combined.subarray(0,2)),[]);
 assert.deepEqual(d.push(combined.subarray(2,7)),[]);
 assert.deepEqual(d.push(combined.subarray(7)),[{...hello,requestId:'r-1'},{...hello,requestId:'r-2'}]);
 assert.equal(d.finish(),true);
 assert.throws(()=>d.push(one),{code:'V2_NATIVE_DECODER_CLOSED'});
});
test('malformed, oversized, truncated and nonobject incoming messages fail closed',()=>{
 const prefix=Buffer.alloc(4);prefix.writeUInt32LE(70000,0);
 assert.throws(()=>parser().push(prefix),{code:'V2_NATIVE_FRAME_LIMIT'});
 assert.throws(()=>parser().push(Buffer.concat([Buffer.from([0,0,0,0]),Buffer.from('{}')])),
  {code:'V2_NATIVE_FRAME_LIMIT'});
 const broken=Buffer.concat([Buffer.from([2,0,0,0]),Buffer.from('{{')]);
 assert.throws(()=>parser().push(broken),{code:'V2_NATIVE_JSON_INVALID'});
 const nonobject=Buffer.concat([Buffer.from([2,0,0,0]),Buffer.from('42')]);
 assert.throws(()=>parser().push(nonobject),{code:'V2_NATIVE_MESSAGE_INVALID'});
 const part=parser();part.push(encodeV2NativeMessage(hello).subarray(0,8));
 assert.throws(()=>part.finish(),{code:'V2_NATIVE_TRUNCATED_FRAME'});
 assert.throws(()=>parser().push(new Uint8Array(5)),{code:'V2_NATIVE_FRAME_INVALID'});
});
test('explicit native extension id and absolute host path have no wildcard default',()=>{
 const a=createV2ChromeNativeHostManifest({
  extensionOrigin:origin,launcherPath:path.resolve('candidate-native-host.exe')
 });
 assert.equal(a.type,'stdio');
 assert.deepEqual(a.allowed_origins,[origin]);
 assert.equal(Object.isFrozen(a),true);
 for(const invalid of ['chrome-extension://*/','https://example.test/','chrome-extension://'+ 'A'.repeat(32)+'/'])
  assert.throws(()=>createV2ChromeNativeHostManifest({
    extensionOrigin:invalid,launcherPath:path.resolve('host.exe')
  }),{code:'V2_NATIVE_ORIGIN_INVALID'});
 assert.throws(()=>createV2ChromeNativeHostManifest({
  extensionOrigin:origin,launcherPath:'relative/host.exe'
 }),{code:'V2_NATIVE_LAUNCHER_INVALID'});
});
test('browser native origin alone is never treated as OAuth/chat authorization',()=>{
 const v=respondV2NativeOwnerPreflight(hello,{
  browserOrigin:origin,registeredOrigin:origin
 });
 assert.equal(v.status,'OWNER_BINDING_AND_CHAT_CONSENT_REQUIRED');
 for(const field of ['ownerSessionAttested','chatIdentityAuthenticated','chatAuthorized',
  'toolsAuthorized','canReadCookies','canSendInput','boundToV2Coordinator'])
  assert.equal(v[field],false,field);
 assert.equal(Object.isFrozen(v),true);
});
test('cross-extension request, unknown method, extra fields or fabricated grant are denied',()=>{
 assert.throws(()=>respondV2NativeOwnerPreflight(hello,{
   browserOrigin:different,registeredOrigin:origin
 }),{code:'V2_NATIVE_ORIGIN_DENIED'});
 for(const x of [
  {...hello,type:'execute_tool'},{...hello,allow:true},
  {...hello,chatAuthorized:true},{...hello,requestId:''},
  {...hello,requestId:'foo'.repeat(50)},
  {...hello,schema:2}
 ])assert.throws(()=>respondV2NativeOwnerPreflight(x,{
   browserOrigin:origin,registeredOrigin:origin
 }),{code:'V2_NATIVE_REQUEST_DENIED'});
});
function invokeHost(message,{actual=origin,pinned=origin}={}){
 return new Promise((resolve,reject)=>{
  const host=fileURLToPath(new URL('../tools/v2-native-messaging-host.mjs',import.meta.url));
  const cp=spawn(process.execPath,[host,actual],{stdio:['pipe','pipe','pipe'],
   env:{...process.env,RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN:pinned}});
  const chunks=[],errors=[];
  cp.stdout.on('data',x=>chunks.push(x));cp.stderr.on('data',x=>errors.push(x));
  cp.on('error',reject);
  cp.on('close',exitCode=>resolve({exitCode,stdout:Buffer.concat(chunks),
    stderr:Buffer.concat(errors).toString('utf8')}));
  cp.stdin.end(message);
 });
}
test('real stdio host returns framed owner-only preflight without browser action',async()=>{
 const out=await invokeHost(encodeV2NativeMessage(hello));
 assert.equal(out.exitCode,0);
 assert.equal(out.stderr,'');
 const d=parser();const frames=d.push(out.stdout);
 assert.equal(d.finish(),true);
 assert.equal(frames.length,1);
 assert.equal(frames[0].requestId,hello.requestId);
 assert.equal(frames[0].toolsAuthorized,false);
 assert.equal(frames[0].chatAuthorized,false);
 assert.equal(frames[0].canReadCookies,false);
});
test('host refuses wrong browser origin or privileged method with no stdout',async()=>{
 const wrong=await invokeHost(encodeV2NativeMessage(hello),{actual:different});
 assert.notEqual(wrong.exitCode,0);
 assert.equal(wrong.stdout.length,0);
 assert.match(wrong.stderr,/V2_NATIVE_HOST_DENIED/);
 const call=await invokeHost(encodeV2NativeMessage({...hello,type:'execute_tool'}));
 assert.notEqual(call.exitCode,0);
 assert.equal(call.stdout.length,0);
 assert.match(call.stderr,/V2_NATIVE_HOST_DENIED/);
});
test('host refuses invalid native framing without revealing input contents',async()=>{
 const malformed=await invokeHost(Buffer.from([255,255,255,255]));
 assert.notEqual(malformed.exitCode,0);
 assert.equal(malformed.stdout.length,0);
 assert.match(malformed.stderr,/^V2_NATIVE_HOST_DENIED\r?\n$/);
});
