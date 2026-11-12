// v0.12 PRIVATE: owner-pinned per-(ChatGPT account, host) operation gate.
// No listener, tunnel change, OAuth requirement or OS privilege elevation.
// This gate is *not* wired to installed Core. Trusted providers come from the
// owner bootstrap, never MCP parameters, remote headers or model-supplied IDs.
import {isProxy} from 'node:util/types';
import {normalizeV2Route} from './v2-routing-contract.mjs';
import {executeV2BoundOperation} from './v2-authorized-operation.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const BINDING=/^[a-f0-9]{32,64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};

function exact(value,fields,code){
  if(!value||typeof value!=='object'||Array.isArray(value)||isProxy(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    fail(code);
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length||keys.some(key=>
    typeof key!=='string'||!fields.includes(key)))fail(code);
  const out=Object.create(null);
  for(const key of fields){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d||d.enumerable!==true||!Object.hasOwn(d,'value'))fail(code);
    out[key]=d.value;
  }
  return Object.freeze(out);
}

function strictRoute(value){
  const v=exact(value,['hostId','principalId','profileId','conversationId',
    'operationId','target'],'V2_PRIVATE_ROUTE_REQUIRED');
  const target=exact(v.target,['kind','id'],'V2_PRIVATE_ROUTE_REQUIRED');
  return normalizeV2Route({...v,target:{...target}});
}

export function createV2PrivatePairOperationGate({
  hostId,profileId,principalId,expectedTunnelIdHash,expectedOwnerSidHash,
  attestTransport,resolveOwnerContext,readCurrentOwnerSidHash,
  verifyExactNativeGrant,withLease,receiptStore,execute,now=Date.now
}={}){
  if(![hostId,profileId,principalId].every(v=>typeof v==='string'
    &&ID.test(v)&&v!=='.'&&v!=='..')
    ||![expectedTunnelIdHash,expectedOwnerSidHash].every(v=>
      typeof v==='string'&&HASH.test(v))
    ||[attestTransport,resolveOwnerContext,readCurrentOwnerSidHash,
      verifyExactNativeGrant,withLease,execute,now].some(f=>typeof f!=='function')
    ||typeof receiptStore?.execute!=='function')
    fail('V2_PRIVATE_OPERATION_BOOTSTRAP_REQUIRED');

  async function verify(request,route){
    // A known TLS peer is not proof of human authority; require both the
    // independently owner-enrolled pair AND a fresh native owner binding.
    const transport=await attestTransport(request);
    if(transport?.authenticated!==true
      ||transport.peerType!=='owner-pinned-private-tunnel-mtls'
      ||transport.sessionSource!=='native-owner-private-pair')
      fail('V2_PRIVATE_OPERATION_TRANSPORT_REQUIRED');
    const before=await readCurrentOwnerSidHash();
    if(before!==expectedOwnerSidHash)
      fail('V2_PRIVATE_OPERATION_OWNER_CHANGED');
    let ownerContext;
    try{ownerContext=await resolveOwnerContext();}
    catch{fail('V2_PRIVATE_OPERATION_OWNER_CONTEXT_REQUIRED');}
    const c=exact(ownerContext,
      ['source','hostId','profileId','principalId','conversationId',
        'bindingId','ownerSidHash','tunnelIdHash','expiresAtMs'],
      'V2_PRIVATE_OPERATION_OWNER_CONTEXT_REQUIRED');
    const after=await readCurrentOwnerSidHash();
    const timestamp=now();
    if(before!==after||after!==expectedOwnerSidHash)
      fail('V2_PRIVATE_OPERATION_OWNER_CHANGED');
    if(c.source!=='native-owner-attested'||c.hostId!==hostId
      ||c.profileId!==profileId||c.principalId!==principalId
      ||c.conversationId!==route.conversationId
      ||c.ownerSidHash!==expectedOwnerSidHash
      ||c.tunnelIdHash!==expectedTunnelIdHash
      ||typeof c.bindingId!=='string'||!BINDING.test(c.bindingId)
      ||!Number.isSafeInteger(timestamp)||!Number.isSafeInteger(c.expiresAtMs)
      ||c.expiresAtMs<=timestamp)
      fail('V2_PRIVATE_OPERATION_BINDING_REQUIRED');
    return c;
  }

  return Object.freeze({
    async execute({request,route,tool}={}){
      const r=strictRoute(route);
      if(r.hostId!==hostId||r.profileId!==profileId
        ||r.principalId!==principalId)
        fail('V2_PRIVATE_OPERATION_PAIR_MISMATCH');
      // Do not run any caller-selected tool until the exact pair and native
      // owner seat are reverified; a grant is *per action*, not per socket.
      await verify(request,r);
      return executeV2BoundOperation(r,{
        observedCaller:async()=>{
          await verify(request,r);
          return Object.freeze({hostId,profileId,principalId,
            conversationId:r.conversationId});
        },
        hasGrant:async(grantRoute,grantTool)=>{
          const c=await verify(request,r);
          // This callback must check native signature, exact route/action,
          // binding epoch, grant revision, expiry and revocation at each call.
          return await verifyExactNativeGrant(Object.freeze({
            route:grantRoute,tool:grantTool,ownerContext:c
          }))===true;
        },
        withLease,receiptStore,execute
      },tool);
    }
  });
}
