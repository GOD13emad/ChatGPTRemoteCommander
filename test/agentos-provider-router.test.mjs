import test from 'node:test';
import assert from 'node:assert/strict';
import {agentosProviders,chooseAgentOSProvider,createHybridFleetBridge} from '../src/agentos-provider-router.mjs';
const base={platform:'win32',ownerSession:true,target:'existing-app',capabilities:{windowsUIA:true}};
test('native UIA chosen ahead of CUA for exact owner Windows application',()=>{
 const r=chooseAgentOSProvider({...base,capabilities:{windowsUIA:true,cuaVerifiedOwnerTarget:true},grants:{visualFallback:true}});
 assert.equal(r.provider,'windows-uia-native');assert.equal(r.mode,'SEMANTIC_UI');assert.equal(r.autoElevate,false);
});
test('native Windows app API UFO2 outranks UIA when application-specific consent exists',()=>{
 const r=chooseAgentOSProvider({...base,application:{nativeAPI:true},grants:{nativeApplication:true},
  capabilities:{ufo2AppAgent:true,windowsUIA:true}});
 assert.equal(r.provider,'ufo2-app-native');
});
test('ungranted UFO2 app API falls back to native UIA without privilege escalation',()=>{
 const r=chooseAgentOSProvider({...base,application:{nativeAPI:true},capabilities:{ufo2AppAgent:true,windowsUIA:true}});
 assert.equal(r.provider,'windows-uia-native');assert.equal(r.autoElevate,false);
});
test('existing user session cannot be borrowed from Windows SYSTEM or other owner',()=>{
 const r=chooseAgentOSProvider({...base,ownerSession:false,capabilities:{windowsUIA:true,cuaVerifiedOwnerTarget:true},grants:{visualFallback:true}});
 assert.equal(r.code,'OWNER_SESSION_REQUIRED');assert.equal(r.status,'BLOCKED');
});
test('Linux AT-SPI chosen ahead of CUA',()=>{
 const r=chooseAgentOSProvider({platform:'linux',ownerSession:true,target:'existing-app',capabilities:{linuxATSPI:true,cuaVerifiedOwnerTarget:true},grants:{visualFallback:true}});
 assert.equal(r.provider,'linux-atspi-native');
});
test('Cua visual requires separate precise target grant and is last resort',()=>{
 const input={...base,capabilities:{cuaVerifiedOwnerTarget:true}};
 assert.equal(chooseAgentOSProvider(input).code,'SEMANTIC_PROVIDER_UNAVAILABLE');
 assert.equal(chooseAgentOSProvider({...input,grants:{visualFallback:true}}).provider,'cua-last-resort');
});
test('existing browser explicitly protects personal profile and requires browser native consent',()=>{
 const input={...base,target:'existing-browser',capabilities:{chromeDevtoolsExistingAuthorized:true}};
 assert.equal(chooseAgentOSProvider(input).code,'BROWSER_OWNER_CONSENT_REQUIRED');
 assert.equal(chooseAgentOSProvider({...input,grants:{browserProfileAttach:true}}).provider,'chrome-devtools-mcp');
 assert.equal(chooseAgentOSProvider({...input,grants:{browserProfileAttach:true},capabilities:{}}).code,'BROWSER_EXISTING_PROFILE_ROUTE_UNAVAILABLE');
});
test('Playwright has priority for authorized DOM and Commander existing fallback for owned browser',()=>{
 const input={...base,target:'new-browser',capabilities:{playwrightOwned:true,chromeDevtoolsOwned:true,commanderOwnedBrowser:true}};
 assert.equal(chooseAgentOSProvider(input).provider,'playwright-mcp');
 assert.equal(chooseAgentOSProvider({...input,capabilities:{commanderOwnedBrowser:true}}).provider,'commander-owned-browser');
});
test('Codex app-server is planner not a magic OS permission',()=>{
 const r=chooseAgentOSProvider({...base,ownerSession:false,capabilities:{codexAppServer:true,codexAuthenticated:true,windowsUIA:true}});
 assert.equal(r.planner,'codex-app-server');assert.equal(r.code,'OWNER_SESSION_REQUIRED');
});
test('Commander workflow remains the orchestrator for general projects',()=>{
 const r=chooseAgentOSProvider({...base,target:'project',capabilities:{commanderWorkflow:true,codexAppServer:true,codexAuthenticated:true}});
 assert.equal(r.provider,'commander-workflow');assert.equal(r.planner,'codex-app-server');
});
test('safety and metadata contract is stable',()=>{
 for(const x of Object.values(agentosProviders))assert.ok(x.transport&&x.kind);
 for(const target of ['existing-browser','new-browser','existing-app','new-app','project']){
  for(const platform of ['win32','linux']){
   const r=chooseAgentOSProvider({target,platform,ownerSession:true});
   assert.equal(r.autoElevate,false);assert.equal(r.credentials,'NEVER_COPY');assert.equal(r.foreground,'PRESERVE');
  }
 }
});
test('fail closed for invalid or malformed request',()=>{
 for(const x of [{target:'x',platform:'win32'},{target:'new-app',platform:'darwin'},{target:'new-app',platform:'linux',capabilities:[]}]){
  assert.throws(()=>chooseAgentOSProvider(x),/AGENTOS_INPUT_INVALID/);
 }
});

test('hybrid Fleet plan is attached only to explicit project planning and never authorizes execution',()=>{
 const basic=chooseAgentOSProvider({...base,target:'project',capabilities:{commanderWorkflow:true}});
 assert.equal(basic.hybridPlan,undefined);
 const guarded=chooseAgentOSProvider({...base,target:'project',capabilities:{
  commanderWorkflow:true,hybridPlanRequested:true,workflowJournalHealthy:true,
  requiresFleet:true,fleetProvider:'hatchet'
 },grants:{}});
 assert.equal(guarded.provider,'commander-workflow');
 assert.equal(guarded.hybridPlan.status,'BLOCKED');
 assert.equal(guarded.hybridPlan.authorizesExecution,false);
 const fleetPlan=chooseAgentOSProvider({...base,target:'project',capabilities:{
  commanderWorkflow:true,hybridPlanRequested:true,workflowJournalHealthy:true,
  requiresFleet:true,fleetProvider:'hatchet',coordinatorReachable:true,fleetPolicyVerified:true,
  rootLeaseVerified:true,fleetProviders:{hatchet:{healthy:true,configured:true}}
 },grants:{chatAuthenticated:true,fleetDispatch:true}});
 assert.equal(fleetPlan.provider,'commander-workflow');
 assert.equal(fleetPlan.hybridPlan.provider,'hatchet');
 assert.equal(fleetPlan.hybridPlan.remoteEffectReplay,false);
});

test('Fleet transport contract is exported from AgentOS router but requires durable injection',()=>{
 assert.equal(typeof createHybridFleetBridge,'function');
 assert.throws(()=>createHybridFleetBridge(),/FLEET_BRIDGE_DEPENDENCY_MISSING/);
});
