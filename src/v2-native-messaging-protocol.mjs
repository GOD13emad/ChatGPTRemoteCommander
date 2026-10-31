// V2 R5: fail-closed Chrome/Brave native messaging transport (no browser attach).
// This file neither accesses profiles nor connects to the V2 Coordinator.
import os from 'node:os';
import path from 'node:path';

const ORDER=os.endianness();
const READ=ORDER==='LE'?'readUInt32LE':'readUInt32BE';
const WRITE=ORDER==='LE'?'writeUInt32LE':'writeUInt32BE';
const ORIGIN=/^chrome-extension:\/\/[a-p]{32}\/$/;
const REQUEST=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const MAX_INPUT=65536; // deliberately lower than browser's 64MiB native-host maximum
const MAX_OUTPUT=1024*1024; // Chrome/Brave native host response maximum
function fail(code){throw Object.assign(new Error(code),{code});}
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype;}
export function validateV2NativeExtensionOrigin(origin){
 if(typeof origin!=='string'||!ORIGIN.test(origin))
  fail('V2_NATIVE_ORIGIN_INVALID');
 return origin;
}
export function createV2ChromeNativeHostManifest({extensionOrigin,launcherPath}={}){
 validateV2NativeExtensionOrigin(extensionOrigin);
 if(typeof launcherPath!=='string'||!path.isAbsolute(launcherPath)||
   launcherPath.includes('\u0000')||!launcherPath.trim())
  fail('V2_NATIVE_LAUNCHER_INVALID');
 // This is a source-only manifest proposal, not an OS registration.
 return Object.freeze({
  name:'com.chatgpt_remote_commander.v2',
  description:'Commander V2 owner-scoped messaging candidate',
  path:launcherPath,type:'stdio',allowed_origins:Object.freeze([extensionOrigin])
 });
}
export function encodeV2NativeMessage(message){
 if(!object(message))fail('V2_NATIVE_MESSAGE_INVALID');
 let payload;
 try{payload=Buffer.from(JSON.stringify(message),'utf8');}
 catch{fail('V2_NATIVE_MESSAGE_INVALID');}
 if(payload.length<2||payload.length>MAX_OUTPUT)fail('V2_NATIVE_OUTPUT_LIMIT');
 const out=Buffer.allocUnsafe(4+payload.length);
 out[WRITE](payload.length,0);
 payload.copy(out,4);
 return out;
}
export function createV2NativeMessageDecoder({maxBytes=MAX_INPUT,maxFrames=32}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<16||maxBytes>MAX_INPUT||
    !Number.isSafeInteger(maxFrames)||maxFrames<1||maxFrames>128)
   fail('V2_NATIVE_DECODER_CONFIG_INVALID');
 let buffered=Buffer.alloc(0),closed=false;
 function push(chunk){
  if(closed)fail('V2_NATIVE_DECODER_CLOSED');
  if(!Buffer.isBuffer(chunk))fail('V2_NATIVE_FRAME_INVALID');
  if(chunk.length>maxBytes+4||buffered.length+chunk.length>maxBytes+4)
   fail('V2_NATIVE_FRAME_LIMIT');
  buffered=Buffer.concat([buffered,chunk]);
  const frames=[];
  while(buffered.length>=4){
   const len=buffered[READ](0);
   if(len<2||len>maxBytes)fail('V2_NATIVE_FRAME_LIMIT');
   if(buffered.length<4+len)break;
   let data;
   try{data=JSON.parse(buffered.subarray(4,4+len).toString('utf8'));}
   catch{fail('V2_NATIVE_JSON_INVALID');}
   if(!object(data))fail('V2_NATIVE_MESSAGE_INVALID');
   frames.push(data);
   if(frames.length>maxFrames)fail('V2_NATIVE_FRAME_COUNT_LIMIT');
   buffered=buffered.subarray(4+len);
  }
  return frames;
 }
 return Object.freeze({push,finish(){
   closed=true;
   if(buffered.length!==0)fail('V2_NATIVE_TRUNCATED_FRAME');
   return true;
 }});
}
/** Called ONLY by an exact browser-registered native host launcher.
 * Browser origin is a hint, never a caller/ChatGPT authorization proof.
 * No request can trigger browser input, command execution, or credential access.
 */
export function respondV2NativeOwnerPreflight(message,{browserOrigin,registeredOrigin}={}){
 validateV2NativeExtensionOrigin(browserOrigin);
 validateV2NativeExtensionOrigin(registeredOrigin);
 if(browserOrigin!==registeredOrigin)fail('V2_NATIVE_ORIGIN_DENIED');
 if(!object(message)||Object.keys(message).sort().join(',')!=='requestId,schema,type'||
    message.schema!==1||message.type!=='owner_preflight'||
    typeof message.requestId!=='string'||!REQUEST.test(message.requestId))
   fail('V2_NATIVE_REQUEST_DENIED');
 return Object.freeze({schema:1,requestId:message.requestId,type:'owner_preflight_result',
  status:'OWNER_BINDING_AND_CHAT_CONSENT_REQUIRED',
  browserNativeOriginValidated:true,ownerSessionAttested:false,
  chatIdentityAuthenticated:false,chatAuthorized:false,
  toolsAuthorized:false,canReadCookies:false,canSendInput:false,
  boundToV2Coordinator:false});
}
