import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createV2OAuthObservedCaller } from '../src/v2-oauth-caller.mjs';
import { v2ActionDigest } from '../src/v2-caller-assertion.mjs';
import { executeV2WorkflowStep } from '../src/v2-workflow-gateway.mjs';
import { WorkflowStore } from '../src/workflow-store.mjs';
import { V2GrantRegistry } from '../src/v2-grant-registry.mjs';

const NOW=1780000000000;
const issuer='https://idp.example.test';
const audience='https://commander.example.test/mcp';
const keys=generateKeyPairSync('ed25519'), internalKeys=generateKeyPairSync('ed25519');
const route=(change={})=>({
  hostId:'host',principalId:'principal-user',profileId:'alice',
  conversationId:'chat-a',operationId:'write',
  target:{kind:'workflow-root',id:'flow-a'},...change
});
const args={path:'project/a.txt',content:'hello'};
const fields=['issuer','audience','hostId','principalId','profileId','conversationId',
  'operationId','targetKind','targetId','osSessionId','tool','argumentsHash',
  'issuedAtMs','expiresAtMs','nonce'];
function signedAssertion(r=route(),a=args){
 const claims={
   issuer:'owner-native-issuer',audience:'commander-v2',hostId:r.hostId,
   principalId:r.principalId,profileId:r.profileId,conversationId:r.conversationId,
   operationId:r.operationId,targetKind:r.target.kind,targetId:r.target.id,
   osSessionId:'native-session',tool:'write_text',argumentsHash:v2ActionDigest('write_text',a),
   issuedAtMs:NOW-1000,expiresAtMs:NOW+30000,nonce:'nonce-1'
 };
 const payload=Buffer.from(JSON.stringify([2,'native-key',...fields.map(x=>claims[x])]));
 return {schema:2,keyId:'native-key',claims,signature:sign(null,payload,internalKeys.privateKey).toString('base64url')};
}
const assertionTrust={issuer:'owner-native-issuer',audience:'commander-v2',publicKeys:new Map([['native-key',internalKeys.publicKey]])};
const claims=(overrides={})=>({
  issuer,audience,subject:'oauth-user',scopes:['commander.workflow'],
  notBeforeMs:NOW-1000,expiresAtMs:NOW+30000,...overrides
});
function compactJwt(c=claims(),privateKey=keys.privateKey){
 const header=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'at+jwt',kid:'test-key'})).toString('base64url');
 const body=Buffer.from(JSON.stringify(c)).toString('base64url');
 const input=header+'.'+body;
 return input+'.'+sign(null,Buffer.from(input),privateKey).toString('base64url');
}
// Test-only verifier with real Ed25519 signature verification; production uses a
// configured OAuth 2.1 resource-server SDK and actual verified IdP key material.
async function verifyFixtureJwt(token) {
 const parts=token.split('.');
 if(parts.length!==3)throw Error('INVALID_TOKEN');
 const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());
 if(header.alg!=='EdDSA'||header.kid!=='test-key')throw Error('INVALID_ALGORITHM');
 if(!verify(null,Buffer.from(parts[0]+'.'+parts[1]),keys.publicKey,Buffer.from(parts[2],'base64url')))
   throw Error('INVALID_SIGNATURE');
 return JSON.parse(Buffer.from(parts[1],'base64url').toString());
}
function create({r=route(),a=args,authorization='Bearer '+compactJwt(),preissuedAssertion=null,overrides={}}={}){
 return createV2OAuthObservedCaller({
  route:r,tool:'write_text',args:a,assertion:preissuedAssertion ?? signedAssertion(r,a),assertionTrust,
  readAuthorization:async()=>authorization,verifyAccessToken:verifyFixtureJwt,
  resolvePrincipal:async(sub)=>sub==='oauth-user'?'principal-user':null,
  observedNativeSession:async()=> 'native-session',now:()=>NOW,issuer,audience,...overrides
 });
}
test('OAuth identity and separate native-session signed chat assertion combine',async()=>{
 assert.deepEqual(await create()(),{
   hostId:'host',principalId:'principal-user',profileId:'alice',conversationId:'chat-a'
 });
});
test('no valid bearer token -> fail closed',async()=>{
 await assert.rejects(create({authorization:null})(),{code:'V2_OAUTH_BEARER_REQUIRED'});
 await assert.rejects(create({authorization:'Basic abc'})(),{code:'V2_OAUTH_BEARER_REQUIRED'});
 await assert.rejects(create({authorization:'Bearer one two'})(),{code:'V2_OAUTH_BEARER_REQUIRED'});
});
test('invalid or altered access token fails real test signature verification',async()=>{
 const wrong=compactJwt(claims({subject:'oauth-user'}),internalKeys.privateKey);
 await assert.rejects(create({authorization:'Bearer '+wrong})(),/INVALID_SIGNATURE/);
 const valid=compactJwt();
 await assert.rejects(create({authorization:'Bearer '+valid.slice(0,-3)+'aaa'})(),/INVALID_SIGNATURE/);
});
test('wrong issuer and audience rejected even if cryptographic signature valid',async()=>{
 for(const c of [claims({issuer:'https://bad-idp.example.test'}),claims({audience:'https://different.example.test/mcp'})]){
   await assert.rejects(create({authorization:'Bearer '+compactJwt(c)})(),{code:'V2_OAUTH_ISSUER_OR_AUDIENCE_MISMATCH'});
 }
});
test('no scope, wrong OAuth subject and expired token fail closed',async()=>{
 await assert.rejects(create({authorization:'Bearer '+compactJwt(claims({scopes:['read.only']}))})(),{code:'V2_OAUTH_SCOPE_OR_SUBJECT_REQUIRED'});
 await assert.rejects(create({authorization:'Bearer '+compactJwt(claims({subject:'other-user'}))})(),{code:'V2_OAUTH_PRINCIPAL_MISMATCH'});
 await assert.rejects(create({authorization:'Bearer '+compactJwt(claims({expiresAtMs:NOW}))})(),{code:'V2_OAUTH_TOKEN_NOT_CURRENT'});
 await assert.rejects(create({authorization:'Bearer '+compactJwt(claims({notBeforeMs:NOW+1}))})(),{code:'V2_OAUTH_TOKEN_NOT_CURRENT'});
});
test('missing trusted OAuth callbacks and unsafe resource settings rejected',()=>{
 assert.throws(()=>create({overrides:{verifyAccessToken:null}}),{code:'V2_OAUTH_TRUSTED_CALLBACK_REQUIRED'});
 assert.throws(()=>create({overrides:{issuer:'http://insecure.example'}}),{code:'V2_OAUTH_RESOURCE_CONFIG_REQUIRED'});
});
test('OAuth user cannot claim a foreign Commander principal or native session',async()=>{
 await assert.rejects(create({r:route({principalId:'saeed'})})(),{code:'V2_OAUTH_PRINCIPAL_MISMATCH'});
 await assert.rejects(create({overrides:{observedNativeSession:async()=> 'another-session'}})(),{code:'V2_ASSERTION_NATIVE_SESSION_MISMATCH'});
});
test('OAuth token is checked again after revocation by verifier, no cached positive authorization',async()=>{
 let enabled=true;
 const observed=create({overrides:{verifyAccessToken:async t=>{
   if(!enabled)throw Error('OAUTH_REVOKED'); return verifyFixtureJwt(t);
 }}});
 await observed();enabled=false;
 await assert.rejects(observed(),/OAUTH_REVOKED/);
});
test('signed OAuth fixture + native assertion + grants reaches exactly one WorkflowStore step',async()=>{
 const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-oauth-workflow-')));
 const project=path.join(dir,'project');fs.mkdirSync(project);
 const store=new WorkflowStore({
   directory:path.join(dir,'workflow'),rootLeaseDirectory:path.join(dir,'leases'),
   allowedRoots:[dir],device:'host',configSha256:'1'.repeat(64),
   authority:{profileId:'alice',tier:'FULL_POWER',capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
   schedulerPolicy:{enabled:true,oneWriterPerRoot:true,maxConcurrentProjects:1,leaseMs:5000,intervalMs:1000,retryBudget:3}
 });
 const registry=new V2GrantRegistry({directory:path.join(dir,'grants'),authorizeAdministration:({actor})=>actor==='admin'});
 try{
   store.create({id:'flow-a',root:project,goal:'OAuth-bound workflow',acceptance:['one authorized step'],steps:[{id:'write',title:'write once'}]});
   const r=route(),a={path:path.join(project,'file.txt'),content:'hi'};
   registry.change({route:r,tool:'write_text',status:'ENABLED',expectedRevision:0,actor:'admin',reason:'isolated oauth workflow test'});
   const observed=create({r,a});
   let effects=0;
   const result=await executeV2WorkflowStep({
    route:r,stepId:'write',expectedRevision:1,tool:'write_text',arguments:a,
    workflowStore:store,grantRegistry:registry,observedCaller:observed,
    authorizeTool:async()=>true,dispatch:async()=>{effects++;return {ok:true};}
   });
   assert.equal(result.outcome,'RECORDED_NOT_VALIDATED');
   assert.equal(effects,1);
   const revoked=create({r,a,authorization:'Bearer '+compactJwt(claims({subject:'oauth-unauthorized'}))});
   await assert.rejects(executeV2WorkflowStep({
    route:r,stepId:'write',expectedRevision:1,tool:'write_text',arguments:a,
    workflowStore:store,grantRegistry:registry,observedCaller:revoked,
    authorizeTool:async()=>true,dispatch:async()=>{effects++;return {ok:true};}
   }),{code:'V2_OAUTH_PRINCIPAL_MISMATCH'});
   assert.equal(effects,1);
 }finally{registry.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('isolated HTTP bearer request requires independently prebound chat assertion',async()=>{
 // The trusted owner worker registered these bindings BEFORE receiving HTTP
 // requests. The HTTP handler never signs a caller-supplied conversation ID.
 const registered=new Map([
  ['chat-a',signedAssertion(route())],
  ['chat-b',signedAssertion(route({conversationId:'chat-b'}))]
 ]);
 const server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/test'){res.writeHead(404).end();return;}
  const messages=[];
  for await(const chunk of req)messages.push(chunk);
  const r=route(JSON.parse(Buffer.concat(messages).toString()));
  try {
   const observed=create({r,authorization:req.headers.authorization??null,overrides:{assertion:registered.get(r.conversationId)}});
   const identity=await observed();
   res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(identity));
  }catch(e){
   res.writeHead(403,{'content-type':'application/json'}).end(JSON.stringify({error:e.code||e.message}));
  }
 });
 try{
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const port=server.address().port;
   async function call(tok,change={}){
    const response=await fetch('http://127.0.0.1:'+port+'/test',{
      method:'POST',headers:{'content-type':'application/json',authorization:tok},
      body:JSON.stringify(change)
    });
    return {status:response.status,body:await response.json()};
   }
   const a=await call('Bearer '+compactJwt());
   assert.equal(a.status,200);
   assert.equal(a.body.conversationId,'chat-a');
   const b=await call('Bearer '+compactJwt(claims({subject:'other-user'})),{conversationId:'chat-b'});
   assert.equal(b.status,403);
   assert.equal(b.body.error,'V2_OAUTH_PRINCIPAL_MISMATCH');
   const c=await call('Bearer '+compactJwt(),{conversationId:'chat-b'});
   assert.equal(c.status,200);
   assert.equal(c.body.conversationId,'chat-b');
   const d=await call('Bearer '+compactJwt(),{conversationId:'unregistered-chat'});
   assert.equal(d.status,403);
   assert.equal(d.body.error,'V2_ASSERTION_INVALID');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('isolated OAuth HTTP WorkflowStore: two chats, same-root lease, revoked grant and lost ACK',async()=>{
 const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-http-g1-')));
 const project=path.join(dir,'project');fs.mkdirSync(project);
 const store=new WorkflowStore({
   directory:path.join(dir,'workflow'),rootLeaseDirectory:path.join(dir,'leases'),
   allowedRoots:[dir],device:'host',configSha256:'1'.repeat(64),
   authority:{profileId:'alice',tier:'FULL_POWER',capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
   schedulerPolicy:{enabled:true,oneWriterPerRoot:true,maxConcurrentProjects:1,leaseMs:5000,intervalMs:1000,retryBudget:3}
 });
 const registry=new V2GrantRegistry({directory:path.join(dir,'grants'),authorizeAdministration:({actor})=>actor==='admin'});
 const entries=new Map();
 let effects=0,releaseA,enteredA;
 const heldA=new Promise(resolve=>releaseA=resolve);
 const startedA=new Promise(resolve=>enteredA=resolve);
 for(const name of ['a','b']){
   const r=route({conversationId:'chat-'+name,target:{kind:'workflow-root',id:'flow-'+name}});
   const a={path:path.join(project,name+'.txt'),content:'content-'+name};
   store.create({id:r.target.id,root:project,goal:'chat '+name,acceptance:['once'],steps:[{id:'write',title:'one write'}]});
   registry.change({route:r,tool:'write_text',status:'ENABLED',expectedRevision:0,actor:'admin',reason:'isolated gateway grant fixture'});
   entries.set(name,{r,a,assertion:signedAssertion(r,a)});
 }
 const server=http.createServer(async(req,res)=>{
   if(req.method!=='POST'||req.url!=='/v2/candidate'){res.writeHead(404).end();return;}
   try{
     let raw='';
     for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw Error('BODY_LIMIT');}
     const body=JSON.parse(raw), bound=entries.get(body.bindingId);
     if(!bound)throw Error('V2_CHAT_NOT_PREBOUND');
     const observed=create({
       r:bound.r,a:body.args,authorization:req.headers.authorization??null,
       preissuedAssertion:bound.assertion
     });
     const result=await executeV2WorkflowStep({
       route:bound.r,stepId:'write',expectedRevision:1,tool:'write_text',arguments:body.args,
       workflowStore:store,grantRegistry:registry,observedCaller:observed,
       authorizeTool:async(tool,action)=>{
         return tool==='write_text'&&action.path===bound.a.path&&action.content===bound.a.content;
       },
       dispatch:async(_tool,action,state)=>{
         if(state.id==='flow-a'){enteredA();await heldA;}
         fs.writeFileSync(action.path,action.content);effects++;
         return {ok:true};
       }
     });
     if(body.dropAck===true){res.destroy();return;}
     res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({
       outcome:result.outcome,cachedReceipt:result.cachedReceipt===true
     }));
   }catch(e){
     const code=e.code||e.workflowCode||e.message;
     res.writeHead(403,{'content-type':'application/json'}).end(JSON.stringify({code}));
   }
 });
 try{
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const port=server.address().port,token='Bearer '+compactJwt();
   async function call(id,opts={}){
     const target=entries.get(id);
     const a=opts.args??target.a;
     const response=await fetch('http://127.0.0.1:'+port+'/v2/candidate',{
       method:'POST',headers:{'content-type':'application/json',authorization:opts.token??token},
       body:JSON.stringify({bindingId:id,args:a,dropAck:opts.dropAck===true})
     });
     return {status:response.status,body:await response.json()};
   }
   const pendingA=call('a');
   await startedA;
   const blocked=await call('b');
   assert.equal(blocked.status,403);
   assert.equal(blocked.body.code,'WORKFLOW_ROOT_LEASED');
   assert.equal(effects,0);
   releaseA();await pendingA;
   assert.equal(fs.readFileSync(entries.get('a').a.path,'utf8'),'content-a');
   const damaged=await call('b',{args:{...entries.get('b').a,content:'forged-data'}});
   assert.equal(damaged.status,403);
   assert.equal(damaged.body.code,'V2_ASSERTION_ACTION_MISMATCH');
   const lost=await call('b',{dropAck:true}).then(()=>null,()=> 'LOST_ACK');
   assert.equal(lost,'LOST_ACK');
   const recovered=await call('b');
   assert.equal(recovered.status,200);
   assert.equal(recovered.body.cachedReceipt,true);
   assert.equal(effects,2);
   const foreign=await call('b',{token:'Bearer '+compactJwt(claims({subject:'different-user'}))});
   assert.equal(foreign.status,403);
   assert.equal(foreign.body.code,'V2_OAUTH_PRINCIPAL_MISMATCH');
   registry.change({route:entries.get('b').r,tool:'write_text',status:'REVOKED',
      expectedRevision:1,actor:'admin',reason:'revocation test fixture'});
   const revoked=await call('b');
   assert.equal(revoked.status,403);
   assert.equal(revoked.body.code,'V2_GRANT_REQUIRED');
   assert.equal(effects,2);
 }finally{
   releaseA?.();
   await new Promise(resolve=>server.close(resolve));
   registry.close();store.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('multi-scope OAuth recheck denies token scope downgrade or mutated policy',async()=>{
 const requiredScopes=['commander.workflow','commander.seat'];
 let currentScopes=['commander.workflow','commander.seat'];
 const observed=create({overrides:{
  requiredScopes,
  verifyAccessToken:async t=>({
   ...(await verifyFixtureJwt(t)),scopes:currentScopes
  })
 }});
 assert.equal((await observed()).conversationId,'chat-a');
 requiredScopes.splice(1,1); // caller cannot shrink already created policy
 currentScopes=['commander.workflow'];
 await assert.rejects(observed(),{code:'V2_OAUTH_SCOPE_OR_SUBJECT_REQUIRED'});
 assert.throws(()=>create({overrides:{requiredScopes:[]}}),
   {code:'V2_OAUTH_RESOURCE_CONFIG_REQUIRED'});
 assert.throws(()=>create({overrides:{requiredScopes:['commander.workflow','commander.workflow']}}),
   {code:'V2_OAUTH_RESOURCE_CONFIG_REQUIRED'});
});
