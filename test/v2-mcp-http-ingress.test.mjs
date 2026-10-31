import {listenOnFetchSafePort} from './v2-fetch-safe-loopback.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createV2CandidateHttpIngress, createV2CandidateDirectHttpsGateway } from '../src/v2-mcp-http-ingress.mjs';
import { createV2McpOAuthContract } from '../src/v2-mcp-oauth-contract.mjs';

const resource='https://commander.example.test/mcp-v2';
const issuer='https://idp.example.test';
const contract=createV2McpOAuthContract({
 resource,authorizationServers:[issuer],allowedTools:['v2_workflow_step']
});
const input={
 resource,authorizationServers:[issuer]
};
const msg=(method='tools/call')=>({
 jsonrpc:'2.0',id:4,method,
 params:{name:'v2_workflow_step',arguments:{
  tool:'write_text',arguments:{path:'not-executed'},stepId:'write',expectedRevision:1
 }}
});
const meta=contract.protectedResource.metadataPath;
let lookups=0,sideEffects=0,attestorCalls=0,clientVerified=false,session='trusted-chat-a';
const factory=async(trustedContext)=>{
 lookups++;
 assert.equal(Object.keys(trustedContext).sort().join(','),'authenticated,sessionHandle');
 assert.equal(trustedContext.authenticated,true);
 return {
  protectedResource:contract.protectedResource,
  async handleRpc({authorization,message}){
   if(message.method==='tools/list'){
    return {jsonrpc:'2.0',id:message.id,
     result:{tools:[contract.toolDescriptor({
      name:'v2_workflow_step',inputSchema:{type:'object'}
     })]}};
   }
   if(message.method==='tools/call'){
    return {jsonrpc:'2.0',id:message.id,
     result:!authorization
      ?contract.toolAuthRequired()
      :{isError:true,content:[{type:'text',text:'NO_TRUSTED_IDP_CONFIGURED'}]}};
   }
   return null;
  }
 };
};
function fixture(overrides={}){
 lookups=0;sideEffects=0;attestorCalls=0;clientVerified=false;session='trusted-chat-a';
 const ingress=createV2CandidateHttpIngress({
  ...input,
  attestTransport:async()=>{attestorCalls++;
   return {authenticated:clientVerified,sessionHandle:session};
  },
  dispatcherFactory:factory,...overrides
 });
 return ingress;
}
async function withServer(ingress,cb){
 const server=ingress.createUnboundServer();
 try{
  assert.equal(server.listening,false);
  await listenOnFetchSafePort(server);
  return await cb('http://127.0.0.1:'+server.address().port);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function rpc(base,message=msg(),headers={}){
 const response=await fetch(base+'/mcp-v2',{method:'POST',headers:{
   'content-type':'application/json',...headers
 },body:JSON.stringify(message)});
 return {status:response.status,body:await response.json(),headers:response.headers};
}
test('missing trusted transport bootstrap is rejected at construction',()=>{
 assert.throws(()=>createV2CandidateHttpIngress({...input,dispatcherFactory:factory}),
  {code:'V2_HTTP_TRUSTED_BOOTSTRAP_REQUIRED'});
 assert.throws(()=>createV2CandidateHttpIngress({...input,attestTransport:()=>({})}),
  {code:'V2_HTTP_TRUSTED_BOOTSTRAP_REQUIRED'});
});
test('resource metadata is public but never starts or exposes a write tool',async()=>{
 const ingress=fixture();
 await withServer(ingress,async(base)=>{
  const metadata=await fetch(base+meta);
  assert.equal(metadata.status,200);
  assert.deepEqual(await metadata.json(),contract.protectedResource.body);
  assert.equal(lookups,0);assert.equal(attestorCalls,0);
  const missing=await fetch(base+'/nonexistent');
  assert.equal(missing.status,404);
  const query=await fetch(base+'/mcp-v2?route=chat-b');
  assert.equal(query.status,404);
  assert.equal(sideEffects,0);
 });
});
test('without authenticated client certificate/proxy claim MCP is inaccessible',async()=>{
 const ingress=fixture();
 await withServer(ingress,async(base)=>{
  const a=await rpc(base);
  assert.equal(a.status,403);
  assert.equal(a.body.error,'trusted_transport_required');
  assert.equal(lookups,0);
  assert.equal(sideEffects,0);
 });
});
test('spoofed chat/transport headers cannot create a trusted request',async()=>{
 const ingress=fixture();
 await withServer(ingress,async(base)=>{
  const a=await rpc(base,msg(),{'x-openai-session':'trusted-chat-a',
   'x-chat-id':'trusted-chat-a','x-mtls-verified':'true',
   authorization:'Bearer attacker-data'});
  assert.equal(a.status,403);
  assert.equal(lookups,0);
 });
});
test('trusted transport with no OAuth bearer returns ChatGPT linking challenge',async()=>{
 const ingress=fixture();clientVerified=true;
 await withServer(ingress,async(base)=>{
  const a=await rpc(base);
  assert.equal(a.status,200);
  assert.equal(a.body.result.isError,true);
  assert.ok(a.body.result._meta['mcp/www_authenticate'][0].includes('invalid_token'));
  const list=await rpc(base,msg('tools/list'));
  assert.equal(list.status,200);
  assert.deepEqual(list.body.result.tools[0].securitySchemes,
   [{type:'oauth2',scopes:['commander.workflow']}]);
  assert.equal(sideEffects,0);
 });
});
test('informational openai/session cannot override attested transport session',async()=>{
 const ingress=fixture();clientVerified=true;
 await withServer(ingress,async(base)=>{
  const changed=msg();
  changed.params._meta={'openai/session':'forged-chat-b'};
  const a=await rpc(base,changed);
  assert.equal(a.status,403);
  assert.equal(a.body.error,'platform_session_mismatch');
  assert.equal(lookups,0);
  changed.params._meta['openai/session']='trusted-chat-a';
  const valid=await rpc(base,changed);
  assert.equal(valid.status,200);
  assert.equal(lookups,1);
 });
});
test('modern MCP method, name, protocol and session checks precede dispatch',async()=>{
 const ingress=fixture();clientVerified=true;
 const m=msg();
 m.params._meta={
   'io.modelcontextprotocol/protocolVersion':'2026-07-28',
   'io.modelcontextprotocol/clientCapabilities':{},
   'openai/session':'trusted-chat-a'
 };
 await withServer(ingress,async(base)=>{
  const good=await rpc(base,m,{
    'mcp-protocol-version':'2026-07-28',
    'mcp-method':'tools/call','mcp-name':'v2_workflow_step'});
  assert.equal(good.status,200);
  const wrong=await rpc(base,m,{
    'mcp-protocol-version':'2026-07-28',
    'mcp-method':'tools/list','mcp-name':'v2_workflow_step'});
  assert.equal(wrong.status,400);
  assert.equal(wrong.body.error,'protocol_method_mismatch');
  const version=await rpc(base,m,{'mcp-protocol-version':'2025-11-25'});
  assert.equal(version.status,400);
  assert.equal(version.body.error,'protocol_version_mismatch');
  assert.equal(lookups,1);
  assert.equal(sideEffects,0);
 });
});
test('bounded HTTP JSON body rejects large bodies, wrong content-type and bad JSON',async()=>{
 const ingress=fixture({maxBodyBytes:2048});clientVerified=true;
 await withServer(ingress,async(base)=>{
  const huge=await rpc(base,msg(),{});
  assert.equal(huge.status,200);
  const over=await fetch(base+'/mcp-v2',{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({blob:'x'.repeat(2200)})});
  assert.equal(over.status,413);
  const wrong=await fetch(base+'/mcp-v2',{method:'POST',
    headers:{'content-type':'text/plain'},body:'{}'});
  assert.equal(wrong.status,415);
  const malformed=await fetch(base+'/mcp-v2',{method:'POST',
    headers:{'content-type':'application/json'},body:'not-json'});
  assert.equal(malformed.status,400);
  assert.equal(sideEffects,0);
 });
});
test('duplicate Authorization headers are rejected without calling dispatcher',async()=>{
 const ingress=fixture();clientVerified=true;
 await withServer(ingress,async(base)=>{
  const u=new URL(base+'/mcp-v2');
  const result=await new Promise((resolve,reject)=>{
    const req=http.request({
      hostname:u.hostname,port:u.port,path:u.pathname,method:'POST',
      headers:['Content-Type','application/json','Authorization','Bearer aaaa',
        'Authorization','Bearer bbbb']
    },res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{
        resolve({status:res.statusCode,
          body:(()=>{const text=Buffer.concat(chunks).toString('utf8');return text?JSON.parse(text):{};})()});
      });
    });
    req.on('error',reject);req.end(JSON.stringify(msg()));
  });
  assert.equal(result.status,400,JSON.stringify(result));
  // Node's HTTP parser may reject duplicate Authorization headers before our handler.
  // Both a parser-level blank 400 and our JSON 400 must fail closed.
  assert.ok(result.body.error===undefined||result.body.error==='duplicate_header',JSON.stringify(result));
  assert.equal(lookups,0);
 });
});
test('missing or failed trusted owner dispatcher does not reveal internal errors',async()=>{
 const ingress=fixture({dispatcherFactory:async()=>{throw new Error('SECRET_INTERNAL_ERROR')}});
 clientVerified=true;
 await withServer(ingress,async(base)=>{
  const a=await rpc(base);
  assert.equal(a.status,503);
  assert.equal(a.body.error,'candidate_unavailable');
  assert.equal(JSON.stringify(a.body).includes('SECRET_INTERNAL_ERROR'),false);
  assert.equal(sideEffects,0);
 });
});


