import test from 'node:test';
import assert from 'node:assert/strict';
import {planV2OwnerControlMethods,classifyV2WorkspaceControlOutcome} from '../src/v2-control-method-plan.mjs';
import {planV2OwnerControlMethods as exported} from '../src/v2-owner-session-reuse.mjs';

const base={platform:'windows',target:'browser',browser:'chrome',browserMajor:156,
 ownerSeatAttested:true,exactWindowAttested:true,uiaAvailable:true};
test('owner session reuse exports the exact inert method selector',()=>{
 assert.equal(exported,planV2OwnerControlMethods);
});
test('Chrome 144+ explicitly approved autoConnect is only a handshake candidate',()=>{
 const x=exported({...base,browserDebuggingEnabled:true,browserConsentVerified:true});
 assert.equal(x.selected.method,'CHROME_DEVTOOLS_MCP_AUTOCONNECT');
 assert.equal(x.selected.state,'NATIVE_HANDSHAKE_REQUIRED');
 assert.equal(x.liveChatIdentityVerified,false);
 assert.equal(x.toolExecutionAuthorized,false);
 assert.equal(x.credentialAccessed,false);
 assert.equal(Object.isFrozen(x.methods),true);
});
test('browser debugging and consent are separate and must never be inferred from version',()=>{
 const a=exported(base);
 assert.equal(a.methods[0].state,'BROWSER_DEBUGGING_OWNER_ENABLE_REQUIRED');
 const b=exported({...base,browserDebuggingEnabled:true});
 assert.equal(b.methods[0].state,'BROWSER_NATIVE_PROMPT_REQUIRED');
 assert.equal(b.selected.method,'WINDOWS_UIA_OBSERVE');
});
test('Chrome autoConnect is not generalized to Brave Edge Chromium or old Chrome',()=>{
 for(const browser of ['brave','edge','chromium','firefox']){
  const a=exported({...base,browser,browserDebuggingEnabled:true,browserConsentVerified:true});
  assert.equal(a.methods.some(m=>m.method==='CHROME_DEVTOOLS_MCP_AUTOCONNECT'),false);
 }
 for(const major of [100,136,143]){
  assert.equal(exported({...base,browserMajor:major}).methods.some(
   m=>m.method==='CHROME_DEVTOOLS_MCP_AUTOCONNECT'),false);
 }
});
test('installed native extension requires verified host and separate runtime handshake',()=>{
 const x=exported({...base,webExtensionInstalled:true,nativeHostVerified:false});
 assert.equal(x.methods[0].state,'NATIVE_HOST_VERIFICATION_REQUIRED');
 const y=exported({...base,webExtensionInstalled:true,nativeHostVerified:true,
  browserDebuggingEnabled:true,browserConsentVerified:true});
 assert.equal(y.selected.method,'WEBEXTENSION_NATIVE_MESSAGING');
 assert.equal(y.selected.state,'NATIVE_HANDSHAKE_REQUIRED');
 assert.equal(y.toolExecutionAuthorized,false);
});
test('same native owner and exact window are hard prerequisites',()=>{
 for(const changed of [{ownerSeatAttested:false},{exactWindowAttested:false}]){
  const x=exported({...base,...changed,browserDebuggingEnabled:true,browserConsentVerified:true});
  assert.equal(x.status,'NATIVE_OWNER_EVIDENCE_REQUIRED');
  assert.equal(x.selected,null);
  assert.equal(x.methods.length,0);
 }
});
test('Windows native UIA and winapp are distinct non-authorizing candidates',()=>{
 const x=exported({platform:'windows',target:'app',ownerSeatAttested:true,
  exactWindowAttested:true,uiaAvailable:true,winappCliAvailable:true});
 assert.deepEqual(x.methods.map(m=>m.method),['WINDOWS_UIA_OBSERVE','WINAPP_UIA_OPTIONAL']);
 assert.equal(x.selected.state,'READ_ONLY_CANDIDATE');
 assert.equal(x.toolExecutionAuthorized,false);
});
test('GNOME AT-SPI and XDG Portal never imply current-task consent',()=>{
 const b={platform:'linux',target:'app',ownerSeatAttested:true,exactWindowAttested:true,
  atSpiAvailable:true,portalAvailable:true};
 const a=exported(b);
 assert.deepEqual(a.methods.map(m=>m.method),['LINUX_AT_SPI_OBSERVE','LINUX_XDG_PORTAL_INPUT']);
 assert.equal(a.methods[1].state,'OS_NATIVE_CONSENT_REQUIRED');
 const c=exported({...b,portalConsentVerified:true});
 assert.equal(c.methods[1].state,'PORTAL_SESSION_VERIFICATION_REQUIRED');
 assert.equal(c.toolExecutionAuthorized,false);
});
test('invalid shape, secret extra fields and forged types fail closed',()=>{
 for(const changed of [
  {browserMajor:'156'},{browserMajor:0},{browserMajor:900},
  {browser:'safari'},{platform:'macos'},
  {cookie:'private'},{browserConsentVerified:'true'},
  {ownerSeatAttested:1},{exactWindowAttested:null}
 ])assert.throws(()=>exported({...base,...changed}),{code:'V2_CONTROL_PLAN_INPUT_INVALID'});
 assert.throws(()=>exported(Object.create(null)),{code:'V2_CONTROL_PLAN_INPUT_INVALID'});
 assert.throws(()=>exported(null),{code:'V2_CONTROL_PLAN_INPUT_INVALID'});
});
test('nothing detected yields a non-authorized empty plan',()=>{
 const x=exported({platform:'linux',target:'browser',browser:'firefox',
  ownerSeatAttested:true,exactWindowAttested:true});
 assert.equal(x.status,'NO_VERIFIED_CONTROL_SURFACE');
 assert.equal(x.methods.length,0);
 assert.equal(x.nextGate,'OWNER_BACKEND_DISCOVERY_REQUIRED');
});

