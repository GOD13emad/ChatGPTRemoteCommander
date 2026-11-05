import test from 'node:test';
import assert from 'node:assert/strict';
import {checkV2ReadOnlyWorkspace,verify} from '../tools/v2-packaged-workspace-live-smoke.mjs';

const base=()=>({
 unauth:403,invalid:403,allowed:200,status:200,action:405,
 runtime:{
  state:'LIVE_READ_ONLY',source:'V1_LOCAL_CORE',
  transport:'LOCAL_LOOPBACK',identityBasis:'LOCAL_PROFILE_LABEL_NOT_AUTHENTICATION',
  selectedProfile:'default',canExecute:false,
  core:{version:'0.11.0-dev.23'},toolCount:116,
  gui:{available:true},browser:{available:true,active:false}
 },
 control:{auth:'NOT_ENROLLED',mode:'READ_ONLY_GUI_PREVIEW',
  workflow:'NOT_CONNECTED',gui:'NOT_CONNECTED',browser:'NOT_CONNECTED'}
});
test('tokenized owner-local packaged Control Center accepts actual GUI/browser V1 read status',()=>{
 const r=checkV2ReadOnlyWorkspace(base());
 assert.equal(r.gate,'COMMANDER_V2_PACKAGED_WORKSPACE_V1_LIVE_READONLY_QA_PASS');
 assert.equal(r.toolCount,116);
 assert.equal(r.chatAuthenticated,false);
 assert.equal(r.canExecute,false);
 assert.equal(r.liveV1Touched,false);
 assert.equal(r.installed,false);
});
test('bounded Windows read-only probes may legitimately report unrelated optional latency',()=>{
 const x=base();x.runtime.state='DEGRADED_READ_ONLY';
 const r=checkV2ReadOnlyWorkspace(x);
 assert.equal(r.backendState,'DEGRADED_READ_ONLY');
 assert.equal(r.browserReadAvailable,true);
});
test('never claim acceptance without verified live GUI, browser or catalog',()=>{
 for(const edit of [
  x=>{x.runtime.gui=null;},x=>{x.runtime.browser=null;},
  x=>{x.runtime.toolCount=null;},x=>{x.runtime.core=null;},
  x=>{x.runtime.selectedProfile='other';},
  x=>{x.runtime.state='PROFILE_UNVERIFIED';}
 ]){
  const x=base();edit(x);
  assert.throws(()=>checkV2ReadOnlyWorkspace(x),/CMDV2_WORKSPACE_NATIVE_QA_LIVE_READ_ONLY_OR_IDENTITY_UNVERIFIED/);
 }
});
test('reject missing/incorrect token, method guard and false authority assertions',()=>{
 for(const edit of [
  x=>{x.unauth=200;},x=>{x.invalid=200;},x=>{x.action=200;},
  x=>{x.allowed=403;},x=>{x.status=500;}
 ]){
  const x=base();edit(x);
  assert.throws(()=>checkV2ReadOnlyWorkspace(x),/CMDV2_WORKSPACE_NATIVE_QA_HTTP_AUTH_OR_METHOD_GUARD_FAILED/);
 }
 for(const edit of [
  x=>{x.runtime.canExecute=true;},x=>{x.control.auth='VERIFIED';},
  x=>{x.control.mode='FULL_POWER';},x=>{x.control.browser='CONNECTED';}
 ]){
  const x=base();edit(x);
  assert.throws(()=>checkV2ReadOnlyWorkspace(x),/CMDV2_WORKSPACE_NATIVE_QA_LIVE_READ_ONLY_OR_IDENTITY_UNVERIFIED/);
 }
});
test('reject mode injection before reading a packaged workspace',async()=>{
 await assert.rejects(verify({candidate:'somewhere'}),/CMDV2_WORKSPACE_NATIVE_QA_MODE_INVALID/);
});