test('legacy MCP protocol header without modern body metadata remains supported',async()=>{
 const ingress=fixture();clientVerified=true;
 await withServer(ingress,async(base)=>{
  const legacy=await rpc(base,msg('tools/list'),{'mcp-protocol-version':'2025-11-25'});
  assert.equal(legacy.status,200);
  assert.equal(legacy.body.result.tools.length,1);
  const forgedModern=await rpc(base,msg('tools/list'),{'mcp-protocol-version':'2026-07-28'});
  assert.equal(forgedModern.status,400);
  assert.equal(forgedModern.body.error,'protocol_version_mismatch');
 });
});
test('proxy-style absolute-form HTTP targets are rejected before transport attestation',async()=>{
 const ingress=fixture();
 await withServer(ingress,async(base)=>{
  const addr=new URL(base);
  const r=await new Promise((resolve,reject)=>{
    const request=http.request({hostname:addr.hostname,port:addr.port,method:'POST',
      path:'https://attacker.example/mcp-v2',
      headers:{'content-type':'application/json'}},response=>{
       let value='';response.on('data',b=>value+=b);
       response.on('end',()=>resolve({status:response.statusCode,value}));
      });
    request.on('error',reject);request.end(JSON.stringify(msg()));
  });
  assert.equal(r.status,400);
  assert.deepEqual(JSON.parse(r.value),{error:'invalid_request_target'});
  assert.equal(attestorCalls,0);
 });
});

