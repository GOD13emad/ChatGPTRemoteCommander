import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NATIVE_CESSATION_CERTIFICATE_DOMAIN,encodeNativeCessationCertificateClaims,
  verifyNativeCessationCertificate
} from '../src/v012-native-cessation-certificate.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const now=1780000000000;
function fixture(provider='systemd-service-exit-type-cgroup'){
  // Ephemeral synthetic key only. No production key or owner state is read.
  const key=generateKeyPairSync('ed25519');
  const publicKeyPem=key.publicKey.export({format:'pem',type:'spki'});
  const keySha256=sha(key.publicKey.export({format:'der',type:'spki'}));
  const binding={workflowId:'native-root',stepId:'native-operation',
    operationId:'11111111-2222-4333-8444-555555555555',rootFingerprint:'1'.repeat(64),
    revision:1,leaseId:'2'.repeat(64),fencingToken:3};
  const payload={schema:1,...binding,provider,
    runId:binding.operationId,activeProcesses:0,verified:true,outcome:'fixture-completed',
    cleanupRequired:false,completedAt:new Date(now-1000).toISOString()};
  const proof={...payload,proofDigest:sha(JSON.stringify(payload))};
  const claims={schema:1,kind:NATIVE_CESSATION_CERTIFICATE_DOMAIN,hostId:'fixture-host',
    brokerId:'fixture-broker',keySha256,inputHash:'3'.repeat(64),
    receiptSha256:'4'.repeat(64),issuedAtMs:now,proof};
  const expected={hostId:claims.hostId,brokerId:claims.brokerId,keySha256,
    inputHash:claims.inputHash,receiptSha256:claims.receiptSha256,admittedAtMs:now-2000,
    provider:proof.provider,binding};
  const signed=c=>({claims:c,signature:sign(null,encodeNativeCessationCertificateClaims(c),key.privateKey).toString('base64')});
  return {expected,publicKeyPem,packet:signed(claims),signed};
}
test('durable certificate verification pins broker key, exact reservation and genuine completion',async t=>{
  const f=fixture(),check=(patch={})=>verifyNativeCessationCertificate({
    packet:f.packet,expected:f.expected,publicKeyPem:f.publicKeyPem,now,...patch});
  assert.deepEqual(check(),{inputHash:f.expected.inputHash,processCessationProof:f.packet.claims.proof});
  assert.ok(check({now:now+86400000}),'durable proof is not an ephemeral session token');
  const e=f.expected,c=f.packet.claims;
  for(const [name,patch] of [
    ['wrong host',{expected:{...e,hostId:'other-host'}}],
    ['wrong broker',{expected:{...e,brokerId:'other-broker'}}],
    ['wrong key pin',{expected:{...e,keySha256:'5'.repeat(64)}}],
    ['wrong public key',{publicKeyPem:generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'})}],
    ['private key input',{publicKeyPem:generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'})}],
    ['wrong input',{expected:{...e,inputHash:'5'.repeat(64)}}],
    ['wrong receipt',{expected:{...e,receiptSha256:'5'.repeat(64)}}],
    ['replacement lease',{expected:{...e,binding:{...e.binding,leaseId:'5'.repeat(64)}}}],
    ['new fencing token',{expected:{...e,binding:{...e.binding,fencingToken:4}}}],
    ['different provider',{expected:{...e,provider:'windows-job-object'}}],
    ['pre-admission completion',{expected:{...e,admittedAtMs:now-500}}],
    ['future issue',{now:now-1}],
    ['tampered signed claim',{packet:{...f.packet,claims:{...c,issuedAtMs:now-100}}}],
    ['signature corruption',{packet:{...f.packet,signature:Buffer.alloc(64).toString('base64')}}],
    ['extra field',{packet:{...f.packet,extra:true}}]
  ])await t.test(name,()=>assert.equal(check(patch),null));
  let getterCalls=0;
  const accessor={...c};
  Object.defineProperty(accessor,'hostId',{enumerable:true,get(){getterCalls++;return c.hostId;}});
  assert.equal(check({packet:{...f.packet,claims:accessor}}),null);
  assert.equal(getterCalls,0);
  // Even a signed statement cannot certify a live or cleanup-required process.
  for(const patch of [{activeProcesses:1},{cleanupRequired:true},{verified:false}]){
    const {proofDigest,...p}=c.proof;
    Object.assign(p,patch);
    const invalid={...c,proof:{...p,proofDigest:sha(JSON.stringify(p))}};
    assert.equal(check({packet:f.signed(invalid)}),null);
  }
});
test('synthetic Windows Job Object certificate uses the same pinned verification contract',()=>{
  const f=fixture('windows-job-object');
  assert.ok(verifyNativeCessationCertificate({...f,now}));
});
test('synthetic pinned public certificate is verifiable in a fresh OS process',()=>{
  const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-cessation-verifier-'));
  try{
    const file=path.join(root,'fixture.json');
    fs.writeFileSync(file,JSON.stringify({packet:f.packet,expected:f.expected,
      publicKeyPem:f.publicKeyPem,now}),{mode:0o600,flag:'wx'});
    const child=spawnSync(process.execPath,['--input-type=module','-e',
      "import fs from 'node:fs';import {verifyNativeCessationCertificate as verify} from './src/v012-native-cessation-certificate.mjs';const r=verify(JSON.parse(fs.readFileSync(process.argv[1],'utf8')));console.log(r?'FIXTURE_VERIFIED':'DENIED');if(!r)process.exitCode=1;",
      file],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:10000});
    assert.equal(child.status,0,child.stderr);
    assert.match(child.stdout,/FIXTURE_VERIFIED/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
