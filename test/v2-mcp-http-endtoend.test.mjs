import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WorkflowStore} from '../src/workflow-store.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {v2ActionDigest} from '../src/v2-caller-assertion.mjs';
import {createV2JwksTokenVerifier} from '../src/v2-oauth-jwks.mjs';
import {createV2CandidateMcpDispatcher} from '../src/v2-mcp-workflow-dispatcher.mjs';
import {createV2CandidateHttpIngress} from '../src/v2-mcp-http-ingress.mjs';

const NOW=1780000000000,issuer='https://idp.example.test',
 resource='https://commander.example.test/mcp-v2',
 jwksUri='https://idp.example.test/keys';
const oauth=generateKeyPairSync('ed25519'),native=generateKeyPairSync('ed25519');
const fields=['issuer','audience','hostId','principalId','profileId',
 'conversationId','operationId','targetKind','targetId','osSessionId',
 'tool','argumentsHash','issuedAtMs','expiresAtMs','nonce'];
const route=(chat,workflow)=>({
 hostId:'host',principalId:'principal',profileId:'owner-profile',conversationId:chat,
 operationId:'write',target:{kind:'workflow-root',id:workflow}
});
function signed(r,args){
 const claims={issuer:'owner-issuer',audience:'commander-v2',
  hostId:r.hostId,principalId:r.principalId,profileId:r.profileId,
  conversationId:r.conversationId,operationId:r.operationId,
  targetKind:r.target.kind,targetId:r.target.id,osSessionId:'owner-seat',
  tool:'write_text',argumentsHash:v2ActionDigest('write_text',args),
  issuedAtMs:NOW-1000,expiresAtMs:NOW+50000,nonce:'unique-'+r.conversationId};
 const encoded=Buffer.from(JSON.stringify([2,'owner',...fields.map(f=>claims[f])]));
 return {schema:2,keyId:'owner',claims,
  signature:sign(null,encoded,native.privateKey).toString('base64url')};
}
function token(subject='oauth-user'){
 const header=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'at+jwt',kid:'oauth'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({iss:issuer,aud:resource,sub:subject,
  scope:'commander.workflow',nbf:Math.floor(NOW/1000)-1,
  exp:Math.floor(NOW/1000)+60})).toString('base64url');
 const input=header+'.'+payload;
 return input+'.'+sign(null,Buffer.from(input),oauth.privateKey).toString('base64url');
}
const toolArgs=(a)=>({tool:'write_text',arguments:a,stepId:'write',expectedRevision:1});
const rpc=(a,session)=>({
 jsonrpc:'2.0',id:9,method:'tools/call',params:{
  name:'v2_workflow_step',arguments:a,
  _meta:{'openai/session':session}
 }
});
test('full isolated HTTP → JWT/JWKS → trusted-chat assertion → SQLite grant → WorkflowStore, two chats',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-http-real-e2e-'));
 const project=path.join(dir,'project');fs.mkdirSync(project);
 const store=new WorkflowStore({
  directory:path.join(dir,'workflow'),
  rootLeaseDirectory:path.join(dir,'leases'),allowedRoots:[dir],
  device:'host',configSha256:'2'.repeat(64),
  authority:{profileId:'owner-profile',tier:'FULL_POWER',
   capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
  schedulerPolicy:{enabled:true,oneWriterPerRoot:true,maxConcurrentProjects:1,
   leaseMs:5000,intervalMs:1000,retryBudget:3}
 });
 const grants=new V2GrantRegistry({directory:path.join(dir,'grant'),
  authorizeAdministration:({actor})=>actor==='native-admin'});
 const entries=new Map();
 for(const [chat,flow,content] of [
  ['chat-a','flow-a','from-A'],['chat-b','flow-b','from-B']
 ]){
  const r=route(chat,flow),a={path:path.join(project,chat+'.txt'),content};
  entries.set(chat,{route:r,args:a,assertion:signed(r,a)});
  store.create({id:flow,root:project,
   goal:'HTTP verified '+chat,acceptance:['one authorized write'],
   steps:[{id:'write',title:'write once'}]});
 }
 grants.change({route:entries.get('chat-a').route,tool:'write_text',
  status:'ENABLED',expectedRevision:0,actor:'native-admin',reason:'allow first attested chat'});
 const jwk={...oauth.publicKey.export({format:'jwk'}),kid:'oauth',alg:'EdDSA',use:'sig'};
 const verifier=createV2JwksTokenVerifier({
  issuer,audience:resource,jwksUri,now:()=>NOW,
  request:async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200})
 });
 let currentSession='chat-a',authenticated=true,effects=0;
 const ingress=createV2CandidateHttpIngress({
  resource,authorizationServers:[issuer],
  attestTransport:async()=>({
   authenticated,sessionHandle:currentSession
  }),
  dispatcherFactory:async(proof)=>createV2CandidateMcpDispatcher({
    resource,authorizationServers:[issuer],issuer,audience:resource,
    assertionTrust:{issuer:'owner-issuer',audience:'commander-v2',
      publicKeys:new Map([['owner',native.publicKey]])},
    verifyAccessToken:verifier,
    resolvePrincipal:async(subject)=>subject==='oauth-user'?'principal':null,
    observedNativeSession:async()=> 'owner-seat',
    resolveTrustedInvocation:async()=>{
      const entry=entries.get(proof.sessionHandle);
      return entry?{route:entry.route,assertion:entry.assertion}:null;
    },
    workflowStore:store,grantRegistry:grants,
    authorizeTool:async(t,a,s)=>{
     const entry=[...entries.values()].find(v=>v.route.target.id===s.id);
     return !!entry&&t==='write_text'&&a.path===entry.args.path&&a.content===entry.args.content;
    },
    dispatch:async(_t,a)=>{
      fs.writeFileSync(a.path,a.content);
      effects++;return {ok:true};
    },
    now:()=>NOW
  })
 });
 const server=ingress.createUnboundServer();
 try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const send=async(a,auth='Bearer '+token(),session=currentSession)=>{
   const response=await fetch(base+'/mcp-v2',{
    method:'POST',headers:{'content-type':'application/json',
      ...(auth?{authorization:auth}:{})},
    body:JSON.stringify(rpc(a,session))
   });
   return {status:response.status,body:await response.json()};
  };
  const metadata=await fetch(base+ingress.protectedResource.metadataPath);
  assert.equal(metadata.status,200);
  assert.deepEqual((await metadata.json()).authorization_servers,[issuer]);

  const noLogin=await send(toolArgs(entries.get('chat-a').args),null);
  assert.equal(noLogin.status,200);
  assert.equal(noLogin.body.result.isError,true);
  assert.ok(noLogin.body.result._meta['mcp/www_authenticate'][0].includes('resource_metadata'));
  assert.equal(effects,0);

  const first=await send(toolArgs(entries.get('chat-a').args));
  assert.equal(first.body.result.structuredContent.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(effects,1);
  assert.equal(fs.readFileSync(entries.get('chat-a').args.path,'utf8'),'from-A');
  const replay=await send(toolArgs(entries.get('chat-a').args));
  assert.equal(replay.body.result.structuredContent.cachedReceipt,true);
  assert.equal(effects,1);

  const forged=await send(toolArgs({...entries.get('chat-a').args,content:'tampered'}));
  assert.equal(forged.body.result.isError,true);
  assert.equal(effects,1);
  const foreign=await send(toolArgs(entries.get('chat-a').args),'Bearer '+token('wrong-user'));
  assert.equal(foreign.body.result.isError,true);
  assert.equal(effects,1);

  const spoofed=await send(toolArgs(entries.get('chat-a').args),undefined,'chat-b');
  assert.equal(spoofed.status,403);
  assert.equal(spoofed.body.error,'platform_session_mismatch');
  assert.equal(effects,1);

  currentSession='chat-b'; // switched by trusted server-side attestor, not RPC
  const noGrant=await send(toolArgs(entries.get('chat-b').args));
  assert.equal(noGrant.body.result.isError,true);
  assert.equal(effects,1);
  grants.change({route:entries.get('chat-b').route,tool:'write_text',
   status:'ENABLED',expectedRevision:0,actor:'native-admin',reason:'allow attested second chat'});
  const b=await send(toolArgs(entries.get('chat-b').args));
  assert.equal(b.body.result.structuredContent.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(effects,2);
  assert.equal(fs.readFileSync(entries.get('chat-b').args.path,'utf8'),'from-B');
  grants.change({route:entries.get('chat-b').route,tool:'write_text',
   status:'REVOKED',expectedRevision:1,actor:'native-admin',reason:'revoke second chat after success'});
  const revoked=await send(toolArgs(entries.get('chat-b').args));
  assert.equal(revoked.body.result.isError,true);
  assert.equal(effects,2);

  currentSession='chat-a';
  const stillA=await send(toolArgs(entries.get('chat-a').args));
  assert.equal(stillA.body.result.structuredContent.cachedReceipt,true);
  assert.equal(effects,2);

  authenticated=false;
  const untrusted=await send(toolArgs(entries.get('chat-a').args));
  assert.equal(untrusted.status,403);
  assert.equal(effects,2);
 }finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  grants.close();store.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
