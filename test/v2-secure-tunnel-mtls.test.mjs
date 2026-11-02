import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {listenOnFetchSafePort} from './v2-fetch-safe-loopback.mjs';
import {createV2SyntheticTunnelFixture} from './v2-synthetic-tunnel-test-fixtures.mjs';
import {createV2SecureTunnelServerTlsOptions,
  createV2SecureTunnelClientMtlsAttestor} from '../src/v2-secure-tunnel-mtls.mjs';
import {createV2CandidateSecureTunnelHttpsGateway} from '../src/v2-mcp-http-ingress.mjs';
import {createV2AuthenticatedOwnerGateway} from '../src/v2-authenticated-owner-gateway.mjs';
import {createV2ProtectedResourceMetadata} from '../src/v2-oauth-resource-metadata.mjs';

const fixture=createV2SyntheticTunnelFixture();
const caPem=readFileSync(join(fixture,'ca.pem'),'utf8');
const serverCertPem=readFileSync(join(fixture,'server-cert.pem'),'utf8');
const clientCertPem=readFileSync(join(fixture,'client-cert.pem'),'utf8');
const fixtureKeys=JSON.parse(readFileSync(join(fixture,'test-only-keys.json'),'utf8'));
if(fixtureKeys.schema!==1||fixtureKeys.purpose!=='synthetic-only-test-fixture'||fixtureKeys.notForDeployment!==true)throw Error('TEST_KEY_FIXTURE_INVALID');
const serverKeyPem=Buffer.from(fixtureKeys.serverPrivateKeyPemBase64,'base64').toString('utf8');
const clientKeyPem=Buffer.from(fixtureKeys.clientPrivateKeyPemBase64,'base64').toString('utf8');
const caDer=new X509Certificate(caPem).raw;
const clientDer=new X509Certificate(clientCertPem).raw;
const hash=b=>createHash('sha256').update(b).digest('hex');
const caSha=hash(caDer),clientSha=hash(clientDer);
const resource='https://commander-v2.example.test/mcp-v2';
const issuer='https://issuer.example.test';
const prmd=createV2ProtectedResourceMetadata({
 resource,authorizationServers:[issuer],scopes:['commander.workflow']
});
const fakeNow=Date.now;

function peer(changes={},socketChanges={}){
 return {socket:{
  encrypted:true,authorized:true,getProtocol:()=> 'TLSv1.3',
  getPeerCertificate:()=>({
   raw:Buffer.from(clientDer),
   issuerCertificate:{raw:Buffer.from(caDer)},
   subjectaltname:'DNS:commander-v2-tunnel-client',
   ext_key_usage:['1.3.6.1.5.5.7.3.2'],
   valid_from:'Oct 20 00:00:00 2026 GMT',
   valid_to:'Nov 20 00:00:00 2036 GMT',
   ...changes
  }),...socketChanges
 }};
}
function makeAttestor(overrides={}){
 return createV2SecureTunnelClientMtlsAttestor({
  clientCaDerSha256:caSha,clientCertificateSha256:clientSha,
  now:fakeNow,...overrides
 });
}
function request(base,path,{client=true,method='GET',headers={},body}={}){
 const u=new URL(base+path);
 return new Promise((resolve,reject)=>{
  const req=https.request({
   hostname:'127.0.0.1',port:Number(u.port),path:u.pathname,method,
   ca:caPem,servername:'localhost',
   ...(client?{cert:clientCertPem,key:clientKeyPem}:{}),headers
  },res=>{
   const chunks=[];res.on('data',b=>chunks.push(b));
   res.on('end',()=>{
    const text=Buffer.concat(chunks).toString('utf8');let parsed;
    try{parsed=JSON.parse(text);}catch{parsed=text;}
    resolve({status:res.statusCode,body:parsed,headers:res.headers});
   });
  });
  req.on('error',reject);req.end(body);
 });
}

