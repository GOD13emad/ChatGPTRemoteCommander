import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  verifyV2CallerAssertion as verifyRaw,createV2VerifiedObservedCaller as createRaw,v2ActionDigest
} from '../src/v2-caller-assertion.mjs';
import { executeV2WorkflowStep } from '../src/v2-workflow-gateway.mjs';
import { WorkflowStore } from '../src/workflow-store.mjs';
import { V2GrantRegistry } from '../src/v2-grant-registry.mjs';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const {publicKey:otherPublicKey}=generateKeyPairSync('ed25519');
const NOW=1780000000000;
const ARGS=Object.freeze({path:'fixture.txt',content:'hi'});
const verifyV2CallerAssertion=(p)=>verifyRaw({tool:'write_text',args:ARGS,...p});
const createV2VerifiedObservedCaller=(p)=>createRaw({tool:'write_text',args:ARGS,...p});
const route=(changes={})=>({
  hostId:'host',principalId:'owner',profileId:'alice',
  conversationId:'chat-a',operationId:'write',
  target:{kind:'workflow-root',id:'flow-a'},...changes
});
const trust={issuer:'trusted-native-platform',audience:'commander-v2-host',publicKeys:new Map([['key1',publicKey]])};
const fields=[
  'issuer','audience','hostId','principalId','profileId','conversationId',
  'operationId','targetKind','targetId','osSessionId','tool','argumentsHash',
  'issuedAtMs','expiresAtMs','nonce'
];
function signed(r=route(),changes={},secret=privateKey,keyId='key1',args=ARGS){
  const claims={
    issuer:trust.issuer,audience:trust.audience,hostId:r.hostId,principalId:r.principalId,
    profileId:r.profileId,conversationId:r.conversationId,operationId:r.operationId,
    targetKind:r.target.kind,targetId:r.target.id,osSessionId:'session-1',
    tool:'write_text',argumentsHash:v2ActionDigest('write_text',args),
    issuedAtMs:NOW-1000,expiresAtMs:NOW+30000,nonce:'nonce-a',...changes
  };
  const payload=Buffer.from(JSON.stringify([2,keyId,...fields.map(f=>claims[f])]),'utf8');
  return {schema:2,keyId,claims,signature:sign(null,payload,secret).toString('base64url')};
}
test('valid signed exact-route assertion matches observed native session',async()=>{
  const r=route();
  const observed=createV2VerifiedObservedCaller({
    route:r,assertion:signed(r),trust,observedNativeSession:async()=> 'session-1',now:()=>NOW
  });
  assert.deepEqual(await observed(),{
    hostId:'host',principalId:'owner',profileId:'alice',conversationId:'chat-a'
  });
});
test('ordinary caller-supplied claim edits cannot forge Ed25519 signature',()=>{
  const a=signed();a.claims.conversationId='chat-b';
  assert.throws(()=>verifyV2CallerAssertion({route:route({conversationId:'chat-b'}),assertion:a,trust,nowMs:NOW}),{code:'V2_ASSERTION_BAD_SIGNATURE'});
});
test('audience and issuer are independently pinned',()=>{
  assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:signed(),trust:{...trust,audience:'other-app'},nowMs:NOW}),{code:'V2_ASSERTION_WRONG_ISSUER_OR_AUDIENCE'});
  assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:signed(),trust:{...trust,issuer:'other-issuer'},nowMs:NOW}),{code:'V2_ASSERTION_WRONG_ISSUER_OR_AUDIENCE'});
});
test('wrong issuer public key or key ID cannot authorize a call',()=>{
  assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:signed(),trust:{...trust,publicKeys:new Map([['key1',otherPublicKey]])},nowMs:NOW}),{code:'V2_ASSERTION_BAD_SIGNATURE'});
  assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:signed(route(),{},privateKey,'key2'),trust,nowMs:NOW}),{code:'V2_ASSERTION_TRUSTED_KEY_REQUIRED'});
});
test('valid signature is bound to host, principal, chat, operation and target',()=>{
  const a=signed();const variants=[
    route({hostId:'other-host'}),route({principalId:'saeed'}),
    route({profileId:'other-profile'}),route({conversationId:'chat-b'}),
    route({operationId:'another-step'}),
    route({target:{kind:'workflow-root',id:'flow-b'}}),
    route({target:{kind:'browser-target',id:'flow-a'}})
  ];
  for(const r of variants){
    assert.throws(()=>verifyV2CallerAssertion({route:r,assertion:a,trust,nowMs:NOW}),{code:'V2_ASSERTION_ROUTE_MISMATCH'});
  }
});
test('expires, not-before, excessive TTL and malformed times fail closed',()=>{
  for(const values of [
    {expiresAtMs:NOW},{issuedAtMs:NOW+1},{issuedAtMs:NOW-1,expiresAtMs:NOW+120001},
    {issuedAtMs:NOW-1,expiresAtMs:NOW-1},{expiresAtMs:'untrusted'}
  ]){
    const a=signed(route(),values);
    assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:a,trust,nowMs:NOW}),{code:'V2_ASSERTION_EXPIRED_OR_INVALID_TIME'});
  }
});
test('native session mismatch rejects assertion even when signed correctly',async()=>{
  const observed=createV2VerifiedObservedCaller({
    route:route(),assertion:signed(),trust,observedNativeSession:async()=> 'session-0',now:()=>NOW
  });
  await assert.rejects(observed(),{code:'V2_ASSERTION_NATIVE_SESSION_MISMATCH'});
});
test('native OS session is reread every request, never cached',async()=>{
  let current='session-1',calls=0;
  const observed=createV2VerifiedObservedCaller({
    route:route(),assertion:signed(),trust,
    observedNativeSession:async()=>{calls++;return current;},now:()=>NOW
  });
  await observed();current='session-0';
  await assert.rejects(observed(),{code:'V2_ASSERTION_NATIVE_SESSION_MISMATCH'});
  assert.equal(calls,2);
});
test('expired caller cannot reuse an old signed identity',async()=>{
  let current=NOW;
  const observed=createV2VerifiedObservedCaller({
    route:route(),assertion:signed(),trust,
    observedNativeSession:async()=> 'session-1',now:()=>current
  });
  await observed();current=NOW+30000;
  await assert.rejects(observed(),{code:'V2_ASSERTION_EXPIRED_OR_INVALID_TIME'});
});
test('invalid envelopes, bad signatures or missing native observer are rejected',()=>{
  const a=signed();
  assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:{...a,algorithm:'none'},trust,nowMs:NOW}),{code:'V2_ASSERTION_INVALID'});
  assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:{...a,signature:'A'.repeat(86)},trust,nowMs:NOW}),{code:'V2_ASSERTION_BAD_SIGNATURE'});
  assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:{...a,signature:'bad'},trust,nowMs:NOW}),{code:'V2_ASSERTION_SIGNATURE_INVALID'});
  assert.throws(()=>createV2VerifiedObservedCaller({route:route(),assertion:a,trust,now:()=>NOW}),{code:'V2_ASSERTION_NATIVE_OBSERVER_REQUIRED'});
});
test('signed fixture verified before dispatch through existing WorkflowStore and grants',async()=>{
  const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-signed-gate-')));
  const project=path.join(dir,'project');fs.mkdirSync(project);
  const workflowStore=new WorkflowStore({
    directory:path.join(dir,'workflows'),rootLeaseDirectory:path.join(dir,'root-leases'),
    allowedRoots:[dir],device:'host',configSha256:'1'.repeat(64),
    authority:{profileId:'alice',tier:'FULL_POWER',capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
    schedulerPolicy:{enabled:true,oneWriterPerRoot:true,maxConcurrentProjects:1,leaseMs:5000,intervalMs:1000,retryBudget:3}
  });
  const grantRegistry=new V2GrantRegistry({directory:path.join(dir,'permissions'),authorizeAdministration:({actor})=>actor==='trusted-admin'});
  let effects=0;
  try {
    workflowStore.create({id:'flow-a',root:project,goal:'signed gateway',acceptance:['authorized'],steps:[{id:'write',title:'write once'}]});
    const r=route();
    grantRegistry.change({route:r,tool:'write_text',status:'ENABLED',expectedRevision:0,actor:'trusted-admin',reason:'scoped signed gateway fixture'});
    const args={path:path.join(project,'file.txt'),content:'hi'};
    const assertion=signed(r,{},privateKey,'key1',args);
    const observed=createV2VerifiedObservedCaller({route:r,assertion,trust,args,now:()=>NOW,observedNativeSession:async()=> 'session-1'});
    const run=caller=>executeV2WorkflowStep({
      route:r,stepId:'write',expectedRevision:1,tool:'write_text',arguments:args,
      workflowStore,grantRegistry,authorizeTool:async()=>true,
      observedCaller:caller,dispatch:async()=>{effects++;return {ok:true};}
    });
    assert.equal((await run(observed)).outcome,'RECORDED_NOT_VALIDATED');
    assert.equal(effects,1);
    const wrong=createV2VerifiedObservedCaller({route:r,assertion,trust,args,now:()=>NOW,observedNativeSession:async()=> 'session-2'});
    await assert.rejects(run(wrong),{code:'V2_ASSERTION_NATIVE_SESSION_MISMATCH'});
    assert.equal(effects,1);
  }finally{grantRegistry.close();workflowStore.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('signed caller cannot change command or arguments for the same workflow step',()=>{
  const r=route();const a=signed();
  assert.throws(()=>verifyV2CallerAssertion({route:r,assertion:a,trust,nowMs:NOW,tool:'delete_path'}),{code:'V2_ASSERTION_ACTION_MISMATCH'});
  assert.throws(()=>verifyV2CallerAssertion({route:r,assertion:a,trust,nowMs:NOW,args:{path:'other.txt',content:'hi'}}),{code:'V2_ASSERTION_ACTION_MISMATCH'});
  assert.equal(verifyV2CallerAssertion({route:r,assertion:a,trust,nowMs:NOW,args:{content:'hi',path:'fixture.txt'}}).conversationId,'chat-a');
});
test('schema-v1 assertion downgraded from v2 is rejected',()=>{
  assert.throws(()=>verifyV2CallerAssertion({route:route(),assertion:{...signed(),schema:1},trust,nowMs:NOW}),{code:'V2_ASSERTION_INVALID'});
});
test('noncanonical or dangerous arguments never produce an authorization digest',()=>{
  const cycle={};cycle.self=cycle;
  for(const args of [null,[],{path:undefined},{danger:NaN},{danger:Infinity},{danger:()=>0},{'__proto__':'a'},cycle]){
    if(args && Object.keys(args).length===0 && args!==cycle)continue;
    assert.throws(()=>v2ActionDigest('write_text',args),{code:'V2_ASSERTION_ARGUMENTS_INVALID'});
  }
  assert.throws(()=>v2ActionDigest('shell;rm -rf',ARGS),{code:'V2_ASSERTION_ACTION_INVALID'});
});
