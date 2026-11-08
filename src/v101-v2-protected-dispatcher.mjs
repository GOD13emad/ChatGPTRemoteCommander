// V1-01 handoff adapter for an independently authenticated V2 MCP ingress.
// This module does NOT open a port, enroll native owners, issue access tokens,
// or grant Full Access. A real transport attestor and OAuth provider are required.
// The installed V2 dispatcher still independently enforces the signed action,
// grant registry, workflow revision/lease and exact dispatch at execution.
import {isProxy} from 'node:util/types';
import {createV101ProtectedRouterBridge} from './full-access-protected-router-bridge.mjs';

const SESSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// Only protocol bootstrap/read-only discovery may bypass owner-action admission.
// Additional MCP method families (including resources, prompts or tasks)
// require an explicit scoped policy review, not a future V2 default passthrough.
const UNPRIVILEGED_RPC_METHODS=new Set([
  'initialize','notifications/initialized','ping','tools/list'
]);
function fail(code){throw Object.assign(new Error(code),{code});}
function record(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)
  &&!isProxy(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));}

// Ingress normally supplies JSON.parse data bounded to 64 KiB. Reject
// programmatic/synthetic inputs with getters, Symbols, Proxy or cycles,
// and freeze the *same* message used by the downstream V2 dispatcher.
// A JSON stringify/parse clone is NOT safe for exact +0/-0 semantics.
function freezeJson(value,state={seen:new WeakSet(),nodes:0},depth=0){
  if(++state.nodes>10000||depth>32)fail('V101_V2_PAYLOAD_BOUNDS');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value))fail('V101_V2_PAYLOAD_NOT_JSON');
    return value;
  }
  if(typeof value!=='object'||isProxy(value)||state.seen.has(value))
    fail('V101_V2_PAYLOAD_NOT_JSON');
  state.seen.add(value);
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||value.length>10000
       ||Reflect.ownKeys(value).length!==value.length+1)
      fail('V101_V2_PAYLOAD_NOT_JSON');
    for(let i=0;i<value.length;i++){
      const d=Object.getOwnPropertyDescriptor(value,String(i));
      if(!d||!Object.hasOwn(d,'value')||d.enumerable!==true)
        fail('V101_V2_PAYLOAD_NOT_JSON');
      freezeJson(d.value,state,depth+1);
    }
  }else if(record(value)){
    const keys=Object.keys(value);
    if(keys.length>10000||keys.length!==Reflect.ownKeys(value).length)
      fail('V101_V2_PAYLOAD_NOT_JSON');
    for(const key of keys){
      if(['__proto__','constructor','prototype'].includes(key))
        fail('V101_V2_PAYLOAD_NOT_JSON');
      const d=Object.getOwnPropertyDescriptor(value,key);
      if(!d||!Object.hasOwn(d,'value')||d.enumerable!==true)
        fail('V101_V2_PAYLOAD_NOT_JSON');
      freezeJson(d.value,state,depth+1);
    }
  }else fail('V101_V2_PAYLOAD_NOT_JSON');
  Object.freeze(value);
  return value;
}

function denied(id){return Object.freeze({
  jsonrpc:'2.0',id:typeof id==='string'||Number.isSafeInteger(id)?id:null,
  result:{isError:true,content:[{type:'text',text:'V1-01 native owner authorization required.'}]}
});}

/**
 * Wrap V2's trusted dispatcher factory without changing installed routing.
 * Input dependencies MUST originate from owner-controlled bootstrap, not from
 * HTTP bodies, headers, caller-selected module paths, or model tool arguments.
 * The factory is intended for createV2CandidateHttpIngress.dispatcherFactory.
 * On each protected tool call, verify OAuth + independently owner-attested
 * token/session epoch + grant + exact action before delegating the SAME frozen
 * message to the canonical V2 dispatcher for its own authorizations.
 */
export function createV101V2ProtectedDispatcherFactory({
  hostId,profileId,issuer,audience,verifyAccessToken,resolvePrincipal,
  resolveAttestedTokenBinding,nativeSessionBindings,grantRegistry,
  authorizeExactInvocation,createTrustedDispatcher,now=Date.now
}={}){
  if(typeof createTrustedDispatcher!=='function')
    fail('V101_V2_TRUSTED_DISPATCHER_FACTORY_REQUIRED');
  // Let the underlying Bridge validate exact fixed trust provider contracts.
  const config={hostId,profileId,issuer,audience,verifyAccessToken,
    resolvePrincipal,resolveAttestedTokenBinding,nativeSessionBindings,
    grantRegistry,authorizeExactInvocation,now};
  const sanity=createV101ProtectedRouterBridge(config);
  sanity.close();
  return async function ownerBoundDispatcherFactory(transport){
    if(!record(transport)||transport.authenticated!==true||
      typeof transport.sessionHandle!=='string'||
      !SESSION.test(transport.sessionHandle))
      fail('V101_V2_TRUSTED_TRANSPORT_REQUIRED');
    const proof=Object.freeze({authenticated:true,
      sessionHandle:transport.sessionHandle});
    const underlying=await createTrustedDispatcher(proof);
    if(!underlying||typeof underlying.handleRpc!=='function'
      ||typeof underlying.protectedResource?.metadataUrl!=='string')
      fail('V101_V2_TRUSTED_DISPATCHER_UNAVAILABLE');
    return Object.freeze({
      protectedResource:underlying.protectedResource,
      async handleRpc({authorization,message}={}){
        let bridge;
        let safeId=null;
        try{
          // Freeze BEFORE inspecting even the RPC method. This rejects
          // accessor/Proxy method switching and pins the exact message
          // subsequently forwarded to the canonical V2 dispatcher.
          freezeJson(message);
          if(!record(message))return denied(null);
          safeId=message.id;
          if(message.method!=='tools/call'){
            if(!UNPRIVILEGED_RPC_METHODS.has(message.method))
              return denied(safeId);
            return await underlying.handleRpc({authorization,message});
          }
          // Future or renamed tools cannot bypass V1-01 owner policy via
          // a default passthrough path. Explicitly allowlist new tools
          // only after a separate scoped native-owner policy review.
          if(!record(message.params)
             ||message.params.name!=='v2_workflow_step')
            return denied(safeId);
          // Missing bearer goes only to the canonical V2 OAuth challenge.
          if(typeof authorization!=='string'
            ||!authorization.startsWith('Bearer '))
            return await underlying.handleRpc({authorization,message});
          const action=message.params.arguments;
          if(!record(action)||!record(action.arguments))
            return denied(message.id);
          bridge=createV101ProtectedRouterBridge(config);
          const actor=await bridge.verifyCaller(authorization.slice(7));
          if(!actor||actor.conversationId!==proof.sessionHandle
            ||!await bridge.authorizeTool(actor,{
              rpcMethod:'tools/call',tool:action.tool,arguments:action.arguments
            }))
            return denied(message.id);
          // No other await before handing the exact same frozen request to V2.
          return await underlying.handleRpc({authorization,message});
        }catch{
          // Never read an untrusted getter in the rejection path.
          return denied(safeId);
        }finally{bridge?.close();}
      }
    });
  };
}
