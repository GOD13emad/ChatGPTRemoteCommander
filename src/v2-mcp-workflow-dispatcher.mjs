// V2-G1 candidate: join OAuth, ChatGPT tool auth, trusted native conversation
// attestation, grants and the EXISTING WorkflowStore. No listening socket or
// legacy MCP mutation route is installed here.
//
// IMPORTANT: resolveTrustedInvocation is an OWNER-WORKER trusted callback,
// never a remote MCP body/header lookup. OAuth sub does not prove a ChatGPT chat.
// Missing a platform-attested conversation MUST fail closed.
import { createV2McpOAuthContract } from './v2-mcp-oauth-contract.mjs';
import { createV2OAuthObservedCaller } from './v2-oauth-caller.mjs';
import { executeV2WorkflowStep } from './v2-workflow-gateway.mjs';
import { normalizeV2Route } from './v2-routing-contract.mjs';

const STEP_TOOL='v2_workflow_step';
const LEGACY_VERSIONS=Object.freeze(['2025-11-25','2025-06-18','2025-03-26']);
const MODERN_VERSION='2026-07-28';
const SERVER_IDENTITY=Object.freeze({name:'chatgpt-remote-commander-v2-candidate',version:'0.11.0-candidate'});
const SERVER_META=Object.freeze({'io.modelcontextprotocol/serverInfo':SERVER_IDENTITY});
const EXPECTED=Object.freeze(['tool','arguments','stepId','expectedRevision']);
function fail(code){throw Object.assign(new Error(code),{code});}
function record(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(v));}
function exact(v,fields){return record(v)&&Object.keys(v).length===fields.length
  &&Object.keys(v).every(k=>fields.includes(k));}
