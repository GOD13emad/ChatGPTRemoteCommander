// Fixed-scope owner-local Worker grant administration for ONE read-only canary.
// This is NOT a network endpoint, automatic permission grant, or production
// bootstrap by itself. Each mutation enters V2GrantRegistry's real native
// owner-consent authorizer, with a matching live J01 binding. No caller-supplied
// worker/owner identity, target, tool, or grant expiry is accepted.
import {isProxy} from 'node:util/types';
import {deriveWorkerId} from './worker-identity-authority.mjs';
import {deriveV101PrivatePairSessionHandle} from './v101-private-pair-native-owner-stack.mjs';
import {normalizeV2Route} from './v2-routing-contract.mjs';

const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_OWNER_CANARY_GRANT_MS=5*60_000; // bounded by the exact native J01 epoch
const OWNER_FIELDS=['source','hostId','profileId','principalId',
  'conversationId','bindingId','ownerSidHash','expiresAtMs'];
const EVIDENCE_FIELDS=['source','hostId','profileId','ownerSidHash',
  'keyId','deviceProvider','deviceIdHash','capabilityPolicyDigest',
  'attestedAtMs','expiresAtMs','verified'];
const fail=code=>{throw Object.assign(new Error(code),{code});};
const id=x=>typeof x==='string'&&ID.test(x)&&x!=='.'&&x!=='..';
const sha=x=>typeof x==='string'&&HEX.test(x);
function exact(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value)||isProxy(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value))
    ||Reflect.ownKeys(value).length!==fields.length)fail('V012_OWNER_GRANT_RECORD_INVALID');
  return Object.freeze(Object.fromEntries(fields.map(k=>{
    const d=Object.getOwnPropertyDescriptor(value,k);
    if(!d?.enumerable||!Object.hasOwn(d,'value'))
      fail('V012_OWNER_GRANT_RECORD_INVALID');
    return [k,d.value];
  })));
}
function ownerMatches(a,b){return OWNER_FIELDS.every(k=>a[k]===b[k]);}

/**
 * This controller is callable only by the locally authenticated owner
 * administration interface (not MCP or Worker). The bootstrap must inject
 * real native key evidence, not a fixture or caller-selected device.
 * Consent is handled by the actual V2GrantRegistry native authorizer.
 */
