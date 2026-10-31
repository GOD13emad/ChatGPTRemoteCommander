import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseHybridCapability,hybridCandidates} from '../src/hybrid-capability-engine.mjs';

const base={domain:'workflow',capabilities:{commanderWorkflowReady:true},
 context:{localJournalHealthy:true}};
const fleet={...base,preference:'hatchet',
 capabilities:{commanderWorkflowReady:true,coordinatorReachable:true,fleetPolicyVerified:true,
 fleetProviders:{hatchet:{healthy:true,configured:true}}},
 grants:{fleetDispatch:true},
 context:{localJournalHealthy:true,requiresFleet:true,chatAuthenticated:true,rootLeaseVerified:true,effectClass:'FILE_READ'}};
test('native durable Commander remains default and owns local effects',()=>{
 const r=chooseHybridCapability(base);
 assert.equal(r.provider,'commander-durable-r2');assert.equal(r.status,'READY');
 assert.equal(r.authorizesExecution,false);assert.equal(r.autoElevate,false);
 assert.equal(r.localEffectLedger,'COMMANDER_DURABLE_WORKFLOWS_R2');
});
test('fleet Hatchet is coordination only after independent host policy/auth/root lease',()=>{
 const r=chooseHybridCapability(fleet);
 assert.equal(r.provider,'hatchet');assert.equal(r.status,'READY');
 assert.equal(r.localWorker,'commander-durable-r2');assert.equal(r.remoteEffectReplay,false);
 assert.equal(r.ownerAuthorizationDelegated,false);assert.equal(r.authorizesExecution,false);
});
test('fleet refuses missing auth, root lease, policy, health or fleet grant',()=>{
 const cases=[
 {...fleet,grants:{}},
 {...fleet,context:{...fleet.context,rootLeaseVerified:false}},
 {...fleet,context:{...fleet.context,chatAuthenticated:false}},
 {...fleet,capabilities:{...fleet.capabilities,coordinatorReachable:false}},
 {...fleet,capabilities:{...fleet.capabilities,fleetPolicyVerified:false}},
 {...fleet,capabilities:{...fleet.capabilities,fleetProviders:{hatchet:{healthy:false,configured:true}}}}
 ];
 for(const input of cases)assert.equal(chooseHybridCapability(input).status,'BLOCKED');
});
test('unknown external effects are not replayed by any engine',()=>{
 for(const domain of Object.keys(hybridCandidates)){
  const x=chooseHybridCapability({domain,context:{externalEffectStatus:'UNKNOWN'}});
  assert.equal(x.status,'BLOCKED');assert.equal(x.unknownEffectPolicy,'RECONCILE_NO_REPLAY');
 }
});
test('interactive GUI/browser mutations cannot be delegated to fleet',()=>{
 for(const effectClass of ['GUI_MUTATION','BROWSER_PROFILE_MUTATION'])
  assert.equal(chooseHybridCapability({...fleet,context:{...fleet.context,effectClass}}).status,'BLOCKED');
});
test('unverified provider or missing local journal fails closed',()=>{
 assert.equal(chooseHybridCapability({...fleet,preference:'temporal'}).status,'BLOCKED');
 assert.equal(chooseHybridCapability({...fleet,context:{...fleet.context,localJournalHealthy:false}}).status,'BLOCKED');
});
test('local AI provider must be installed, healthy, separately consented and licensed',()=>{
 for(const provider of ['colibri','llama.cpp','ollama','vllm']){
  const x={domain:'model',preference:provider,capabilities:{models:{[provider]:{installed:true,healthy:true}}},
   grants:{localModel:true},context:{modelLicenseApproved:true}};
  const r=chooseHybridCapability(x);
  assert.equal(r.provider,provider);assert.equal(r.downloadsAllowed,false);
  assert.equal(chooseHybridCapability({...x,grants:{}}).status,'BLOCKED');
  assert.equal(chooseHybridCapability({...x,capabilities:{models:{}}}).status,'BLOCKED');
 }
});
test('desktop and browser keep native owner-authorization boundary',()=>{
 for(const domain of ['desktop','browser']){
  const r=chooseHybridCapability({domain});
  assert.equal(r.status,'DELEGATE');assert.equal(r.provider,'agentos-provider-router');
  assert.equal(r.remoteGuiInput,false);
 }
});
test('external PDP cannot override Commander native denies',()=>{
 const x=chooseHybridCapability({domain:'policy',preference:'cedar',capabilities:{policyEngines:{cedar:{healthy:true}}}});
 assert.equal(x.commanderDenyOverrides,true);
 assert.equal(chooseHybridCapability({domain:'policy',preference:'opa'}).status,'BLOCKED');
});
test('telemetry defaults to local; export requires consent, health and redaction',()=>{
 assert.equal(chooseHybridCapability({domain:'telemetry'}).provider,'commander-receipts');
 assert.equal(chooseHybridCapability({domain:'telemetry',preference:'opentelemetry',
  grants:{exportTelemetry:true},capabilities:{otelReady:true}}).status,'BLOCKED');
 const x=chooseHybridCapability({domain:'telemetry',preference:'opentelemetry',
  grants:{exportTelemetry:true},capabilities:{otelReady:true},context:{redactionVerified:true}});
 assert.equal(x.secretsInBaggage,false);
});
test('native UI requires installed app and owner grant',()=>{
 assert.equal(chooseHybridCapability({domain:'control-center',preference:'tauri-v2'}).status,'BLOCKED');
 const x=chooseHybridCapability({domain:'control-center',preference:'tauri-v2',
  capabilities:{tauriInstalled:true},grants:{nativeUI:true}});
 assert.equal(x.status,'READY');assert.equal(x.servicePrivileges,false);
});
test('invalid domains, shapes, preferences fail closed',()=>{
 for(const x of [{},{domain:'x'},{domain:'workflow',capabilities:[]},{domain:'model',context:null},
  {domain:'model',preference:'magic_shell'},{domain:'workflow',preference:'???'}])
  assert.throws(()=>chooseHybridCapability(x),/HYBRID_INPUT_INVALID/);
});