// verified mTLS metadata

test('verified ChatGPT mTLS may use documented openai/session only for tool calls',async()=>{
 const read=[];
 const ingress=fixture({
  attestTransport:async()=>({
   authenticated:true,peerType:'openai-chatgpt-mtls',
   sessionSource:'openai/session'
  }),
  dispatcherFactory:async(ctx)=>{
   read.push(ctx.sessionHandle);
   return factory(ctx);
  }
 });
 await withServer(ingress,async(base)=>{
  const listing=await rpc(base,msg('tools/list'));
  assert.equal(listing.status,200);
  assert.equal(read[0],'mcp-discovery-only');
  const missing=await rpc(base,msg());
  assert.equal(missing.status,403);
  assert.equal(missing.body.error,'platform_session_required');
  const c=msg();
  c.params._meta={'openai/session':'attested-platform-chat-a'};
  const a=await rpc(base,c);
  assert.equal(a.status,200);
  assert.equal(read[1],'attested-platform-chat-a');
  c.params._meta['openai/session']='attested-platform-chat-b';
  const b=await rpc(base,c);
  assert.equal(b.status,200);
  assert.equal(read[2],'attested-platform-chat-b');
  assert.equal(sideEffects,0);
 });
});
test('untrusted HTTP caller cannot self-declare platform-metadata mode',async()=>{
 const ingress=fixture({
  attestTransport:async()=>({authenticated:true,
    sessionSource:'openai/session',sessionHandle:'fake'})
 });
 await withServer(ingress,async(base)=>{
  const c=msg();c.params._meta={'openai/session':'untrusted-chat'};
  const response=await rpc(base,c,{'x-mtls-verified':'true'});
  assert.equal(response.status,403);
  assert.equal(response.body.error,'trusted_transport_required');
  assert.equal(lookups,0);
 });
});
test('injected body/headers cannot replace platform-owned tool-call metadata',async()=>{
 const ingress=fixture({
  attestTransport:async()=>({authenticated:true,
    peerType:'openai-chatgpt-mtls',sessionSource:'openai/session'})
 });
 await withServer(ingress,async(base)=>{
  const c=msg();
  c.params.arguments.conversationId='forged-chat';
  const response=await rpc(base,c,{'openai-session':'forged-chat','x-chat-id':'forged-chat'});
  assert.equal(response.status,403);
  assert.equal(response.body.error,'platform_session_required');
  assert.equal(lookups,0);
 });
});

