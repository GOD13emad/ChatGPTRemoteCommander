import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const dir=fileURLToPath(new URL('../assets/v2-owner-extension/',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
const code=fs.readFileSync(path.join(dir,'service-worker.js'),'utf8');
function harness(answer,withError=false){
 const calls=[],events={},badges=[];
 const chrome={
  action:{onClicked:{addListener:fn=>{events.click=fn;}},
   setBadgeText:async x=>{badges.push(x.text);}},
  runtime:{lastError:withError?{message:'DENIED'}:null,
   sendNativeMessage:async(name,message)=>{calls.push({name,message});
    return typeof answer==='function'?answer(message):answer;}}
 };
 vm.runInNewContext(code,{chrome,crypto:{randomUUID:()=> 'b4a212f2-f93f-4fb7-b8e7-00cc11bb22dd'}});
 return {calls,events,badges,chrome};
}
test('extension is explicitly user-initiated and has only nativeMessaging permission',()=>{
 assert.equal(manifest.manifest_version,3);
 assert.deepEqual(manifest.permissions,['nativeMessaging']);
 for(const key of ['host_permissions','content_scripts','externally_connectable',
  'web_accessible_resources','optional_host_permissions'])
  assert.equal(Object.hasOwn(manifest,key),false,key);
 assert.equal(manifest.background.service_worker,'service-worker.js');
});
test('extension has no unsolicited browser access or host invocation during load',()=>{
 const h=harness(null);
 assert.equal(h.calls.length,0);
 assert.equal(typeof h.events.click,'function');
 assert.equal(h.badges.length,0);
});
test('user click sends only the bounded owner preflight, never tools or secrets',async()=>{
 const h=harness(msg=>({schema:1,requestId:msg.requestId,
  type:'owner_preflight_result',status:'OWNER_BINDING_AND_CHAT_CONSENT_REQUIRED',
  toolsAuthorized:false,chatAuthorized:false}));
 await h.events.click();
 assert.deepEqual(h.calls.map(x=>x.name),['com.chatgpt_remote_commander.v2']);
 assert.equal(h.calls[0].message.schema,1);
 assert.equal(h.calls[0].message.type,'owner_preflight');
 assert.equal(typeof h.calls[0].message.requestId,'string');
 assert.equal(Object.keys(h.calls[0].message).sort().join(','),'requestId,schema,type');
 assert.deepEqual(h.badges,['PAIR']);
});
test('fake success or native denial does not enable controls or report connected',async()=>{
 for(const answer of [
  {schema:1,requestId:'unrelated',type:'owner_preflight_result',
   status:'OWNER_BINDING_AND_CHAT_CONSENT_REQUIRED',toolsAuthorized:false,chatAuthorized:false},
  {schema:1,requestId:'owner-probe-b4a212f2-f93f-4fb7-b8e7-00cc11bb22dd',
   type:'owner_preflight_result',status:'READY',toolsAuthorized:true,chatAuthorized:true},
  null
 ]){
  const h=harness(answer);
  await h.events.click();
  assert.deepEqual(h.badges,['OFF']);
 }
 const err=harness(null,true);await err.events.click();
 assert.deepEqual(err.badges,['OFF']);
});