test('only the exact owner-pinned tunnel-client mTLS leaf can attest the forwarded session namespace',async()=>{
 const attest=makeAttestor();
 const result=await attest(peer());
 assert.deepEqual(result,{
  authenticated:true,peerType:'openai-secure-mcp-tunnel',
  sessionSource:'openai/session'
 });
});
test('ordinary HTTP, missing client cert, wrong CA, wrong leaf, SAN and EKU all fail closed',async()=>{
 const attest=makeAttestor();
 for(const q of [
  peer({}, {encrypted:false}),
  peer({}, {authorized:false}),
  peer({}, {getProtocol:()=> 'TLSv1.1'}),
  peer({}, {getPeerCertificate:()=>null}),
  peer({raw:Buffer.from('attacker-leaf')}),
  peer({issuerCertificate:{raw:Buffer.from('attacker-ca')}}),
  peer({subjectaltname:'DNS:attacker.example.test'}),
  peer({ext_key_usage:['1.3.6.1.5.5.7.3.1']})
 ]){
  assert.deepEqual(await attest(q),{authenticated:false});
 }
});
test('client certificate validity window and exact configured pins are enforced',async()=>{
 const attest=makeAttestor();
 assert.deepEqual(await attest(peer({valid_to:'Oct 30 00:00:00 2026 GMT'})),
  {authenticated:false});
 assert.deepEqual(await attest(peer({valid_from:'Nov 20 00:00:00 2026 GMT'})),
  {authenticated:false});
 assert.throws(()=>makeAttestor({clientCaDerSha256:'bad'}),
  {code:'V2_SECURE_TUNNEL_CA_PIN_REQUIRED'});
 assert.throws(()=>makeAttestor({clientCertificateSha256:'bad'}),
  {code:'V2_SECURE_TUNNEL_CLIENT_CERT_PIN_REQUIRED'});
});
test('HTTPS server requires a pinned private CA and a matching localhost server identity',()=>{
 const options=createV2SecureTunnelServerTlsOptions({
  serverCertificatePem:serverCertPem,serverPrivateKeyPem:serverKeyPem,
  clientCaPem:caPem,clientCaDerSha256:caSha,expectedServerDns:'localhost',now:fakeNow()
 });
 assert.equal(options.requestCert,true);
 assert.equal(options.rejectUnauthorized,true);
 assert.equal(options.minVersion,'TLSv1.2');
 assert.deepEqual(options.ca,[caPem]);
 assert.throws(()=>createV2SecureTunnelServerTlsOptions({
  serverCertificatePem:serverCertPem,serverPrivateKeyPem:serverKeyPem,
  clientCaPem:caPem,clientCaDerSha256:'0'.repeat(64),now:fakeNow()
 }),{code:'V2_SECURE_TUNNEL_CA_UNTRUSTED'});
 assert.throws(()=>createV2SecureTunnelServerTlsOptions({
  serverCertificatePem:serverCertPem,serverPrivateKeyPem:clientKeyPem,
  clientCaPem:caPem,clientCaDerSha256:caSha,now:fakeNow()
 }),{code:'V2_SECURE_TUNNEL_SERVER_KEY_MISMATCH'});
 assert.throws(()=>createV2SecureTunnelServerTlsOptions({
  serverCertificatePem:serverCertPem,serverPrivateKeyPem:serverKeyPem,
  clientCaPem:undefined,clientCaDerSha256:caSha,now:fakeNow()
 }),{code:'V2_SECURE_TUNNEL_CA_INVALID'});
});
test('real local HTTPS mTLS handshake admits only the pinned tunnel-client and keeps OAuth/session gates distinct',async()=>{
 const received=[];
 const gateway=createV2CandidateSecureTunnelHttpsGateway({
  resource,authorizationServers:[issuer],clientCaPem:caPem,clientCaDerSha256:caSha,
  clientCertificateSha256:clientSha,serverCertificatePem:serverCertPem,
  serverPrivateKeyPem:serverKeyPem,dispatcherFactory:async context=>{
   assert.equal(context.authenticated,true);
   received.push({session:context.sessionHandle});
   return {
    protectedResource:prmd,
    async handleRpc({authorization,message}){
     received.push({authorizationPresent:typeof authorization==='string',
      method:message.method});
     return {jsonrpc:'2.0',id:message.id,result:{accepted:true}};
    }
   };
  }
 });
 assert.equal(gateway.requiredTransport,'openai-secure-mcp-tunnel-client-mtls');
 const server=gateway.createUnboundTlsServer();
 try{
  await listenOnFetchSafePort(server);
  const base='https://localhost:'+server.address().port;
  const metadata=await request(base,prmd.metadataPath);
  assert.equal(metadata.status,200);
  assert.deepEqual(metadata.body,prmd.body);
  await assert.rejects(()=>request(base,'/mcp-v2',{client:false,method:'POST',
   headers:{'content-type':'application/json'},body:'{}'}));
  const missingSession=await request(base,'/mcp-v2',{method:'POST',
   headers:{'content-type':'application/json',authorization:'Bearer test-access-token'},
   body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',
    params:{name:'v2_workflow_step',arguments:{},_meta:{}}})
  });
  assert.equal(missingSession.status,403);
  assert.equal(missingSession.body.error,'platform_session_required');
  const accepted=await request(base,'/mcp-v2',{method:'POST',
   headers:{'content-type':'application/json',authorization:'Bearer test-access-token'},
   body:JSON.stringify({jsonrpc:'2.0',id:4,method:'tools/call',
    params:{name:'v2_workflow_step',arguments:{},_meta:{'openai/session':'chat-fixture-1'}}})
  });
  assert.equal(accepted.status,200);
  assert.deepEqual(accepted.body.result,{accepted:true});
  assert.equal(received[0].session,'chat-fixture-1');
  assert.deepEqual(received[1],{authorizationPresent:true,method:'tools/call'});
}finally{
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
});


