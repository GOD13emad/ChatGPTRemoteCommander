import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runContainedProjectCommand,processContainmentAvailable,
  serializeProcessCessationProof} from '../src/process-containment.mjs';
import {issueObservedNativeCessationCertificate as issue} from '../src/v012-native-cessation-issuer.mjs';
import {verifyNativeCessationCertificate as verify} from '../src/v012-native-cessation-certificate.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('issuer accepts only observed native cessation and exact pinned admission, not a copied digest', {timeout:30000},async t=>{
  if(!(await processContainmentAvailable()))return t.skip('native process containment unavailable');
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-issuer-fixture-'));
  try{
    const key=generateKeyPairSync('ed25519'),binding={
      workflowId:'native-root',stepId:'deferred-effect',operationId:randomUUID(),
      rootFingerprint:'1'.repeat(64),revision:1,leaseId:'2'.repeat(64),fencingToken:1
    };
    const admittedAtMs=Date.now(),inputHash='3'.repeat(64);
    // A real, harmless OS-contained process, not a mocked cessation object.
    const run=await runContainedProjectCommand({
      program:process.execPath,args:['-e','process.stdout.write("fixture-complete")'],
      cwd,timeoutMs:10000,outputLimit:4096,env:process.env,binding
    });
    const proof=run.processCessationProof;
    assert.ok(proof,'actual native provider must attest completion');
    assert.equal(run.exitCode,0);
    const receiptBytes=Buffer.from(JSON.stringify({
      operationId:binding.operationId,inputHash,status:'SUCCEEDED'
    }));
    const expected={hostId:'fixture-host',brokerId:'fixture-broker',
      keySha256:sha(key.publicKey.export({format:'der',type:'spki'})),
      inputHash,receiptSha256:sha(receiptBytes),admittedAtMs,
      provider:proof.provider,binding};
    const args={expected,proof,receiptBytes,privateKey:key.privateKey};
    const packet=issue(args);
    assert.ok(packet);
    assert.ok(verify({packet,expected,publicKeyPem:key.publicKey.export({format:'pem',type:'spki'})}));
    // New OS process: only the public key, signed packet and exact synthetic
    // admission survive. No original in-memory proof or private key is passed.
    const recoveryFile=path.join(cwd,'public-recovery-fixture.json');
    const recovery={packet,expected,publicKeyPem:key.publicKey.export({format:'pem',type:'spki'})};
    const probe=()=>{
      const child=spawnSync(process.execPath,['--input-type=module','-e',
        "import fs from 'node:fs';import {verifyNativeCessationCertificate as verify} from './src/v012-native-cessation-certificate.mjs';"+
        "const r=verify(JSON.parse(fs.readFileSync(process.argv[1],'utf8')));console.log(r?'RECOVERY_VERIFIED':'RECOVERY_DENIED');",
        recoveryFile],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:10000});
      assert.equal(child.status,0,child.stderr);
      return child.stdout.trim();
    };
    fs.writeFileSync(recoveryFile,JSON.stringify(recovery),{mode:0o600,flag:'wx'});
    assert.equal(probe(),'RECOVERY_VERIFIED');
    // A changed expected receipt or a changed certificate must still fail
    // after restart, even though no in-memory state is available.
    for(const modified of [
      {...recovery,expected:{...expected,receiptSha256:'5'.repeat(64)}},
      {...recovery,packet:{...packet,claims:{...packet.claims,inputHash:'5'.repeat(64)}}}
    ]){
      fs.writeFileSync(recoveryFile,JSON.stringify(modified),{mode:0o600});
      assert.equal(probe(),'RECOVERY_DENIED');
    }
    for(const [name,patch] of [
      ['serialized proof',{proof:serializeProcessCessationProof(proof)}],
      ['copied proof',{proof:{...proof}}],
      ['wrong key',{privateKey:generateKeyPairSync('ed25519').privateKey}],
      ['replacement lease',{expected:{...expected,binding:{...binding,leaseId:'4'.repeat(64)}}}],
      ['wrong receipt bytes',{receiptBytes:Buffer.from('{}')}],
      ['wrong receipt pin',{expected:{...expected,receiptSha256:'4'.repeat(64)}}],
      ['completion predates admission',{expected:{...expected,admittedAtMs:Date.parse(proof.completedAt)+1}}],
      ['clock precedes completion',{now:Date.parse(proof.completedAt)-1}]
    ])await t.test(name,()=>assert.equal(issue({...args,...patch}),null));
    let getterCalls=0;
    const accessor={...expected};
    Object.defineProperty(accessor,'hostId',{enumerable:true,get(){getterCalls++;return expected.hostId;}});
    assert.equal(issue({...args,expected:accessor}),null);
    assert.equal(getterCalls,0);
    assert.equal(issue({...args,expected:{...expected,unexpected:true}}),null);
    for(const change of [{operationId:randomUUID()},{inputHash:'4'.repeat(64)},{status:'RUNNING'}]){
      const bytes=Buffer.from(JSON.stringify({operationId:binding.operationId,inputHash,status:'SUCCEEDED',...change}));
      assert.equal(issue({...args,receiptBytes:bytes,expected:{...expected,receiptSha256:sha(bytes)}}),null);
    }
  }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
