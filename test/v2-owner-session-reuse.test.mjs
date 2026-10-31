import test from 'node:test';
import assert from 'node:assert/strict';
import {openV2OwnerApplication} from '../src/v2-owner-session-reuse.mjs';
const route=(chat='chat-a')=>({
 hostId:'host',principalId:'owner',profileId:'personal',
 conversationId:chat,operationId:'open-a',
 target:{kind:'browser-target',id:'brave'}
});
function fixture(){
 const calls=[],rows=[],w={appId:'brave',hostId:'host',principalId:'owner',seatId:'seat-1',
  windowId:'win-1',processStartId:'start-1',pid:44,present:true,
  backgroundReady:true,ownerSessionReady:true};
 let nativeSeat='seat-1',consent=true,attachConsent=true,verify=true,
  windowChanged=false,attachEffect=false;
 rows.push(w);
 const services={
  sessions:{resolveNativeRoute:async()=>route()},
  observedNativeSeat:async()=>nativeSeat,
  listOwnerWindows:async()=>rows.map(x=>({...x,processStartId:windowChanged?'changed':x.processStartId})),
  authorizeAttach:async()=>{calls.push('consentAttach');return attachConsent;},
  attachExisting:async()=>{calls.push('attach');attachEffect=true;return {ok:true,attachmentId:'native-1',foregroundChanged:false,cookie:'DO_NOT_EXPORT'};},
  verifyAttachment:async()=>verify,
  authorizeLaunch:async()=>{calls.push('consentLaunch');return consent;},
  launchRegisteredApp:async()=>{calls.push('launch');rows.push(w);return {ok:true,windowId:w.windowId,pid:w.pid,backgroundSafe:true};}
 };
 const open=opts=>openV2OwnerApplication({route:route(),sessionHandle:'chat-a',appId:'brave',services,...opts});
 return {services,calls,rows,w,open,
  clear:()=>{rows.length=0;},seat:x=>{nativeSeat=x;},consent:x=>{consent=x;},
  attachConsent:x=>{attachConsent=x;},windowChanged:x=>{windowChanged=x;},
  verify:x=>{verify=x;},attached:()=>attachEffect
 };
}
test('attaches exact already logged-in browser in background, never copies secrets',async()=>{
 const f=fixture(),res=await f.open();
 assert.equal(res.status,'NATIVE_SESSION_BOUND');assert.equal(res.existingSessionReused,true);
 assert.equal(res.mode,'background');assert.equal(res.launched,false);
 assert.equal(res.credentialExported,false);assert.equal(res.passwordStoreAccessed,false);
 assert.equal(res.foregroundChanged,false);assert.equal(res.authenticatedLoginVerified,false);
 assert.equal(JSON.stringify(res).includes('cookie'),false);
 assert.deepEqual(f.calls,['consentAttach','attach']);
});
test('launch of registered app requires independent owner approval and fresh native identity',async()=>{
 const f=fixture();f.clear();
 const res=await f.open({openIfMissing:true});
 assert.equal(res.launched,true);assert.equal(res.existingSessionReused,false);
 assert.deepEqual(f.calls,['consentLaunch','launch','consentAttach','attach']);
});
test('without explicit open request, absent app never launches',async()=>{
 const f=fixture();f.clear();
 await assert.rejects(f.open(),{code:'V2_OWNER_APP_NOT_RUNNING'});
 assert.deepEqual(f.calls,[]);
});
test('blocked browser-native consent cannot be bypassed by saved password claims',async()=>{
 const f=fixture();f.attachConsent(false);
 await assert.rejects(f.open(),{code:'V2_OWNER_APP_ATTACH_CONSENT_REQUIRED'});
 assert.equal(f.attached(),false);
});
test('background route refuses missing native backend, even if window is visible',async()=>{
 const f=fixture();f.w.backgroundReady=false;
 await assert.rejects(f.open(),{code:'V2_OWNER_APP_BACKGROUND_UNAVAILABLE'});
 assert.deepEqual(f.calls,[]);
 const readOnly=await f.open({mode:'observe'});
 assert.equal(readOnly.mode,'observe');
});
test('ambiguous windows cannot arbitrarily select a logged-in session',async()=>{
 const f=fixture();f.rows.push({...f.w,windowId:'win-2'});
 await assert.rejects(f.open(),{code:'V2_OWNER_APP_WINDOW_AMBIGUOUS'});
 const result=await f.open({windowId:'win-2'});
 assert.equal(result.windowId,'win-2');
});
test('native window and seat change during consent block attach',async()=>{
 const f=fixture();f.services.authorizeAttach=async()=>{f.windowChanged(true);return true;};
 await assert.rejects(f.open(),{code:'V2_OWNER_APP_CHANGED_DURING_CONSENT'});
 assert.equal(f.attached(),false);
 const g=fixture();g.services.authorizeAttach=async()=>{g.seat('seat-2');return true;};
 await assert.rejects(g.open(),{code:'V2_OWNER_APP_CHANGED_DURING_CONSENT'});
});
test('chat route cannot be borrowed from another conversation',async()=>{
 const f=fixture();f.services.sessions.resolveNativeRoute=async()=>route('chat-b');
 await assert.rejects(f.open(),{code:'V2_OWNER_APP_SESSION_ROUTE_CHANGED'});
 assert.equal(f.attached(),false);
});
test('unverified launch and uncertain native attachment never imply success',async()=>{
 const f=fixture();f.clear();
 f.services.launchRegisteredApp=async()=>({ok:false});
 await assert.rejects(f.open({openIfMissing:true}),{code:'V2_OWNER_APP_LAUNCH_UNCERTAIN'});
 const g=fixture();g.verify(false);
 await assert.rejects(g.open(),{code:'V2_OWNER_APP_ATTACH_UNCERTAIN'});
});
test('reject arbitrary executable path, invalid target, unknown mode and service hooks',async()=>{
 const f=fixture();
 for(const opts of [{appId:'C:\\Windows\\System32\\cmd.exe'}, {mode:'takeover'},
  {windowId:'../other'}, {openIfMissing:'yes'},
  {route:{...route(),target:{kind:'host-shell',id:'shell'}}},
  {appId:'firefox'}])
  await assert.rejects(f.open(opts),{code:'V2_OWNER_APP_SELECTION_INVALID'});
 await assert.rejects(f.open({services:{}}),{code:'V2_OWNER_APP_TRUSTED_BROKER_REQUIRED'});
 assert.equal(f.attached(),false);
});