test('owner gateway exposes the secure-tunnel transport as an unbound, OAuth-gated V2 mode',()=>{
 const issuer='https://issuer.example.test';
 const resource='https://commander-v2.example.test/mcp-v2';
 const providerMetadata={
  issuer,authorization_endpoint:issuer+'/authorize',
  token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',
  response_types_supported:['code'],grant_types_supported:['authorization_code'],
  code_challenge_methods_supported:['S256'],scopes_supported:['commander.workflow'],
  token_endpoint_auth_methods_supported:['none'],
  client_id_metadata_document_supported:true
 };
 let effects=0;
 const gateway=createV2AuthenticatedOwnerGateway({
  resource,issuer,providerMetadata,clientRegistration:'client-id-metadata',
  transportMode:'openai-secure-mcp-tunnel',
  serverCertificatePem:serverCertPem,serverPrivateKeyPem:serverKeyPem,
  clientCaPem:caPem,clientCaDerSha256:caSha,
  clientCertificateSha256:clientSha,
  assertionTrust:{},workflowStore:{},grantRegistry:{},
  resolvePrincipal:async()=> 'owner',
  observedNativeSession:async()=> 'owner-seat',
  resolveTrustedInvocation:async()=>{effects++;return null;},
  authorizeTool:async()=>false,
  dispatch:async()=>{effects++;return null;}
 });
 assert.equal(gateway.status,'V2_SOURCE_WIRED_NOT_LISTENING');
 assert.equal(gateway.requiredTransport,'openai-secure-mcp-tunnel-client-mtls');
 assert.equal(gateway.issuer,issuer);
 assert.equal(gateway.protectedResource.body.resource,resource);
 assert.equal(typeof gateway.createUnboundTlsServer,'function');
 assert.equal(effects,0);
 assert.throws(()=>createV2AuthenticatedOwnerGateway({
  resource,issuer,providerMetadata,clientRegistration:'client-id-metadata',
  transportMode:'invalid-transport-mode',
  assertionTrust:{},workflowStore:{},grantRegistry:{},
  resolvePrincipal:async()=> 'owner',observedNativeSession:async()=> 'seat',
  resolveTrustedInvocation:async()=>null,authorizeTool:async()=>false,
  dispatch:async()=>null
 }),{code:'V2_OWNER_TRANSPORT_MODE_UNSUPPORTED'});
 assert.equal(effects,0);
});

