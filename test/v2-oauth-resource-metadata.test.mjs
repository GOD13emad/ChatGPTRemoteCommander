import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createV2ProtectedResourceMetadata } from '../src/v2-oauth-resource-metadata.mjs';

const base={resource:'https://commander.example.test/mcp',authorizationServers:['https://idp.example.test']};
test('MCP subpath protected resource metadata and Bearer challenge are exact',()=>{
 const m=createV2ProtectedResourceMetadata(base);
 assert.equal(m.metadataPath,'/.well-known/oauth-protected-resource/mcp');
 assert.equal(m.metadataUrl,'https://commander.example.test/.well-known/oauth-protected-resource/mcp');
 assert.equal(m.body.resource,base.resource);
 assert.deepEqual(m.body.authorization_servers,base.authorizationServers);
 assert.deepEqual(m.body.scopes_supported,['commander.workflow']);
 assert.equal(m.challenge,'Bearer resource_metadata="'+m.metadataUrl+'", scope="commander.workflow"');
});
test('nested MCP route stays inside same exact origin',()=>{
 const m=createV2ProtectedResourceMetadata({...base,resource:'https://commander.example.test/secure/api/mcp'});
 assert.equal(m.metadataPath,'/.well-known/oauth-protected-resource/secure/api/mcp');
});
test('issuer and resource must be HTTPS and have no credentials/query/fragment',()=>{
 for(const v of ['http://commander.example.test/mcp','https://u:p@commander.example.test/mcp',
   'https://commander.example.test/mcp?token=secret','https://commander.example.test/mcp#frag']){
   assert.throws(()=>createV2ProtectedResourceMetadata({...base,resource:v}),{code:'V2_RESOURCE_URI_INVALID'});
 }
 assert.throws(()=>createV2ProtectedResourceMetadata({...base,authorizationServers:['http://idp.example.test']}),{code:'V2_RESOURCE_URI_INVALID'});
});
test('no multiple, empty or untrusted authorization servers',()=>{
 for(const as of [[],['https://a.example','https://b.example']])
   assert.throws(()=>createV2ProtectedResourceMetadata({...base,authorizationServers:as}),{code:'V2_RESOURCE_AUTHORIZATION_SERVER_REQUIRED'});
});
test('scope header injection, duplicate and invalid scope rejected',()=>{
 for(const scopes of [[],['commander.workflow\r\nX-Evil:true'],['commander.workflow','commander.workflow'],[42]])
   assert.throws(()=>createV2ProtectedResourceMetadata({...base,scopes}),{code:'V2_RESOURCE_SCOPES_INVALID'});
});
test('isolated 401 challenge advertises metadata endpoint; protected tool not executed',async()=>{
 const m=createV2ProtectedResourceMetadata(base);
 let effects=0;
 const server=http.createServer((req,res)=>{
   if(req.url===m.metadataPath&&req.method==='GET'){
     res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(m.body));return;
   }
   res.writeHead(401,{'WWW-Authenticate':m.challenge}).end(); // intentionally no access token support in fixture
 });
 try{
   await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
   const port=server.address().port;
   const response=await fetch('http://127.0.0.1:'+port+'/mcp',{method:'POST'});
   assert.equal(response.status,401);
   assert.equal(response.headers.get('www-authenticate'),m.challenge);
   const meta=await fetch('http://127.0.0.1:'+port+m.metadataPath);
   assert.equal(meta.status,200);
   assert.deepEqual(await meta.json(),m.body);
   assert.equal(effects,0);
 }finally{await new Promise(ok=>server.close(ok));}
});
