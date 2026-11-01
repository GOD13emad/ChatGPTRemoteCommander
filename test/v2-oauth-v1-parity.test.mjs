import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {createV2NativeOwnerAssertionIssuer} from '../src/v2-caller-assertion.mjs';
import {createV2OAuthV1Parity} from '../src/v2-oauth-v1-parity.mjs';

const now=1780000000000,issuer='https://login.example.test',
 audience='https://v2.example.test/mcp';
const route={hostId:'mmz',principalId:'owner',profileId:'default',
 conversationId:'chat-a',operationId:'op-one',target:{kind:'host-shell',id:'mmz'}};
const args={command:'true'};
async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-oauth-native-'));
 const native=generateKeyPairSync('ed25519');
 const grants=new V2GrantRegistry({directory:path.join(dir,'grants'),
  authorizeAdministration:({actor})=>actor==='admin'});
 const receiptStore=new MutationIdempotencyStore({directory:path.join(dir,'receipts'),scope:'mmz'});
 const sign=createV2NativeOwnerAssertionIssuer({issuer:'native-test',
  audience:'v2-private',keyId:'local-key',privateKey:native.privateKey,
  resolveNativeRoute:async()=>route,observedNativeSession:async()=> 'seat-one',
  authorizeIssue:async()=>true,now:()=>now,nonce:()=> 'random-test-nonce'});
 const invocation=await sign({sessionHandle:'trusted-handle',tool:'run_shell',args});
 let count=0,lookups=0,seat='seat-one';
 const claims={issuer,audience,subject:'owner-sub',scopes:['commander.full'],
  notBeforeMs:now-1000,expiresAtMs:now+60000};
 const config={issuer,audience,verifyAccessToken:async token=>{
   if(token!=='signed-test-token')throw Error('INVALID_TOKEN');return claims;
  },
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
 return {config,grants,receiptStore,get count(){return count},
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
  const g=createV2OAuthV1Parity(f.config),call={authorization:'Bearer signed-test-token',
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
  await assert.rejects(()=>g.call({authorization:'Bearer signed-test-token',
   tool:'run_shell',args}),{code:'V2_ASSERTION_NATIVE_SESSION_MISMATCH'});
  f.setSeat('seat-one');
  await assert.rejects(()=>g.call({authorization:'Bearer signed-test-token',
   tool:'run_shell',args:{command:'wrong'}}),{code:'V2_ASSERTION_ACTION_MISMATCH'});
  assert.equal(f.count,0);
 }finally{f.close()}
});