// Integration gate: the production composition must reject missing/forged
// OAuth independently of a genuine local tunnel-client TLS handshake.
// This uses only synthetic fixture identities and an ephemeral loopback port.
test('pinned tunnel mTLS never substitutes for OAuth or native owner consent',async()=>{
 const providerMetadata={
  issuer,authorization_endpoint:issuer+'/authorize',
  token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',
  response_types_supported:['code'],grant_types_supported:['authorization_code'],
  code_challenge_methods_supported:['S256'],scopes_supported:['commander.workflow'],
  token_endpoint_auth_methods_supported:['none'],
  client_id_metadata_document_supported:true,
  authorization_response_iss_parameter_supported:true
 };
 let ownerEffects=0,principalReads=0,jwksRequests=0;
 const gateway=createV2AuthenticatedOwnerGateway({
  resource,issuer,providerMetadata,transportMode:'openai-secure-mcp-tunnel',
  serverCertificatePem:serverCertPem,serverPrivateKeyPem:serverKeyPem,
  clientCaPem:caPem,clientCaDerSha256:caSha,clientCertificateSha256:clientSha,
  assertionTrust:{},workflowStore:{},grantRegistry:{},
  resolvePrincipal:async()=>{principalReads++;return 'owner';},
  observedNativeSession:async()=>{ownerEffects++;return 'owner-seat';},
  resolveTrustedInvocation:async()=>{ownerEffects++;return null;},
  authorizeTool:async()=>{ownerEffects++;return false;},
  dispatch:async()=>{ownerEffects++;return null;},
  request:async()=>{jwksRequests++;throw Error('NO_TEST_IDP_NETWORK');}
 });
 const server=gateway.createUnboundTlsServer();
 try{
  await listenOnFetchSafePort(server);
  const base='https://localhost:'+server.address().port;
  const listed=await request(base,'/mcp-v2',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/list',params:{}})
  });
  assert.equal(listed.status,200);
  assert.equal(listed.body.result.tools.some(t=>t.name==='v2_workflow_step'),true);
  const body=JSON.stringify({
   jsonrpc:'2.0',id:11,method:'tools/call',
   params:{name:'v2_workflow_step',
    arguments:{tool:'read_file',arguments:{},stepId:'step-a',expectedRevision:1},
    _meta:{'openai/session':'chat-test-only'}}
  });
  for(const auth of [undefined,'Bearer counterfeit-jwt']){
   const headers={'content-type':'application/json'};
   if(auth)headers.authorization=auth;
   const result=await request(base,'/mcp-v2',{method:'POST',headers,body});
   assert.equal(result.status,200);
   assert.equal(result.body.result.isError,true);
   assert.ok(result.body.result._meta?.['mcp/www_authenticate']);
  }
  assert.equal(ownerEffects,0);
  assert.equal(principalReads,0);
  assert.equal(jwksRequests,0);
 }finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
 }
});


// Official tunnel-client preserves X-Openai-Session and X-Openai-Subject
// from connector commands when forwarding to the configured MCP origin.
// The secure-tunnel route accepts those headers only behind pinned local mTLS.
test('secure tunnel binds forwarded ChatGPT session headers and rejects metadata mismatches',async()=>{
 const received=[];
 const gateway=createV2CandidateSecureTunnelHttpsGateway({
  resource,authorizationServers:[issuer],clientCaPem:caPem,clientCaDerSha256:caSha,
  clientCertificateSha256:clientSha,serverCertificatePem:serverCertPem,
  serverPrivateKeyPem:serverKeyPem,dispatcherFactory:async context=>{
   received.push(context.sessionHandle);
   return {protectedResource:prmd,async handleRpc(){
    return {jsonrpc:'2.0',id:7,result:{accepted:true}};
   }};
  }
 });
 const server=gateway.createUnboundTlsServer();
 try{
  await listenOnFetchSafePort(server);
  const base='https://localhost:'+server.address().port;
  const body=JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',
   params:{name:'v2_workflow_step',arguments:{stepId:'step-a',expectedRevision:1}}});
  const forwarded=await request(base,'/mcp-v2',{method:'POST',headers:{
   'content-type':'application/json','authorization':'Bearer test-access-token',
   'x-openai-session':'chat-forwarded-1','x-openai-subject':'subject-forwarded-1'
  },body});
  assert.equal(forwarded.status,200,JSON.stringify(forwarded.body));
  assert.deepEqual(forwarded.body.result,{accepted:true});
  assert.deepEqual(received,['chat-forwarded-1']);
  const mismatch=await request(base,'/mcp-v2',{method:'POST',headers:{
   'content-type':'application/json','authorization':'Bearer test-access-token',
   'x-openai-session':'chat-forwarded-2'
  },body:JSON.stringify({jsonrpc:'2.0',id:8,method:'tools/call',
   params:{name:'v2_workflow_step',arguments:{},
    _meta:{'openai/session':'chat-body-different'}}})});
  assert.equal(mismatch.status,403);
  assert.equal(mismatch.body.error,'platform_session_mismatch');
  const subjectMismatch=await request(base,'/mcp-v2',{method:'POST',headers:{
   'content-type':'application/json','authorization':'Bearer test-access-token',
   'x-openai-session':'chat-forwarded-3','x-openai-subject':'subject-header'
  },body:JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/call',
   params:{name:'v2_workflow_step',arguments:{},
    _meta:{'openai/session':'chat-forwarded-3','openai/subject':'subject-body'}}})});
  assert.equal(subjectMismatch.status,403);
  assert.equal(subjectMismatch.body.error,'platform_subject_mismatch');
  const missing=await request(base,'/mcp-v2',{method:'POST',headers:{
   'content-type':'application/json','authorization':'Bearer test-access-token'
  },body});
  assert.equal(missing.status,403);
  assert.equal(missing.body.error,'platform_session_required');
  assert.deepEqual(received,['chat-forwarded-1']);
 }finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
 }
});
