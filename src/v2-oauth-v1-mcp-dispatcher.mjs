// Candidate authenticated V2 MCP tool surface, not bound to the NoAuth
// MMZ pilot or a network listener. The protected ingress supplies a trusted
// Authorization header; model arguments can never nominate a host/chat/grant.
import {createV2McpOAuthContract} from './v2-mcp-oauth-contract.mjs';
import {createV2OAuthV1Parity,createV2OAuthV1NativeParity} from './v2-oauth-v1-parity.mjs';
const NAME='v2_v1_protected_call';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 [Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>record(v)&&Object.keys(v).length===keys.length&&
 Object.keys(v).every(k=>keys.includes(k));
export function createV2OAuthV1McpDispatcher({
 resource,authorizationServers,scopes=['commander.full'],
 ...privateServices
}={}){
 const auth=createV2McpOAuthContract({
  resource,authorizationServers,scopes,allowedTools:[NAME]
 });
 // Trusted owner-worker bootstrap may supply its native V1 loopback RPC
 // and OS peer attestor; never accept either from MCP input/headers. When
 // enabled, there is no prebuilt gateway injection path around native checks.
 const {nativeOwnerTransport,...trustedServices}=privateServices;
 let parity;
 if(nativeOwnerTransport===undefined){
  parity=createV2OAuthV1Parity({
   ...trustedServices,issuer:trustedServices.issuer,
   audience:trustedServices.audience,requiredScopes:scopes
  });
 }else{
  if(!record(nativeOwnerTransport)||
     Object.keys(nativeOwnerTransport).sort().join(',')!=='attestLocalOwner,rpc')
   fail('V2_PROTECTED_NATIVE_TRANSPORT_INVALID');
  parity=createV2OAuthV1NativeParity({
   ...trustedServices,rpc:nativeOwnerTransport.rpc,
   attestLocalOwner:nativeOwnerTransport.attestLocalOwner,
   issuer:trustedServices.issuer,audience:trustedServices.audience,
   requiredScopes:scopes
  });
 }
 const descriptor=auth.toolDescriptor({
  name:NAME,title:'V2 Authenticated V1-Equivalent Tool',
  description:'Run a currently-granted V1 action under the authenticated MMZ Linux owner, preserving V1 OS policies and native GUI consent.',
  inputSchema:{
   type:'object',properties:{
    tool:{type:'string',minLength:1,maxLength:80},
    arguments:{type:'object',additionalProperties:true}
   },required:['tool','arguments'],additionalProperties:false
  },
  annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}
 });
 async function call({authorization,args}={}){
  if(!exact(args,['tool','arguments'])||typeof args.tool!=='string'||!record(args.arguments))
   return {isError:true,content:[{type:'text',text:'V2_PROTECTED_INPUT_INVALID'}]};
  if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9._~+\/=:-]+$/.test(authorization))
   return auth.toolAuthRequired();
  try{
   const result=await parity.call({authorization,tool:args.tool,args:args.arguments});
   return {isError:result?.isError===true,
    content:result?.content??[{type:'text',text:'Authorized V1 tool returned.'}],
    ...(result?.structuredContent!==undefined
       ?{structuredContent:result.structuredContent}:{})};
  }catch(error){
   const c=String(error?.code??'');
   if(['V2_AUTH_PARITY_BEARER_REQUIRED','V2_AUTH_PARITY_TOKEN_NOT_AUTHORIZED',
      'V2_AUTH_PARITY_PRINCIPAL_UNVERIFIED'].includes(c)||
      c.startsWith('V2_JWT_')||c.startsWith('V2_JWKS_')||
      c.startsWith('V2_OAUTH_'))
    return auth.toolAuthRequired({error:'invalid_token'});
   // Do not echo secrets/arguments from exceptions.
   return {isError:true,content:[{type:'text',text:'V2_PROTECTED_ACTION_DENIED'}]};
  }
 }
 async function handleRpc({authorization,message}={}){
  if(!record(message)||message.jsonrpc!=='2.0'||!Object.hasOwn(message,'id')||
     typeof message.method!=='string')
   return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}};
  const id=message.id;
  if(message.method==='initialize')
   return {jsonrpc:'2.0',id,result:{protocolVersion:'2025-11-25',
    capabilities:{tools:{}},serverInfo:{name:'commander-v2-authenticated',version:'0.1.0'}}};
  if(message.method==='tools/list')
   return {jsonrpc:'2.0',id,result:{tools:[descriptor]}};
  if(message.method==='tools/call'){
   if(message.params?.name!==NAME)
    return {jsonrpc:'2.0',id,error:{code:-32602,message:'Unknown tool'}};
   return {jsonrpc:'2.0',id,result:await call({
    authorization,args:message.params?.arguments
   })};
  }
  return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
 }
 return Object.freeze({descriptor,protectedResource:auth.protectedResource,call,handleRpc});
}