test('direct HTTPS candidate composition requires pinned mTLS and owner TLS identity',()=>{
 const base={resource:'https://commander.example.test/mcp-v2',
  authorizationServers:['https://issuer.example.test'],dispatcherFactory:factory};
 assert.throws(()=>createV2CandidateDirectHttpsGateway(base),
  {code:'V2_HTTPS_SERVER_IDENTITY_REQUIRED'});
 assert.throws(()=>createV2CandidateDirectHttpsGateway({...base,
  certificatePem:'-----BEGIN CERTIFICATE-----\\nfixture',
  privateKeyPem:'-----BEGIN PRIVATE KEY-----\\nfixture',
  sessionSource:'native-owner'}),
  {code:'V2_MTLS_OPERATOR_CONFIGURATION_REQUIRED'});
 const candidate=createV2CandidateDirectHttpsGateway({...base,
  certificatePem:'-----BEGIN CERTIFICATE-----\\nfixture',
  privateKeyPem:'-----BEGIN PRIVATE KEY-----\\nfixture'});
 assert.equal(candidate.requiredTransport,'direct-openai-mtls');
 assert.equal(candidate.createUnboundServer,undefined);
 assert.equal(typeof candidate.createUnboundTlsServer,'function');
 assert.equal(candidate.protectedResource.body.resource,base.resource);
 assert.equal(Object.isFrozen(candidate),true);
 // A fabricated TLS identity cannot create a usable listener; the real key
 // and certificate must come from an owner-controlled secret store.
 assert.throws(()=>candidate.createUnboundTlsServer());
});

test('mTLS profile discovery without platform chat binding never authorizes a workflow',async()=>{
 const seen=[];
 const ingress=fixture({
  attestTransport:async()=>({
   authenticated:true,peerType:'openai-chatgpt-mtls',sessionSource:'openai/session'
  }),
  dispatcherFactory:async ctx=>{
   seen.push(ctx.sessionHandle);
   return factory(ctx);
  }
 });
 await withServer(ingress,async base=>{
  const profile=msg();
  profile.params.name='v2_profile';profile.params.arguments={};
  const first=await rpc(base,profile);
  assert.equal(first.status,200);
  assert.equal(seen[0],'mcp-profile-only');
  assert.equal(first.body.result.isError,true);
  const workflow=await rpc(base,msg());
  assert.equal(workflow.status,403);
  assert.equal(workflow.body.error,'platform_session_required');
  const forged=msg();
  forged.params.name='v2_profile';
  forged.params.arguments={tool:'write_text'};
  const other=await rpc(base,forged);
  assert.equal(other.status,200);
  assert.equal(sideEffects,0);
 });
});
