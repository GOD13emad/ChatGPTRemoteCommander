import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signJwt} from 'node:crypto';
import {createV2JwksTokenVerifier} from '../src/v2-oauth-jwks.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {createV2NativeOwnerAssertionIssuer} from '../src/v2-caller-assertion.mjs';
import {createV2OAuthV1Parity,createV2OAuthV1NativeParity} from '../src/v2-oauth-v1-parity.mjs';
import {createV2V1LocalOwnerGateway} from '../src/v2-v1-local-owner-gateway.mjs';

const now=1780000000000,issuer='https://login.example.test',
 audience='https://v2.example.test/mcp';
const route={hostId:'mmz',principalId:'owner',profileId:'default',
 conversationId:'chat-a',operationId:'op-one',target:{kind:'host-shell',id:'mmz'}};
const args={command:'true'};
async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-oauth-native-'));
 const native=generateKeyPairSync('ed25519');
 const oauthKey=generateKeyPairSync('ed25519');
 const accessHeader=Buffer.from(JSON.stringify({
  alg:'EdDSA',typ:'at+jwt',kid:'mmz-qa-kid'
 })).toString('base64url');
 const accessClaims=Buffer.from(JSON.stringify({
  iss:issuer,aud:audience,sub:'owner-sub',scope:'commander.full',
  exp:Math.floor((now+60000)/1000),nbf:Math.floor((now-1000)/1000)
 })).toString('base64url');
 const message=accessHeader+'.'+accessClaims;
 const signedAccessToken=message+'.'+signJwt(null,Buffer.from(message),
  oauthKey.privateKey).toString('base64url');
 const publicJwk={...oauthKey.publicKey.export({format:'jwk'}),
  kid:'mmz-qa-kid',use:'sig',alg:'EdDSA'};
 const verifyAccessToken=createV2JwksTokenVerifier({
  issuer,audience,jwksUri:'https://login.example.test/jwks',
  now:()=>now,
  request:async()=>new Response(JSON.stringify({keys:[publicJwk]}),
   {status:200})
 });

 const grants=new V2GrantRegistry({directory:path.join(dir,'grants'),
  authorizeAdministration:({actor})=>actor==='admin'});
 const receiptStore=new MutationIdempotencyStore({directory:path.join(dir,'receipts'),scope:'mmz'});
 const sign=createV2NativeOwnerAssertionIssuer({issuer:'native-test',
  audience:'v2-private',keyId:'local-key',privateKey:native.privateKey,
  resolveNativeRoute:async()=>route,observedNativeSession:async()=> 'seat-one',
  authorizeIssue:async()=>true,now:()=>now,nonce:()=> 'random-test-nonce'});
 const invocation=await sign({sessionHandle:'trusted-handle',tool:'run_shell',args});
 let count=0,lookups=0,seat='seat-one';
 const config={issuer,audience,verifyAccessToken,
  resolvePrincipal:async sub=>sub==='owner-sub'?'owner':null,
  resolveTrustedInvocation:async action=>{lookups++;assert.equal(action.authorization,undefined);
   assert.deepEqual(Object.keys(action).sort(),['arguments','tool']);return invocation;},
  assertionTrust:{issuer:'native-test',audience:'v2-private',
   publicKeys:new Map([['local-key',native.publicKey]])},
  observedNativeSession:async()=>seat,grantRegistry:grants,
  receiptStore,withLease:async(_k,work)=>work(),
  localGateway:{call:async x=>{count++;assert.equal(x.tool,'run_shell');
   assert.equal(x.args.command,'true');
   return {result:{isError:false,structuredContent:{exitCode:0,stdout:'V2_PRIVATE_QA_MARKER_NO_PERSIST'}}};}},
  now:()=>now};
 return {config,signedAccessToken,grants,receiptStore,get count(){return count},
  get lookups(){return lookups},setSeat:v=>seat=v,
  permit:()=>grants.change({route,tool:'run_shell',status:'ENABLED',expectedRevision:0,
   actor:'admin',reason:'synthetic test grant only'}),
  revoke:()=>grants.change({route,tool:'run_shell',status:'REVOKED',expectedRevision:1,
   actor:'admin',reason:'synthetic revocation after success'}),
  close:()=>{grants.close();receiptStore.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
test('no valid OAuth bearer means no native lookup and no V1 effect',async()=>{
 const f=await fixture();try{const g=createV2OAuthV1Parity(f.config);
  for(const authorization of [undefined,'Basic hello','Bearer wrong']){
   await assert.rejects(()=>g.call({authorization,tool:'run_shell',args}));
  }
  assert.equal(f.lookups,0);assert.equal(f.count,0);
 }finally{f.close()}
});
test('signed native assertion and granted OAuth caller executes once and caches',async()=>{
 const f=await fixture();try{f.permit();
  const g=createV2OAuthV1Parity(f.config),call={authorization:'Bearer '+f.signedAccessToken,
   tool:'run_shell',args};
  const first=await g.call(call);const second=await g.call(call);
  assert.equal(first.structuredContent.exitCode,0);
  assert.equal(first.structuredContent.stdout,'V2_PRIVATE_QA_MARKER_NO_PERSIST');
  assert.equal(second.cachedReceipt,true);
  assert.equal(second.structuredContent.privateOutputStored,false);
  assert.ok(!JSON.stringify(second).includes('V2_PRIVATE_QA_MARKER_NO_PERSIST'));
  assert.equal(f.receiptStore.status().states.SUCCEEDED,1);
  assert.ok(!fs.readFileSync(f.receiptStore.location,'utf8').includes('V2_PRIVATE_QA_MARKER_NO_PERSIST'));
  assert.equal(f.count,1);
  f.revoke();
  await assert.rejects(()=>g.call(call),{code:'V2_GRANT_REQUIRED'});
  assert.equal(f.count,1);
 }finally{f.close()}
});
test('native seat changes and tampered action cannot dispatch',async()=>{
 const f=await fixture();try{f.permit();
  const g=createV2OAuthV1Parity(f.config);
  f.setSeat('untrusted-seat');
  await assert.rejects(()=>g.call({authorization:'Bearer '+f.signedAccessToken,
   tool:'run_shell',args}),{code:'V2_ASSERTION_NATIVE_SESSION_MISMATCH'});
  f.setSeat('seat-one');
  await assert.rejects(()=>g.call({authorization:'Bearer '+f.signedAccessToken,
   tool:'run_shell',args:{command:'wrong'}}),{code:'V2_ASSERTION_ACTION_MISMATCH'});
  assert.equal(f.count,0);
 }finally{f.close()}
});


test('real native V2→V1 gateway composes with OAuth assertion, grant and idempotency',async()=>{
 const f=await fixture();
 let nativeAllowed=true;
 const calls=[];
 try{
  f.config.localGateway=createV2V1LocalOwnerGateway({
   attestLocalOwner:async()=>nativeAllowed,
   rpc:async(method,params)=>{
    calls.push({method,params});
    if(method==='tools/list')return {tools:[{name:'run_shell',inputSchema:{
     type:'object',properties:{command:{type:'string'},requestId:{type:'string'}}
    }}]};
    if(method==='tools/call')return {isError:false,
     structuredContent:{exitCode:0,stdout:'PRIVATE_NATIVE_RETURN'}};
    throw Error('UNEXPECTED_V1_RPC');
   }
  });
  const g=createV2OAuthV1Parity(f.config),request={
   authorization:'Bearer '+f.signedAccessToken,tool:'run_shell',args
  };
  await assert.rejects(g.call({...request,authorization:'Bearer wrong'}));
  assert.equal(calls.length,0,'JWT must be verified before any local catalog access');
  f.permit();
  const result=await g.call(request);
  assert.equal(result.structuredContent.stdout,'PRIVATE_NATIVE_RETURN');
  assert.equal(calls.filter(x=>x.method==='tools/call').length,1);
  const forwarded=calls.find(x=>x.method==='tools/call').params;
  assert.equal(forwarded.name,'run_shell');
  assert.equal(forwarded.arguments.command,'true');
  assert.match(forwarded.arguments.requestId,/^v2-[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(f.receiptStore.status()).includes('PRIVATE_NATIVE_RETURN'));
  const repeated=await g.call(request);
  assert.equal(repeated.cachedReceipt,true);
  assert.equal(calls.filter(x=>x.method==='tools/call').length,1);
  f.revoke();
  await assert.rejects(g.call(request),{code:'V2_GRANT_REQUIRED'});
  assert.equal(calls.filter(x=>x.method==='tools/call').length,1);
 }finally{f.close()}
});
test('async OS peer revocation during native catalog prevents V1 physical tool dispatch',async()=>{
 const f=await fixture();
 let enabled=true,catalog=0,physical=0;
 try{
  f.permit();
  f.config.localGateway=createV2V1LocalOwnerGateway({
   attestLocalOwner:async()=>enabled,
   rpc:async(method)=>{
    if(method==='tools/list'){catalog++;enabled=false;
     return {tools:[{name:'run_shell',inputSchema:{
      type:'object',properties:{command:{type:'string'},requestId:{type:'string'}}
     }}]};}
    if(method==='tools/call'){physical++;throw Error('FAIL_OPEN_DISPATCH');}
    throw Error('UNEXPECTED_V1_RPC');
   }
  });
  const g=createV2OAuthV1Parity(f.config);
  await assert.rejects(g.call({authorization:'Bearer '+f.signedAccessToken,tool:'run_shell',args}),
   {code:'V2_LOCAL_OWNER_ATTESTATION_REQUIRED'});
  assert.equal(catalog,1);
  assert.equal(physical,0,'revoked native owner cannot reach V1 tools/call');
 }finally{f.close()}
});
test('valid OAuth bearer, native assertion and grant still deny an asynchronously false native peer',async()=>{
 const f=await fixture();
 let calls=0;
 try{
  f.permit();
  f.config.localGateway=createV2V1LocalOwnerGateway({
   attestLocalOwner:async()=>false,
   rpc:async()=>{calls++;throw Error('FAIL_OPEN_RPC');}
  });
  await assert.rejects(createV2OAuthV1Parity(f.config).call({
   authorization:'Bearer '+f.signedAccessToken,tool:'run_shell',args
  }),{code:'V2_LOCAL_OWNER_ATTESTATION_REQUIRED'});
  assert.equal(calls,0);
 }finally{f.close()}
});


test('trusted native composition factory executes only after signed OAuth+owner+grant and preserves V1 requestId',async()=>{
 const f=await fixture();const calls=[];
 try{
  const {localGateway:_unused,...trusted}=f.config;
  let authorized=true,checks=0;
  const g=createV2OAuthV1NativeParity({
   ...trusted,
   attestLocalOwner:async()=>{checks++;return authorized;},
   rpc:async(method,params)=>{
    calls.push([method,params]);
    if(method==='tools/list')return {tools:[{name:'run_shell',inputSchema:{
     type:'object',properties:{command:{type:'string'},requestId:{type:'string'}}
    }}]};
    if(method==='tools/call')return {isError:false,structuredContent:{exitCode:0,stdout:'native-readback'}};
    throw Error('unexpected native method');
   }
  });
  const request={authorization:'Bearer '+f.signedAccessToken,tool:'run_shell',args};
  await assert.rejects(g.call({...request,authorization:'Bearer invalid'}));
  assert.equal(calls.length,0);
  f.permit();
  const good=await g.call(request);
  assert.equal(good.structuredContent.stdout,'native-readback');
  assert.equal(calls.filter(([method])=>method==='tools/call').length,1);
  assert.ok(checks>=3,'native owner checks before each catalog and dispatch');
  assert.match(calls.find(([method])=>method==='tools/call')[1].arguments.requestId,
   /^v2-[0-9a-f-]{36}$/);
  authorized=false;
  f.revoke();
  await assert.rejects(g.call(request),{code:'V2_GRANT_REQUIRED'});
  assert.equal(calls.filter(([method])=>method==='tools/call').length,1);
 }finally{f.close()}
});
test('native composition refuses missing owner proof and arbitrary preconstructed gateway',async()=>{
 const f=await fixture();
 try{
  const {localGateway:_unused,...trusted}=f.config;
  assert.throws(()=>createV2OAuthV1NativeParity({...trusted,
   rpc:async()=>({}),attestLocalOwner:undefined}),
   {code:'V2_AUTH_PARITY_NATIVE_BOOTSTRAP_REQUIRED'});
  assert.throws(()=>createV2OAuthV1NativeParity({...trusted,
   rpc:async()=>({}),attestLocalOwner:()=>true,localGateway:f.config.localGateway}),
   {code:'V2_AUTH_PARITY_NATIVE_BOOTSTRAP_REQUIRED'});
 }finally{f.close()}
});
