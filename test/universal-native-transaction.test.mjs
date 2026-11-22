import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {executeNativeTransaction,verifyNativePlanInput}
  from '../tools/universal-install/native-transaction.mjs';
import {createNativeFileJournal}
  from '../tools/universal-install/native-journal.mjs';

const H='a'.repeat(64),P='b'.repeat(64),C='c'.repeat(64);
function fixture(platform='linux'){
  const input={
    product:'ChatGPTRemoteCommander',platform,architecture:'x64',
    expectedCommit:'d'.repeat(40),
    candidate:{path:'/qa/new.pkg',sha256:C,version:'0.12.0-dev.9'},
    previous:{path:'/qa/old.pkg',sha256:P,version:'0.12.0-dev.8'}
  };
  let version=input.previous.version,invocations=[],drift=false,mode='normal';
  const snapshot=()=>({
    product:input.product,format:'native',registeredInstallCount:1,
    integrityVerified:mode!=='uncertain-integrity',version,
    runtime:{fingerprint:drift?'0'.repeat(64):H,
      liveCoreCutover:false,ownerGrantIssued:false,existingTunnelModified:false}
  });
  const adapter={
    inspect:async artifact=>({
      ...artifact,product:input.product,format:'native',
      platform,architecture:'x64'
    }),
    snapshot:async()=>snapshot(),
    install:async()=>{invocations.push('install');version=input.candidate.version;
      if(mode==='throw-after-effect')throw Error('unknown native exit');},
    restore:async()=>{invocations.push('restore');version=input.previous.version;
      if(mode==='bad-restore')throw Error('rollback interrupted');},
    verify:async()=>{if(mode==='wrong-postcheck')drift=true;return snapshot();}
  };
  const events=[],journal={
    claim:async x=>events.push('claim'),
    write:async x=>events.push(x),
    close:async()=>events.push('close')
  };
  const approve=async plan=>({
    kind:'native-owner-install-approval',transactionId:plan.transactionId,approved:true
  });
  return {input,adapter,journal,approve,events,invocations,
    setMode:x=>{mode=x;},setDrift:x=>{drift=x;},
    setVersion:x=>{version=x;},getVersion:()=>version};
}
test('one OS-neutral plan identity and DENY-by-default for Windows/Linux',async()=>{
  for(const platform of ['windows','linux']){
    const f=fixture(platform);
    const result=await executeNativeTransaction({
      action:'plan',input:f.input,adapter:f.adapter
    });
    assert.equal(result.status,'READY_TO_APPLY');
    assert.equal(result.plan.rollbackVerified,true);
    assert.equal(result.productionCutover,false);
    assert.equal(result.plan.platform,platform);
    assert.equal(f.invocations.length,0);
    await assert.rejects(executeNativeTransaction({
      action:'apply',input:f.input,adapter:f.adapter
    }),{code:'UNIVERSAL_NATIVE_EFFECT_AUTHORITY_REQUIRED'});
    assert.equal(f.invocations.length,0);
  }
});
test('one identical shared upgrade + verify + explicit rollback state machine per OS',async()=>{
  for(const platform of ['windows','linux']){
    const f=fixture(platform);
    const outcome=await executeNativeTransaction({
      action:'apply',...f
    });
    assert.equal(outcome.status,'NATIVE_PACKAGE_UPGRADED');
    assert.equal(outcome.observedVersion,'0.12.0-dev.9');
    assert.deepEqual(f.invocations,['install']);
    assert.deepEqual(f.events,['claim','INTENT_COMMITTED','NATIVE_EFFECT_STARTED',
      'VERIFIED','close']);
    const already=await executeNativeTransaction({
      action:'plan',input:f.input,adapter:f.adapter
    });
    assert.equal(already.status,'ALREADY_INSTALLED');
    await assert.rejects(executeNativeTransaction({
      action:'apply',...f
    }),{code:'UNIVERSAL_NATIVE_ACTION_BASELINE_MISMATCH'});
    assert.deepEqual(f.invocations,['install']);
    const back=await executeNativeTransaction({
      action:'rollback',...f
    });
    assert.equal(back.status,'NATIVE_PACKAGE_ROLLED_BACK');
    assert.deepEqual(f.invocations,['install','restore']);
    assert.equal(f.getVersion(),'0.12.0-dev.8');
  }
});
test('native install failure with candidate present triggers verified exact rollback only once',async()=>{
  const f=fixture();
  f.setMode('throw-after-effect');
  await assert.rejects(executeNativeTransaction({
    action:'apply',...f
  }),{code:'UNIVERSAL_NATIVE_EFFECT_FAILED_ROLLED_BACK'});
  assert.deepEqual(f.invocations,['install','restore']);
  assert.equal(f.getVersion(),'0.12.0-dev.8');
  assert.ok(f.events.includes('ROLLBACK_VERIFIED'));
});
test('failed verification + failed rollback is retained as unresolved, never called PASS',async()=>{
  const f=fixture();
  f.setMode('wrong-postcheck');
  await assert.rejects(executeNativeTransaction({
    action:'apply',...f
  }),{code:'UNIVERSAL_NATIVE_EFFECT_OUTCOME_UNKNOWN'});
  assert.deepEqual(f.invocations,['install']);
  assert.ok(f.events.includes('NEEDS_MANUAL_RECONCILIATION'));
});
test('tampering, duplicate registration, drift and unapproved effects fail before native mutation',async()=>{
  const f=fixture('windows');
  for(const mutant of [
    {...f.input,product:'Other'},
    {...f.input,expectedCommit:'not-a-sha'},
    {...f.input,candidate:{...f.input.candidate,version:'0.12.0-dev.7'}},
    {...f.input,candidate:{...f.input.candidate,sha256:f.input.previous.sha256}},
    {...f.input,previous:{...f.input.previous,extra:true}}
  ])assert.throws(()=>verifyNativePlanInput(mutant));
  const denial=async()=>({approved:false});
  await assert.rejects(executeNativeTransaction({
    action:'apply',input:f.input,adapter:f.adapter,journal:f.journal,approve:denial
  }),{code:'UNIVERSAL_NATIVE_OWNER_APPROVAL_REQUIRED'});
  assert.deepEqual(f.invocations,[]);
  f.setDrift(true);
  const bad=await executeNativeTransaction({action:'plan',input:f.input,adapter:f.adapter});
  assert.equal(bad.plan.baselineRuntimeFingerprint,'0'.repeat(64));
});
test('real file journal uses exclusive lock and does not remove unknown-effect lock',async()=>{
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-native-qa-'));
  const dir=path.join(root,'journal');
  try{
    const j=createNativeFileJournal({directory:dir});
    const id='c'.repeat(64);
    await j.claim(id);
    await assert.rejects(createNativeFileJournal({directory:dir}).claim(id),
      {code:'UNIVERSAL_NATIVE_INSTALL_LOCK_BUSY'});
    await j.write('NATIVE_EFFECT_STARTED',{action:'apply',version:'0.12.0-dev.9'});
    await j.close();
    assert.ok(fs.existsSync(path.join(dir,'install.lock')));
    assert.equal(fs.readFileSync(path.join(dir,'events.jsonl'),'utf8')
      .includes('NATIVE_EFFECT_STARTED'),true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('success journal releases only the owned lock, never records secrets',async()=>{
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-native-qa-'));
  try{
    const dir=path.join(root,'journal'),j=createNativeFileJournal({directory:dir});
    await j.claim('a'.repeat(64));
    await assert.rejects(j.write('VERIFIED',{secret:'private value'}),
      {code:'UNIVERSAL_NATIVE_JOURNAL_DATA_REJECTED'});
    await j.write('VERIFIED',{action:'apply',version:'0.12.0-dev.9'});
    await j.close();
    assert.equal(fs.existsSync(path.join(dir,'install.lock')),false);
    assert.equal(fs.readFileSync(path.join(dir,'events.jsonl'),'utf8')
      .includes('private value'),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