test('V1 target-only uncertain effect policy is reused without global GUI lock',()=>{
 const p=planV2OwnerControlMethods({platform:'windows',target:'browser',browser:'brave',
   ownerSeatAttested:true,exactWindowAttested:true,uiaAvailable:true});
 assert.deepEqual(p.onUncertainEffect,{
   status:'RECONCILE_TARGET',scope:'TARGET_ONLY',retry:'OBSERVE_AND_DECIDE_NO_BLIND_REPLAY',
   globalInputLock:false,toolExecutionAuthorized:false
 });
 assert.equal(Object.isFrozen(p.onUncertainEffect),true);
 const blocked=classifyV2WorkspaceControlOutcome({refusedCode:'background_unavailable'});
 assert.equal(blocked.status,'ROUTE_ALTERNATIVE_REQUIRED');
 assert.equal(blocked.scope,'TARGET_ONLY');
 assert.equal(blocked.retry,'DO_NOT_ESCALATE_TO_FOREGROUND_AUTOMATICALLY');
 assert.equal(blocked.globalInputLock,false);
});
test('V1 confirmed behavior does not imply new V2 chat authorization',()=>{
 const settled=classifyV2WorkspaceControlOutcome({effect:'confirmed',hasFreshObservation:true});
 assert.equal(settled.status,'CONFIRMED');
 assert.equal(settled.toolExecutionAuthorized,false);
 const stale=classifyV2WorkspaceControlOutcome({effect:'confirmed',hasFreshObservation:false});
 assert.equal(stale.status,'RECONCILE_TARGET');
 for(const value of [{effect:'silently_replay'},{hasFreshObservation:'true'},{refusedCode:'allow_global_input'}])
  assert.throws(()=>classifyV2WorkspaceControlOutcome(value),{code:'V2_WORKSPACE_OUTCOME_INVALID'});
});