export function createV012OwnerGrantAdministration({
  ownerStack,identity,resolveVerifiedWorkerKey,
  resolvePinnedCanaryRoute,workerAuthority,resolveSignedWorkerEnvelope,
  now=Date.now
}={}){
  if(!identity||![identity.hostId,identity.profileId,identity.principalId].every(id)
    ||![identity.expectedTunnelIdHash,identity.expectedOwnerSidHash].every(sha)
    ||typeof resolveVerifiedWorkerKey!=='function'
    ||typeof resolvePinnedCanaryRoute!=='function'
    ||typeof now!=='function'
    ||typeof ownerStack?.nativeSessionBindings?.resolveNativeOwnerContext!=='function'
    ||typeof ownerStack.nativeSessionBindings.resolveNativeRoute!=='function'
    ||typeof ownerStack?.resolveOwnerContext!=='function'
    ||typeof ownerStack?.readCurrentOwnerSidHash!=='function'
    ||typeof ownerStack?.grantRegistry?.changeWorkerGrant!=='function'
    ||typeof ownerStack.grantRegistry.change!=='function'
    ||typeof ownerStack.grantRegistry.changeWorkerToolGrant!=='function')
    fail('V012_OWNER_GRANT_BOOTSTRAP_REQUIRED');
  if((workerAuthority!==undefined||resolveSignedWorkerEnvelope!==undefined)
    &&(typeof workerAuthority?.registerSignedWorker!=='function'
      ||typeof resolveSignedWorkerEnvelope!=='function'))
    fail('V012_OWNER_GRANT_SIGNED_REGISTRATION_AUTHORITY_REQUIRED');
  const pair=deriveV101PrivatePairSessionHandle({
    profileId:identity.profileId,expectedTunnelIdHash:identity.expectedTunnelIdHash,
    expectedOwnerSidHash:identity.expectedOwnerSidHash
  });
  const registry=ownerStack.grantRegistry;
  const clock=()=>{
    const t=now();
    if(!Number.isSafeInteger(t)||t<0)fail('V012_OWNER_GRANT_CLOCK_INVALID');
    return t;
  };
  async function evidence(){
    const t=clock();
    const beforeSid=await ownerStack.readCurrentOwnerSidHash();
    if(beforeSid!==identity.expectedOwnerSidHash)fail('V012_OWNER_GRANT_OWNER_CHANGED');
    const before=exact(
      await ownerStack.nativeSessionBindings.resolveNativeOwnerContext(pair),
      OWNER_FIELDS);
    if(before.source!=='native-owner-attested'
      ||before.hostId!==identity.hostId||before.profileId!==identity.profileId
      ||before.principalId!==identity.principalId||before.conversationId!==pair
      ||!sha(before.ownerSidHash)||before.ownerSidHash!==beforeSid
      ||typeof before.bindingId!=='string'||!/^[a-f0-9]{32,64}$/.test(before.bindingId)
      ||!Number.isSafeInteger(before.expiresAtMs)||before.expiresAtMs<=t)
      fail('V012_OWNER_GRANT_NATIVE_J01_REQUIRED');
    const [context,routeRaw,keyRaw]=await Promise.all([
      ownerStack.resolveOwnerContext(pair),
      ownerStack.nativeSessionBindings.resolveNativeRoute(pair),
      resolveVerifiedWorkerKey()
    ]);
    const key=exact(keyRaw,EVIDENCE_FIELDS);
    const route=normalizeV2Route(await resolvePinnedCanaryRoute(
      Object.freeze({nativeRoute:routeRaw,ownerContext:before,
        tool:'system_status',arguments:Object.freeze({})})));
    const after=exact(
      await ownerStack.nativeSessionBindings.resolveNativeOwnerContext(pair),
      OWNER_FIELDS);
    const afterSid=await ownerStack.readCurrentOwnerSidHash();
    const updated=clock();
    if(afterSid!==beforeSid||!ownerMatches(before,after)
      ||before.expiresAtMs<=updated
      ||context?.tunnelIdHash!==identity.expectedTunnelIdHash
      ||OWNER_FIELDS.some(k=>context[k]!==before[k])
      ||key.source!=='native-worker-key-attestor'||key.verified!==true
      ||key.hostId!==before.hostId||key.profileId!==before.profileId
      ||key.ownerSidHash!==beforeSid
      ||key.deviceProvider!=='native-key-store'
      ||![key.keyId,key.deviceIdHash,key.capabilityPolicyDigest].every(sha)
      ||!Number.isSafeInteger(key.attestedAtMs)||key.attestedAtMs>updated
      ||updated-key.attestedAtMs>60000
      ||!Number.isSafeInteger(key.expiresAtMs)||key.expiresAtMs<=updated
      ||route.hostId!==before.hostId||route.profileId!==before.profileId
      ||route.principalId!==before.principalId||route.conversationId!==before.conversationId
      ||route.target.kind!=='host-shell'||route.target.id!=='system-status'
      ||route.operationId!=='system-status-canary')
      fail('V012_OWNER_GRANT_EXACT_CANARY_REQUIRED');
    const workerId=deriveWorkerId({
      hostId:before.hostId,profileId:before.profileId,ownerSidHash:beforeSid,
      deviceProvider:key.deviceProvider,deviceIdHash:key.deviceIdHash,keyId:key.keyId
    });
    const workerContext=Object.freeze({
      hostId:before.hostId,profileId:before.profileId,
      principalId:before.principalId,conversationId:before.conversationId,
      bindingId:before.bindingId,workerId,keyId:key.keyId,
      ownerSidHash:beforeSid,deviceProvider:key.deviceProvider,
      deviceIdHash:key.deviceIdHash,tunnelProvider:'openai-secure-mcp-tunnel',
      tunnelIdHash:identity.expectedTunnelIdHash,
      capabilityPolicyDigest:key.capabilityPolicyDigest
    });
    return Object.freeze({workerContext,route,
      // A 4s signed Tunnel witness attests key identity at THIS instant.
      // It is not the lifetime of the owner-approved grant: a human native
      // confirmation may last longer than the attestation TTL. Every later
      // Worker action must freshly re-attest this exact owner+Tunnel+key.
      expiresAtMs:Math.min(after.expiresAtMs,updated+MAX_OWNER_CANARY_GRANT_MS)});
  }
  function sameWorkerGrant(grant,c,t){
    return grant?.status==='ACTIVE'&&grant.bindingId===c.bindingId
      &&grant.workerId===c.workerId&&grant.keyId===c.keyId
      &&grant.expiresAtMs>t;
  }
  const sameCanary=(before,after)=>after.workerContext.bindingId===before.workerContext.bindingId
    &&after.workerContext.workerId===before.workerContext.workerId
    &&after.workerContext.deviceIdHash===before.workerContext.deviceIdHash
    &&after.workerContext.capabilityPolicyDigest===before.workerContext.capabilityPolicyDigest
    &&after.route.operationId===before.route.operationId;
  async function approveExactTool(e,tool){
    const base=registry.read(e.route,tool);
    if(base?.status!=='ENABLED')await registry.change({
      route:e.route,tool,status:'ENABLED',
      expectedRevision:base?.revision??0,actor:identity.principalId,
      reason:'Owner-requested read-only Core migration canary'
    });
    const parent=registry.readWorkerGrant(e.workerContext);
    if(!sameWorkerGrant(parent,e.workerContext,clock()))
      fail('V012_OWNER_GRANT_PARENT_APPROVAL_REQUIRED');
    const grant=registry.readWorkerToolGrant(e.route,e.workerContext,tool);
    if(grant?.status!=='ENABLED'||grant.bindingId!==e.workerContext.bindingId
      ||grant.expiresAtMs<=clock())await registry.changeWorkerToolGrant({
      route:e.route,workerContext:e.workerContext,tool,status:'ENABLED',
      expectedRevision:grant?.revision??0,actor:identity.principalId,
      reason:'Owner-requested read-only Core migration canary',
      expiresAtMs:Math.min(e.expiresAtMs,parent.expiresAtMs)
    });
  }
  return Object.freeze({
    async inspect(){
      const e=await evidence();
      const worker=registry.readWorkerGrant(e.workerContext);
      const base=registry.read(e.route,'system_status');
      const tool=registry.readWorkerToolGrant(e.route,e.workerContext,'system_status');
      return Object.freeze({nativeOwnerBound:true,workerActive:sameWorkerGrant(worker,e.workerContext,clock()),
        exactBaseEnabled:base?.status==='ENABLED',exactWorkerToolEnabled:tool?.status==='ENABLED',
        readOnlyCanaryAllowed:registry.isWorkerAllowed(e.route,e.workerContext,'system_status')});
    },
    async approveWorker(){
      const e=await evidence(),before=registry.readWorkerGrant(e.workerContext);
      if(sameWorkerGrant(before,e.workerContext,clock()))
        return Object.freeze({alreadyActive:true,revision:before.revision});
      const result=await registry.changeWorkerGrant({
        workerContext:e.workerContext,status:'ACTIVE',expectedRevision:before?.revision??0,
        actor:identity.principalId,reason:'Owner-requested read-only Core migration canary',
        expiresAtMs:e.expiresAtMs
      });
      // The visible native dialog may outlast the initial short-lived
      // transport proof. Re-sample exactly the SAME owner, Worker and scope
      // before reporting approval as available.
      const after=await evidence();
      if(after.workerContext.workerId!==e.workerContext.workerId
        ||after.workerContext.bindingId!==e.workerContext.bindingId
        ||after.workerContext.deviceIdHash!==e.workerContext.deviceIdHash
        ||after.workerContext.capabilityPolicyDigest!==e.workerContext.capabilityPolicyDigest
        ||after.route.operationId!==e.route.operationId
        ||!sameWorkerGrant(registry.readWorkerGrant(after.workerContext),
          after.workerContext,clock()))
        fail('V012_OWNER_GRANT_POST_APPROVAL_UNVERIFIED');
      return Object.freeze({alreadyActive:false,revision:result.revision});
    },
    async revokeCanaryWorker(){
      // Revoke only the SAME currently J01-bound canary Worker. The durable
      // Worker grant registry requests genuine fresh native owner consent.
      // No client-supplied identity, tool, expiry or target can broaden this.
      const e=await evidence(),before=registry.readWorkerGrant(e.workerContext);
      if(!sameWorkerGrant(before,e.workerContext,clock())){
        if(before&&before.bindingId===e.workerContext.bindingId
          &&before.workerId===e.workerContext.workerId
          &&before.keyId===e.workerContext.keyId
          &&(before.status==='REVOKED'||before.expiresAtMs<=clock())
          &&registry.isWorkerAllowed(e.route,e.workerContext,'system_status')!==true
          &&registry.isWorkerAllowed(e.route,e.workerContext,'worker.register')!==true)
          return Object.freeze({revoked:true,alreadyInactive:true});
        fail('V012_OWNER_GRANT_REVOKE_NO_CURRENT_WORKER');
      }
      const result=await registry.changeWorkerGrant({
        workerContext:e.workerContext,status:'REVOKED',
        expectedRevision:before.revision,actor:identity.principalId,
        reason:'Owner-requested revocation of one scoped Core migration canary'
      });
      // Re-evaluate the exact native owner+Worker binding after consent.
      // A changed J01 or a racing grant reactivation is never reported as
      // a successful revocation.
      const after=await evidence();
      if(!sameCanary(e,after)
        ||result.status!=='REVOKED'||result.bindingId!==e.workerContext.bindingId
        ||result.revision!==before.revision+1
        ||registry.readWorkerGrant(after.workerContext)?.status!=='REVOKED'
        ||registry.isWorkerAllowed(after.route,after.workerContext,'system_status')!==false
        ||registry.isWorkerAllowed(after.route,after.workerContext,'worker.register')!==false)
        fail('V012_OWNER_GRANT_REVOKE_POST_CONSENT_UNVERIFIED');
      return Object.freeze({revoked:true,alreadyInactive:false});
    },
    async approveReadOnlyCanary(){
      const e=await evidence();
      const parent=registry.readWorkerGrant(e.workerContext);
      if(!sameWorkerGrant(parent,e.workerContext,clock()))
        fail('V012_OWNER_GRANT_PARENT_APPROVAL_REQUIRED');
      await approveExactTool(e,'system_status');
      const after=await evidence();
      if(after.workerContext.bindingId!==e.workerContext.bindingId
        ||after.workerContext.workerId!==e.workerContext.workerId
        ||after.workerContext.deviceIdHash!==e.workerContext.deviceIdHash
        ||after.workerContext.capabilityPolicyDigest!==e.workerContext.capabilityPolicyDigest
        ||after.route.operationId!==e.route.operationId
        ||registry.isWorkerAllowed(after.route,after.workerContext,'system_status')!==true)
        fail('V012_OWNER_GRANT_POST_APPROVAL_UNVERIFIED');
      return Object.freeze({canaryAllowed:true,expiresAtMs:e.expiresAtMs});
    },
    async approveSignedRegistration(){
      if(!workerAuthority||!resolveSignedWorkerEnvelope)
        fail('V012_OWNER_GRANT_SIGNED_REGISTRATION_AUTHORITY_REQUIRED');
      const e=await evidence();
      const parent=registry.readWorkerGrant(e.workerContext);
      if(!sameWorkerGrant(parent,e.workerContext,clock()))
        fail('V012_OWNER_GRANT_PARENT_APPROVAL_REQUIRED');
      await approveExactTool(e,'worker.register');
      const after=await evidence();
      if(!sameCanary(e,after)
        ||registry.isWorkerAllowed(after.route,after.workerContext,'worker.register')!==true)
        fail('V012_OWNER_GRANT_POST_APPROVAL_UNVERIFIED');
      return Object.freeze({registrationAllowed:true});
    },
    async registerSignedWorker(){
      if(!workerAuthority||!resolveSignedWorkerEnvelope)
        fail('V012_OWNER_GRANT_SIGNED_REGISTRATION_AUTHORITY_REQUIRED');
      const e=await evidence();
      const parent=registry.readWorkerGrant(e.workerContext);
      if(!sameWorkerGrant(parent,e.workerContext,clock())
        ||registry.isWorkerAllowed(e.route,e.workerContext,'worker.register')!==true)
        fail('V012_OWNER_GRANT_WORKER_REGISTER_APPROVAL_REQUIRED');
      const envelope=await resolveSignedWorkerEnvelope(Object.freeze({
        workerContext:e.workerContext,grantRevision:parent.revision,
        expiresAtMs:Math.min(e.expiresAtMs,parent.expiresAtMs)
      }));
      const after=await evidence();
      if(!sameCanary(e,after)
        ||registry.isWorkerAllowed(after.route,after.workerContext,'worker.register')!==true)
        fail('V012_OWNER_GRANT_POST_APPROVAL_UNVERIFIED');
      const stored=await workerAuthority.registerSignedWorker({envelope});
      if(stored?.claims?.workerId!==e.workerContext.workerId
        ||stored.claims.bindingId!==e.workerContext.bindingId
        ||stored.claims.grantRevision!==parent.revision)
        fail('V012_OWNER_GRANT_SIGNED_REGISTRATION_INVALID');
      return Object.freeze({registered:true,
        expiresAtMs:stored.claims.expiresAtMs});
    }
  });
}
