// Commander Hybrid AgentOS capability arbitration (control plane, not executor).
// No provider grants OS access, runs a process, retries an uncertain effect,
// reads credentials, or replaces Commander local durable effect receipts.
const DOMAINS=new Set(['workflow','model','desktop','browser','policy','telemetry','control-center']);
const FLEET=new Set(['hatchet','temporal','restate']);
const MODELS=new Set(['colibri','llama.cpp','ollama','vllm']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const flag=v=>v===true;
const safe=(v)=>typeof v==='string'&&v.length>0&&v.length<=128&&/^[a-zA-Z0-9_.:-]+$/.test(v);
function invalid(){throw new Error('HYBRID_INPUT_INVALID');}
function verdict(status,provider,reason,extra={}){
 return Object.freeze({
  status,provider,reason,...extra,authorizesExecution:false,autoElevate:false,
  credentialHandling:'NEVER_EXPORT',remoteGuiInput:false,
  localEffectLedger:'COMMANDER_DURABLE_WORKFLOWS_R2',
  unknownEffectPolicy:'RECONCILE_NO_REPLAY'
 });
}
export const hybridCandidates=Object.freeze({
 workflow:Object.freeze(['commander-durable-r2','hatchet','temporal','restate','inngest','dbos','windmill','n8n']),
 model:Object.freeze(['commander-planner','colibri','llama.cpp','ollama','vllm']),
 desktop:Object.freeze(['windows-uia-native','linux-atspi-native','xdg-desktop-portal','cua-last-resort']),
 browser:Object.freeze(['playwright-mcp','chrome-devtools-mcp','commander-owned-browser']),
 policy:Object.freeze(['commander-native-policy','cedar','openfga','opa']),
 telemetry:Object.freeze(['commander-receipts','opentelemetry']),
 'control-center':Object.freeze(['commander-native-ui','tauri-v2'])
});
export function chooseHybridCapability(input={}){
 if(!object(input)||!DOMAINS.has(input.domain))invalid();
 const {domain,capabilities={},grants={},context={},preference}=input;
 if(!object(capabilities)||!object(grants)||!object(context))invalid();
 if(preference!==undefined&&!safe(preference))invalid();
 if(context.externalEffectStatus==='UNKNOWN'||context.externalEffectStatus==='PENDING_UNKNOWN'){
  return verdict('BLOCKED','commander-durable-r2','UNCERTAIN_EFFECT_REQUIRES_LOCAL_RECONCILIATION');
 }
 if(domain==='workflow'){
  if(!flag(capabilities.commanderWorkflowReady)||!flag(context.localJournalHealthy))
   return verdict('BLOCKED',null,'LOCAL_JOURNAL_REQUIRED');
  if(!flag(context.requiresFleet)){
   return verdict('READY','commander-durable-r2','LOCAL_DURABLE_EXECUTION',
    {scope:'LOCAL',requiresExternalOrchestrator:false});
  }
  if(context.effectClass==='GUI_MUTATION'||context.effectClass==='BROWSER_PROFILE_MUTATION')
   return verdict('BLOCKED','commander-durable-r2','INTERACTIVE_OWNER_EFFECT_CANNOT_BE_FLEET_REPLAYED');
  if(!flag(grants.fleetDispatch)||!flag(context.chatAuthenticated)||!flag(context.rootLeaseVerified))
   return verdict('BLOCKED','commander-durable-r2','FLEET_AUTH_AND_ROOT_LEASE_REQUIRED');
  if(!flag(capabilities.coordinatorReachable)||!flag(capabilities.fleetPolicyVerified))
   return verdict('BLOCKED','commander-durable-r2','FLEET_COORDINATOR_UNVERIFIED');
  if(!FLEET.has(preference)||!flag(capabilities.fleetProviders?.[preference]?.healthy)||
     !flag(capabilities.fleetProviders?.[preference]?.configured))
   return verdict('BLOCKED','commander-durable-r2','FLEET_PROVIDER_NOT_VERIFIED');
  return verdict('READY',preference,'FLEET_SCHEDULING_ONLY',{
   scope:'FLEET_COORDINATION',localWorker:'commander-durable-r2',
   ownerAuthorizationDelegated:false,remoteEffectReplay:false
  });
 }
 if(domain==='model'){
  if(preference===undefined||preference==='commander-planner')
   return verdict('READY','commander-planner','EXISTING_PLANNER',
    {downloadsAllowed:false});
  if(!MODELS.has(preference))invalid();
  const model=capabilities.models?.[preference];
  if(!flag(grants.localModel)||!flag(context.modelLicenseApproved)||
     !flag(model?.installed)||!flag(model?.healthy))
   return verdict('BLOCKED','commander-planner','LOCAL_MODEL_NOT_AUTHORIZED_OR_READY',
    {requestedProvider:preference,downloadsAllowed:false});
  return verdict('READY',preference,'OPTIONAL_LOCAL_INFERENCE_ONLY',
   {downloadsAllowed:false,cloudDataTransfer:false});
 }
 if(domain==='desktop'||domain==='browser'){
  // Native owner-session checks live in agentos-provider-router, UIA/AT-SPI,
  // browser consent and the exact workspace lease. This plane cannot grant them.
  return verdict('DELEGATE','agentos-provider-router',
   'EXACT_OWNER_SESSION_AND_TARGET_GRANTS_REQUIRED');
 }
 if(domain==='policy'){
  if(preference&&preference!=='commander-native-policy'){
   if(!['cedar','openfga','opa'].includes(preference))invalid();
   if(!flag(capabilities.policyEngines?.[preference]?.healthy))
    return verdict('BLOCKED','commander-native-policy','EXTERNAL_POLICY_ENGINE_UNAVAILABLE');
   return verdict('READY',preference,'ADDITIONAL_POLICY_DECISION_ONLY',
    {commanderDenyOverrides:true});
  }
  return verdict('READY','commander-native-policy','MANDATORY_NATIVE_DENY_BY_DEFAULT');
 }
 if(domain==='telemetry'){
  if(preference==='opentelemetry'){
   if(!flag(grants.exportTelemetry)||!flag(capabilities.otelReady)||
     !flag(context.redactionVerified))
    return verdict('BLOCKED','commander-receipts','TELEMETRY_EXPORT_NOT_APPROVED');
   return verdict('READY','opentelemetry','REDACTED_TRACE_EXPORT_ONLY',
    {secretsInBaggage:false,localReceiptsPreserved:true});
  }
  return verdict('READY','commander-receipts','LOCAL_RECEIPTS_ONLY');
 }
 if(domain==='control-center'){
  if(preference==='tauri-v2'){
   if(!flag(capabilities.tauriInstalled)||!flag(grants.nativeUI))
    return verdict('BLOCKED','commander-native-ui','NATIVE_UI_NOT_INSTALLED_OR_GRANTED');
   return verdict('READY','tauri-v2','USER_SESSION_UI_ONLY',{servicePrivileges:false});
  }
  return verdict('READY','commander-native-ui','EXISTING_CONTROL_CENTER');
 }
 invalid();
}
