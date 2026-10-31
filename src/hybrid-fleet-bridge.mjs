// Commander Fleet transport admission contract. No provider SDK required.
 // Transport accepts metadata-only scheduling intents, never OS/GUI effect payloads.
 // The injected journal MUST atomically reserve an idempotency key before send.
 // Any unacknowledged or unknown transport outcome is never replayed here.
import {createHash} from 'node:crypto';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const STATES=new Set(['READY','QUEUED','UNKNOWN','FAILED','ACKED','REJECTED']);
const EFFECTS=new Set(['READ_ONLY','COORDINATION']);
const safeId=s=>typeof s==='string'&&ID.test(s);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const freeze=value=>Object.freeze(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createHybridFleetBridge({journal,transport,authorize,now=Date.now}={}){
 if(typeof now!=='function')fail('FLEET_BRIDGE_DEPENDENCY_MISSING');
 if(typeof journal?.reserve!=='function'||typeof journal?.confirm!=='function'||
    typeof journal?.uncertain!=='function'||typeof transport?.submit!=='function'||
    typeof authorize!=='function')fail('FLEET_BRIDGE_DEPENDENCY_MISSING');
 // Not a generic command-dispatch API. There is no remote shell, GUI or
 // credential field in the wire format, even for a healthy provider.
 async function submit(input={}){
  const {workflowId,stepId,requestId,targetDevice,provider,effectClass,epoch,deadlineMs}=input;
  if(![workflowId,stepId,requestId,targetDevice].every(safeId)||
      !['hatchet','temporal','restate'].includes(provider)||
      !EFFECTS.has(effectClass)||!Number.isSafeInteger(epoch)||epoch<1||
      !Number.isSafeInteger(deadlineMs)||deadlineMs<=now()||
      Object.keys(input).some(k=>!['workflowId','stepId','requestId','targetDevice',
       'provider','effectClass','epoch','deadlineMs'].includes(k)))fail('FLEET_ENVELOPE_INVALID');
  // Live permission must come from the host's trusted authorizer, not any
  // booleans supplied in the untrusted scheduling intent.
  const auth=await authorize({workflowId,stepId,requestId,targetDevice,provider,epoch,effectClass});
  if(auth?.approved!==true||auth.chatAuthenticated!==true||auth.rootLeaseVerified!==true||
     auth.ownerSessionAuthorized!==true||auth.providerHealthy!==true||
     auth.journalHealthy!==true||!safeId(auth.principalRef)||!safeId(auth.rootLeaseRef)||
     auth.fenceEpoch!==epoch)return freeze({status:'BLOCKED',code:'FLEET_AUTH_OR_LEASE_UNVERIFIED'});
  const envelope=freeze({
   schema:1,kind:'COMMANDER_FLEET_SCHEDULE_INTENT',workflowId,stepId,requestId,targetDevice,
   provider,effectClass,epoch,deadlineMs,principalRef:auth.principalRef,rootLeaseRef:auth.rootLeaseRef
  });
  const digest=hash(envelope);
  const reservation=await journal.reserve({requestId,digest,epoch,workflowId,stepId});
  if(reservation?.status!=='NEW'){
   // A lost ACK, crashed transport or duplicate chat delivery cannot authorize
   // sending a second time, even when the first delivery might not have arrived.
   return freeze({status:'BLOCKED',code:'DUPLICATE_OR_UNCERTAIN_NO_REPLAY',requestId});
  }
  try{
   const ack=await transport.submit(envelope);
   if(ack?.requestId!==requestId||ack?.digest!==digest||ack?.accepted!==true)
    fail('FLEET_TRANSPORT_ACK_INVALID');
   try{
    await journal.confirm({requestId,digest,epoch,receipt:{provider,accepted:true}});
   }catch{
    return freeze({status:'UNCERTAIN',code:'FLEET_ACK_NOT_DURABLE_NO_REPLAY',requestId});
   }
   return freeze({status:'SCHEDULED',requestId,digest,provider,
    localEffectExecuted:false,authorizationDelegated:false});
  }catch{
   try{await journal.uncertain({requestId,digest,epoch});}catch{/* reservation still fences duplicate */}
   return freeze({status:'UNCERTAIN',code:'FLEET_DELIVERY_UNKNOWN_NO_REPLAY',requestId});
  }
 }
 function inspectEnvelope(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('FLEET_ENVELOPE_INVALID');
  if(value.schema!==1||value.kind!=='COMMANDER_FLEET_SCHEDULE_INTENT'||
    ![value.workflowId,value.stepId,value.requestId,value.targetDevice,value.provider,
      value.principalRef,value.rootLeaseRef].every(safeId)||
    !EFFECTS.has(value.effectClass)||!Number.isSafeInteger(value.epoch)||value.epoch<1||
    !Number.isSafeInteger(value.deadlineMs)||value.deadlineMs<=now()||
    Object.keys(value).length!==12)fail('FLEET_ENVELOPE_INVALID');
  return freeze({requestId:value.requestId,digest:hash(value),metadataOnly:true});
 }
 return freeze({submit,inspectEnvelope,mode:'NO_EXECUTION_LOCAL_LEDGER_REQUIRED'});
}