const inputSchema=Object.freeze({
  type:'object',
  properties:{
    tool:{type:'string'},arguments:{type:'object'},
    stepId:{type:'string'},expectedRevision:{type:'integer',minimum:1}
  },
  required:[...EXPECTED],additionalProperties:false
});
export function createV2CandidateMcpDispatcher({
  resource,authorizationServers,issuer,audience,scopes=['commander.workflow'],
  assertionTrust,verifyAccessToken,resolvePrincipal,observedNativeSession,
  resolveTrustedInvocation,workflowStore,grantRegistry,authorizeTool,dispatch,
  now=Date.now
}){
  for(const candidate of [
    verifyAccessToken,resolvePrincipal,observedNativeSession,
    resolveTrustedInvocation,authorizeTool,dispatch,now
  ]){
    if(typeof candidate!=='function')fail('V2_MCP_TRUSTED_BOOTSTRAP_REQUIRED');
  }
  if(!workflowStore||!grantRegistry||!assertionTrust)
    fail('V2_MCP_TRUSTED_BOOTSTRAP_REQUIRED');
  const auth=createV2McpOAuthContract({
    resource,authorizationServers,scopes,allowedTools:[STEP_TOOL]
  });
  const descriptor=auth.toolDescriptor({
    name:STEP_TOOL,
    description:'Execute one authorized durable WorkflowStore step for a natively attested conversation.',
    inputSchema,
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}
  });
  const denied=(code='V2_MCP_OPERATION_DENIED')=>Object.freeze({
    isError:true,content:Object.freeze([Object.freeze({
      type:'text',text:'Commander V2 request denied: '+code
    })])
  });
  const outcome=(result)=>Object.freeze({
    content:Object.freeze([Object.freeze({
      type:'text',text:'Commander V2 workflow request completed.'
    })]),
    structuredContent:Object.freeze({
      outcome:result.outcome,
      cachedReceipt:result.cachedReceipt===true
    })
  });
  async function call({authorization,toolName,args}){
    if(toolName!==STEP_TOOL)return denied('V2_MCP_TOOL_UNKNOWN');
    if(!exact(args,EXPECTED)||!record(args.arguments)
      ||typeof args.stepId!=='string'||typeof args.tool!=='string'
      ||!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<1)
      return denied('V2_MCP_INPUT_INVALID');
    if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))
      return auth.toolAuthRequired();
    let trusted;
    try{
      // Verify the OAuth bearer cryptographically before consulting any
      // owner-native chat resolver. A forged bearer cannot enumerate sessions.
      const bearer=authorization.slice(7);
      const claims=await verifyAccessToken(bearer);
      const validClaims=record(claims)&&claims.issuer===issuer
        &&claims.audience===audience
        &&Number.isSafeInteger(claims.expiresAtMs)
        &&Number.isSafeInteger(claims.notBeforeMs)
        &&Number.isSafeInteger(now())
        &&claims.notBeforeMs<=now()&&claims.expiresAtMs>now()
        &&typeof claims.subject==='string'&&claims.subject.length>0
        &&Array.isArray(claims.scopes);
      if(!validClaims)fail('V2_OAUTH_VERIFICATION_REQUIRED');
      // Every scope advertised for this operation must be present in the
      // verified access token, not only the first scope in the array.
      if(!scopes.every(scope=>claims.scopes.includes(scope)))
        fail('V2_OAUTH_SCOPE_OR_SUBJECT_REQUIRED');
      // Resolution is intentionally independent of any caller-controlled
      // route, conversation ID, profile, device, or MCP session handle.
      trusted=await resolveTrustedInvocation();
      if(!exact(trusted,['route','assertion']))
        fail('V2_MCP_CHAT_ATTESTATION_REQUIRED');
      const r=normalizeV2Route(trusted.route);
      if(r.operationId!==args.stepId||r.target.kind!=='workflow-root')
        fail('V2_MCP_BOUND_OPERATION_MISMATCH');
      const observed=createV2OAuthObservedCaller({
        route:r,tool:args.tool,args:args.arguments,
        assertion:trusted.assertion,assertionTrust,
        readAuthorization:async()=>authorization,
        verifyAccessToken,resolvePrincipal,observedNativeSession,
        issuer,audience,requiredScope:scopes[0],now
      });
      const result=await executeV2WorkflowStep({
        route:r,stepId:args.stepId,expectedRevision:args.expectedRevision,
        tool:args.tool,arguments:args.arguments,
        workflowStore,grantRegistry,observedCaller:observed,
        authorizeTool,dispatch
      });
      return outcome(result);
    }catch(error){
      const code=String(error?.code??'V2_MCP_OPERATION_DENIED');
      if(code.startsWith('V2_OAUTH_')||code.startsWith('V2_JWT_')
        ||code.startsWith('V2_JWKS_'))
        return auth.toolAuthRequired({
          error:code==='V2_OAUTH_SCOPE_OR_SUBJECT_REQUIRED'?'insufficient_scope':'invalid_token'
        });
      // Platform-specific chat binding failures must NOT trigger a re-login,
      // which cannot provide a ChatGPT conversation attestation.
      const allowed=new Set([
        'V2_MCP_CHAT_ATTESTATION_REQUIRED','V2_MCP_BOUND_OPERATION_MISMATCH',
        'V2_GRANT_REQUIRED','V2_WORKFLOW_TOOL_AUTH_REQUIRED',
        'V2_ROUTE_CALLER_MISMATCH','V2_WORKFLOW_STATE_AUTHORITY_MISMATCH',
        'V2_ASSERTION_ROUTE_MISMATCH','V2_ASSERTION_ACTION_MISMATCH',
        'V2_ASSERTION_BAD_SIGNATURE','V2_ASSERTION_NATIVE_SESSION_MISMATCH',
        'V2_ASSERTION_EXPIRED_OR_INVALID_TIME'
      ]);
      return denied(allowed.has(code)?code:'V2_MCP_OPERATION_DENIED');
    }
  }
  async function handleRpc({authorization,message}){
    if(!record(message)||message.jsonrpc!=='2.0'
      ||(typeof message.id!=='string'
        && (!Number.isSafeInteger(message.id)||message.id<0))
      ||(typeof message.id==='string'
        && (!message.id.length||message.id.length>128))
      ||typeof message.method!=='string'){
      // Modern and legacy notifications are not JSON-RPC requests.
      if(record(message)&&message.jsonrpc==='2.0'
         &&message.method==='notifications/initialized'
         &&!Object.hasOwn(message,'id'))return null;
      return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}};
    }
    const version=message.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
    if(version!==undefined && version!==MODERN_VERSION){
      return {jsonrpc:'2.0',id:message.id,
        error:{code:-32022,message:'Unsupported MCP protocol version'}};
    }
    const modern=version===MODERN_VERSION;
    if(modern && !record(message.params?._meta?.['io.modelcontextprotocol/clientCapabilities'])){
      return {jsonrpc:'2.0',id:message.id,
        error:{code:-32021,message:'Modern MCP client capabilities required'}};
    }
    const rpc=(payload)=>({jsonrpc:'2.0',id:message.id,
      result:modern?{resultType:'complete',...payload,_meta:{...SERVER_META,...(record(payload._meta)?payload._meta:{})}}:payload});
    if(!modern&&message.method==='initialize'){
      const preferred=message.params?.protocolVersion;
      return rpc({protocolVersion:LEGACY_VERSIONS.includes(preferred)
          ?preferred:LEGACY_VERSIONS[0],
        capabilities:{tools:{}},serverInfo:SERVER_IDENTITY,
        instructions:'V2 candidate: OAuth user and independent owner-worker chat attestation are mandatory.'});
    }
    if(modern&&message.method==='server/discover'){
      return rpc({supportedVersions:[MODERN_VERSION],
        capabilities:{tools:{}},
        instructions:'V2 candidate requires verified OAuth and independently attested chat identity.',
        ttlMs:30000,cacheScope:'private'});
    }
    if(message.method==='tools/list'){
      return rpc({tools:[descriptor]});
    }
    if(message.method==='tools/call'){
      const params=message.params;
      const result=await call({
        authorization,toolName:params?.name,args:params?.arguments
      });
      return rpc(result);
    }
    return {jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}};
  }
  return Object.freeze({
    descriptor,
    protectedResource:auth.protectedResource,
    handleRpc,
    call
  });
}
