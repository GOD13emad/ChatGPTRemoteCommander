import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {NATIVE_CESSATION_CERTIFICATE_DOMAIN,encodeNativeCessationCertificateClaims} from '../src/v012-native-cessation-certificate.mjs';
import {openNativeCessationEvidenceArchive as open} from '../src/v012-native-cessation-evidence-archive.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const now=1780000000000;
function fixture(){
  const key=generateKeyPairSync('ed25519'),binding={
    workflowId:'native-root',stepId:'deferred-effect',operationId:'11111111-2222-4333-8444-555555555555',
    rootFingerprint:'1'.repeat(64),revision:1,leaseId:'2'.repeat(64),fencingToken:3
  };
  const expected={hostId:'fixture-host',brokerId:'fixture-broker',
    keySha256:sha(key.publicKey.export({format:'der',type:'spki'})),
    inputHash:'3'.repeat(64),receiptSha256:'4'.repeat(64),admittedAtMs:now-2000,
    provider:'systemd-service-exit-type-cgroup',binding};
  const payload={schema:1,...binding,provider:expected.provider,runId:binding.operationId,
    activeProcesses:0,verified:true,outcome:'fixture-completed',cleanupRequired:false,
    completedAt:new Date(now-1000).toISOString()};
  const claims={schema:1,kind:NATIVE_CESSATION_CERTIFICATE_DOMAIN,
    hostId:expected.hostId,brokerId:expected.brokerId,keySha256:expected.keySha256,
    inputHash:expected.inputHash,receiptSha256:expected.receiptSha256,issuedAtMs:now,
    proof:{...payload,proofDigest:sha(JSON.stringify(payload))}};
  const signed=c=>({claims:c,signature:sign(null,encodeNativeCessationCertificateClaims(c),key.privateKey).toString('base64')});
  return {expected,publicKeyPem:key.publicKey.export({format:'pem',type:'spki'}),
    packet:signed(claims),now,signed};
}
test('public evidence archive persists exact proof, refuses overwrite and revalidates after reopen', {skip:process.platform!=='linux'},()=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc012-evidence-fixture-'));
  const file=path.join(root,'v012-native-cessation-evidence.sqlite');
  let a,db;
  try{
    const f=fixture();
    a=open({directory:root});
    assert.equal(a.read(f),null);
    assert.deepEqual(a.record(f),{recorded:true,duplicate:false});
    assert.deepEqual(a.record(f),{recorded:false,duplicate:true});
    const alternate=f.signed({...f.packet.claims,issuedAtMs:now+1});
    assert.throws(()=>a.record({...f,packet:alternate,now:now+1}),{code:'CESSATION_ARCHIVE_CONFLICT'});
    assert.throws(()=>a.record({...f,packet:{...f.packet,signature:Buffer.alloc(64).toString('base64')}}),{code:'CESSATION_ARCHIVE_EVIDENCE_INVALID'});
    a.close();a=open({directory:root});
    assert.deepEqual(a.read(f),{inputHash:f.expected.inputHash,processCessationProof:f.packet.claims.proof});
    assert.equal(a.read({...f,expected:{...f.expected,receiptSha256:'5'.repeat(64)}}),null);
    assert.equal(a.read({...f,publicKeyPem:generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'})}),null);
    const publicFile=path.join(root,'public-expectation.json');
    fs.writeFileSync(publicFile,JSON.stringify({expected:f.expected,publicKeyPem:f.publicKeyPem,now}),{mode:0o600,flag:'wx'});
    const child=spawnSync(process.execPath,['--input-type=module','-e',
      "import fs from 'node:fs';import {openNativeCessationEvidenceArchive as open} from './src/v012-native-cessation-evidence-archive.mjs';"+
      "const a=open({directory:process.argv[1]});try{const r=a.read(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));console.log(r?'ARCHIVE_RECOVERY_VERIFIED':'DENIED');}finally{a.close();}",
      root,publicFile],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:10000});
    assert.equal(child.status,0,child.stderr);
    assert.equal(child.stdout.trim(),'ARCHIVE_RECOVERY_VERIFIED');

    a.close();
    db=new DatabaseSync(file);
    const row=db.prepare('SELECT packet_json,expected_sha FROM evidence').get();
    assert.equal(row.expected_sha.length,64);
    assert.ok(!row.packet_json.includes('PRIVATE KEY'));
    const packet=JSON.parse(row.packet_json);
    packet.claims.receiptSha256='6'.repeat(64);
    db.prepare('UPDATE evidence SET packet_json=?').run(JSON.stringify(packet));
    db.close();db=null;
    a=open({directory:root});
    assert.equal(a.read(f),null,'modified on-disk signed packet cannot validate');
  }finally{db?.close();a?.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('archive refuses shared permissions, symbolic and hard-linked database files', {skip:process.platform!=='linux'},()=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc012-evidence-path-fixture-'));
  const dir=path.join(root,'archive'),alias=path.join(root,'alias');
  const file=path.join(dir,'v012-native-cessation-evidence.sqlite');
  let a;
  try{
    fs.mkdirSync(dir,{mode:0o755});
    assert.throws(()=>open({directory:dir}),{code:'CESSATION_ARCHIVE_DIRECTORY_NOT_PRIVATE'});
    fs.chmodSync(dir,0o700);
    fs.symlinkSync(dir,alias);
    assert.throws(()=>open({directory:alias}),{code:'CESSATION_ARCHIVE_DIRECTORY_ALIAS'});
    fs.symlinkSync(path.join(root,'missing'),file);
    assert.throws(()=>open({directory:dir}),{code:'CESSATION_ARCHIVE_FILE_UNTRUSTED'});
    fs.unlinkSync(file);
    a=open({directory:dir});a.close();
    fs.linkSync(file,path.join(root,'copy'));
    assert.throws(()=>open({directory:dir}),{code:'CESSATION_ARCHIVE_FILE_UNTRUSTED'});
    fs.unlinkSync(path.join(root,'copy'));
    fs.chmodSync(file,0o644);
    assert.throws(()=>open({directory:dir}),{code:'CESSATION_ARCHIVE_FILE_UNTRUSTED'});
  }finally{a?.close();fs.rmSync(root,{recursive:true,force:true});}
});
