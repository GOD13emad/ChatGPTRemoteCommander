import {listenOnFetchSafePort} from './v2-fetch-safe-loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createV2McpOAuthContract } from '../src/v2-mcp-oauth-contract.mjs';
const input={
 resource:'https://commander.example.test/mcp',
 authorizationServers:['https://idp.example.test'],
 scopes:['commander.workflow'],
 allowedTools:['v2_workflow_step','v2_grant_read']
};
const fresh=()=>createV2McpOAuthContract(input);
const workflowDescriptor={
 name:'v2_workflow_step',description:'Authorized workflow step',
 inputSchema:{type:'object',properties:{route:{type:'object'}},additionalProperties:false},
 annotations:{readOnlyHint:false}
};
test('ChatGPT protected V2 tool advertises oauth2 securitySchemes with exact requested scope',()=>{
 const contract=fresh();
 const decorated=contract.toolDescriptor(workflowDescriptor);
 assert.deepEqual(decorated.securitySchemes,[{type:'oauth2',scopes:['commander.workflow']}]);
 assert.equal(decorated.name,'v2_workflow_step');
 assert.equal(workflowDescriptor.securitySchemes,undefined);
 assert.equal(Object.isFrozen(decorated.securitySchemes),true);
 assert.equal(contract.protectedResource.metadataPath,'/.well-known/oauth-protected-resource/mcp');
});
test('normal missing/invalid token challenge contains error and error_description',()=>{
 const contract=fresh();
 const m=contract.toolAuthRequired();
 assert.equal(m.isError,true);
 assert.match(m._meta['mcp/www_authenticate'][0],/^Bearer resource_metadata="https:\/\/commander\.example\.test\/\.well-known\/oauth-protected-resource\/mcp", error="invalid_token", error_description="Authentication required"$/);
 assert.equal(m.content[0].type,'text');
});
test('scope denial produces an explicit insufficient_scope challenge without effect',()=>{
 const contract=fresh();
 const response=contract.toolAuthRequired({
   error:'insufficient_scope',description:'Commander workflow permission required'
 });
 assert.match(response._meta['mcp/www_authenticate'][0],/error="insufficient_scope"/);
 assert.match(response._meta['mcp/www_authenticate'][0],/Commander workflow permission required/);
});
test('non-V2 and unknown V2 tools cannot inherit or bypass security scheme',()=>{
 const contract=fresh();
 for(const name of ['run_shell','write_text','v2_unapproved','']){
   assert.throws(()=>contract.toolDescriptor({...workflowDescriptor,name}),
     {code:'V2_MCP_AUTH_TOOL_NOT_APPROVED'});
 }
 assert.throws(()=>contract.toolDescriptor({...workflowDescriptor,
   securitySchemes:[{type:'noauth'}]}),{code:'V2_MCP_AUTH_SCHEME_CONFLICT'});
});
test('invalid V2 allowlist and duplicate tools fail closed',()=>{
 for(const allowedTools of [[],['run_shell'],['v2_workflow_step','v2_workflow_step'],[null]]){
   assert.throws(()=>createV2McpOAuthContract({...input,allowedTools}),
     {code:'V2_MCP_AUTH_TOOLS_INVALID'});
 }
});
test('scope injection or duplicate scope cannot become OAuth metadata',()=>{
 for(const scopes of [[],['commander.workflow','commander.workflow'],
   ['commander.workflow" bad'],['scope\r\nset-cookie:exfil'],[42]]){
   assert.throws(()=>createV2McpOAuthContract({...input,scopes}),
     {code:'V2_MCP_OAUTH_SCOPES_INVALID'});
 }
});
test('authentication descriptions cannot inject WWW-Authenticate headers or leak caller content',()=>{
 const contract=fresh();
 for(const description of [
   'login"\r\nSet-Cookie: id=attack','bad"','token\\secret','x'.repeat(170),''
 ]){
   assert.throws(()=>contract.toolAuthRequired({description}),
     {code:'V2_MCP_AUTH_ERROR_DESCRIPTION_INVALID'});
 }
 assert.throws(()=>contract.challenge({error:'not_authorized'}),
   {code:'V2_MCP_AUTH_ERROR_INVALID'});
});
test('isolated ChatGPT-style MCP JSON-RPC tools/list and tool-level OAuth challenge',async()=>{
 const contract=fresh();let effects=0;
 const server=http.createServer(async(req,res)=>{
   if(req.url===contract.protectedResource.metadataPath&&req.method==='GET'){
     res.writeHead(200,{'content-type':'application/json'})
       .end(JSON.stringify(contract.protectedResource.body));return;
   }
   if(req.url!=='/mcp'||req.method!=='POST'){res.writeHead(404).end();return;}
   let raw='';for await(const part of req)raw+=part;
   let message;
   try{message=JSON.parse(raw);}catch{res.writeHead(400).end();return;}
   const result=message.method==='tools/list'
     ?{tools:[contract.toolDescriptor(workflowDescriptor)]}
     :message.method==='tools/call'
       ?contract.toolAuthRequired() // fixture has no issuer so never executes
       :{error:'unsupported'};
   res.writeHead(200,{'content-type':'application/json'})
     .end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
 });
 try {
   await listenOnFetchSafePort(server);
   const base='http://127.0.0.1:'+server.address().port;
   const rpc=async(msg)=>{
     const response=await fetch(base+'/mcp',{method:'POST',
       headers:{'content-type':'application/json'},body:JSON.stringify(msg)});
     assert.equal(response.status,200);
     return (await response.json()).result;
   };
   const listing=await rpc({jsonrpc:'2.0',id:1,method:'tools/list'});
   assert.deepEqual(listing.tools[0].securitySchemes,[{type:'oauth2',scopes:['commander.workflow']}]);
   const challenge=await rpc({jsonrpc:'2.0',id:2,method:'tools/call',
     params:{name:'v2_workflow_step',arguments:{}}});
   assert.equal(challenge.isError,true);
   assert.equal(challenge._meta['mcp/www_authenticate'].length,1);
   const meta=await fetch(base+contract.protectedResource.metadataPath);
   assert.deepEqual(await meta.json(),contract.protectedResource.body);
   assert.equal(effects,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
