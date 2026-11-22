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
    product:input.product,format:'native',
    registeredInstallCount:version===null?0:1,
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
    uninstall:async()=>{invocations.push('uninstall');version=null;
      if(mode==='bad-restore')throw Error('uninstall interrupted');},
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
    assert.equal(result.plan.rollbackArtifactVerified,true);
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


test('fresh first-install uses SAME Windows/Linux transaction and native uninstall rollback',async()=>{
  for(const platform of ['windows','linux']){
    const f=fixture(platform);
    f.input.installationKind='fresh';
    f.setVersion(null);
    const plan=await executeNativeTransaction({
      action:'plan',input:f.input,adapter:f.adapter
    });
    assert.equal(plan.status,'READY_TO_FIRST_INSTALL');
    assert.equal(plan.plan.installedVersion,null);
    assert.equal(plan.plan.rollbackTarget,'NATIVE_ABSENCE');
    assert.equal(plan.plan.rollbackExecutionVerified,false);
    assert.equal(f.invocations.length,0);
    const installed=await executeNativeTransaction({
      action:'apply',...f
    });
    assert.equal(installed.status,'NATIVE_PACKAGE_FIRST_INSTALLED');
    assert.equal(installed.beforeVersion,null);
    assert.deepEqual(f.invocations,['install']);
    const result=await executeNativeTransaction({
      action:'rollback',...f
    });
    assert.equal(result.status,'NATIVE_PACKAGE_ROLLED_BACK');
    assert.equal(result.observedVersion,null);
    assert.equal(f.getVersion(),null);
    assert.deepEqual(f.invocations,['install','uninstall']);
  }
});

test('fresh installation refuses wrong baseline, missing native uninstall and unapproved effects',async()=>{
  const f=fixture('windows');
  f.input.installationKind='fresh';
  await assert.rejects(executeNativeTransaction({
    action:'plan',input:f.input,adapter:f.adapter
  }),{code:'UNIVERSAL_NATIVE_INSTALLED_VERSION_DRIFT'});
  f.setVersion(null);
  const bad={...f.adapter};delete bad.uninstall;
  await assert.rejects(executeNativeTransaction({
    action:'plan',input:f.input,adapter:bad
  }),{code:'UNIVERSAL_NATIVE_FRESH_UNINSTALL_ADAPTER_REQUIRED'});
  await assert.rejects(executeNativeTransaction({
    action:'apply',input:f.input,adapter:f.adapter,journal:f.journal,
    approve:async()=>({approved:false})
  }),{code:'UNIVERSAL_NATIVE_OWNER_APPROVAL_REQUIRED'});
  assert.deepEqual(f.invocations,[]);
});

test('fresh installation unknown effect reconciles via one verified native uninstall',async()=>{
  const f=fixture('linux');f.input.installationKind='fresh';
  f.setVersion(null);f.setMode('throw-after-effect');
  await assert.rejects(executeNativeTransaction({
    action:'apply',...f
  }),{code:'UNIVERSAL_NATIVE_EFFECT_FAILED_ROLLED_BACK'});
  assert.deepEqual(f.invocations,['install','uninstall']);
  assert.equal(f.getVersion(),null);
  assert.ok(f.events.includes('ROLLBACK_VERIFIED'));
});

test('owner-only receipt journal permits version=null exclusively for clean first-install recovery',async()=>{
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-native-qa-'));
  try{
    const dir=path.join(root,'journal'),j=createNativeFileJournal({directory:dir});
    await j.claim('a'.repeat(64));
    await j.write('ROLLBACK_STARTED',{action:'rollback',version:null});
    await assert.rejects(j.write('VERIFIED',{action:null}),{
      code:'UNIVERSAL_NATIVE_JOURNAL_DATA_REJECTED'
    });
    await j.write('ROLLBACK_VERIFIED',{action:'rollback',version:null});
    await j.close();
    assert.equal(fs.existsSync(path.join(dir,'install.lock')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('general release ordering handles dev-to-stable, next minor and 1.0 without host patches',()=>{
  const original=fixture('linux').input;
  for(const [previous,candidate] of [
    ['0.12.0-dev.9','0.12.0'],
    ['0.12.0','0.13.0-dev.1'],
    ['0.13.0-dev.50','0.13.0'],
    ['0.19.9','1.0.0'],
    ['0.99.0','1.0.0-dev.1']
  ]){
    const result=verifyNativePlanInput({...original,
      previous:{...original.previous,version:previous},
      candidate:{...original.candidate,version:candidate}
    });
    assert.equal(result.candidate.version,candidate);
  }
  for(const [previous,candidate] of [
    ['0.12.0','0.12.0-dev.99'],
    ['0.13.0-dev.10','0.13.0-dev.9'],
    ['1.0.0','0.99.0'],
    ['1.0.0','1.0.0'],
    ['0.12.0','v1.0.0'],
    ['0.12.0','1.0.0-rc.1']
  ]){
    assert.throws(()=>verifyNativePlanInput({...original,
      previous:{...original.previous,version:previous},
      candidate:{...original.candidate,version:candidate}
    }));
  }
});

test('fresh single artifact: no historical package, one common install/uninstall on both OSes',async()=>{
  for(const platform of ['windows','linux']){
    const f=fixture(platform);
    f.input.installationKind='fresh';
    f.input.previous=null;
    f.setVersion(null);
    let inspected=0;
    const original=f.adapter.inspect;
    f.adapter.inspect=async input=>{inspected++;return original(input);};
    const plan=await executeNativeTransaction({
      action:'plan',input:f.input,adapter:f.adapter
    });
    assert.equal(plan.status,'READY_TO_FIRST_INSTALL');
    assert.equal(plan.plan.previous,null);
    assert.equal(plan.plan.rollbackArtifactVerified,false);
    assert.equal(plan.plan.rollbackTarget,'NATIVE_ABSENCE');
    assert.equal(inspected,1);
    assert.equal(f.invocations.length,0);
    const upgraded=await executeNativeTransaction({action:'apply',...f});
    assert.equal(upgraded.status,'NATIVE_PACKAGE_FIRST_INSTALLED');
    assert.equal(f.getVersion(),'0.12.0-dev.9');
    const undone=await executeNativeTransaction({action:'rollback',...f});
    assert.equal(undone.status,'NATIVE_PACKAGE_ROLLED_BACK');
    assert.equal(f.getVersion(),null);
    assert.deepEqual(f.invocations,['install','uninstall']);
  }
});

test('an upgrade with no previous artifact must fail before native effect',async()=>{
  const f=fixture('windows');
  f.input.previous=null;
  assert.throws(()=>verifyNativePlanInput(f.input),
    {code:'UNIVERSAL_NATIVE_UPGRADE_PREVIOUS_REQUIRED'});
  assert.equal(f.invocations.length,0);
});


test('same scoped approval cannot be replayed for rollback on either OS',async()=>{
  for(const platform of ['windows','linux']){
    const f=fixture(platform);
    const first=await executeNativeTransaction({
      action:'plan',input:f.input,adapter:f.adapter
    });
    assert.equal(first.status,'READY_TO_APPLY');
    const applied=await executeNativeTransaction({action:'apply',...f});
    assert.equal(applied.status,'NATIVE_PACKAGE_UPGRADED');
    assert.equal(applied.transactionId,first.transactionId);
    const installed=await executeNativeTransaction({
      action:'plan',input:f.input,adapter:f.adapter
    });
    assert.equal(installed.status,'ALREADY_INSTALLED');
    assert.notEqual(installed.transactionId,first.transactionId);
    const count=f.invocations.length;
    await assert.rejects(executeNativeTransaction({
      action:'rollback',input:f.input,adapter:f.adapter,journal:f.journal,
      approve:async()=>({kind:'native-owner-install-approval',approved:true,
        transactionId:first.transactionId})
    }),{code:'UNIVERSAL_NATIVE_OWNER_APPROVAL_REQUIRED'});
    assert.equal(f.invocations.length,count);
    assert.equal(f.getVersion(),f.input.candidate.version);
    const rollback=await executeNativeTransaction({action:'rollback',...f});
    assert.equal(rollback.status,'NATIVE_PACKAGE_ROLLED_BACK');
    assert.equal(rollback.transactionId,installed.transactionId);
    assert.equal(f.getVersion(),f.input.previous.version);
  }
});

test('fresh first install and native uninstall require distinct owner approval',async()=>{
  for(const platform of ['windows','linux']){
    const f=fixture(platform);
    f.input.installationKind='fresh';
    f.setVersion(null);
    const first=await executeNativeTransaction({
      action:'plan',input:f.input,adapter:f.adapter
    });
    assert.equal(first.status,'READY_TO_FIRST_INSTALL');
    await executeNativeTransaction({action:'apply',...f});
    const installed=await executeNativeTransaction({
      action:'plan',input:f.input,adapter:f.adapter
    });
    assert.equal(installed.status,'ALREADY_INSTALLED');
    assert.notEqual(first.transactionId,installed.transactionId);
    const count=f.invocations.length;
    await assert.rejects(executeNativeTransaction({
      action:'rollback',input:f.input,adapter:f.adapter,journal:f.journal,
      approve:async()=>({kind:'native-owner-install-approval',approved:true,
        transactionId:first.transactionId})
    }),{code:'UNIVERSAL_NATIVE_OWNER_APPROVAL_REQUIRED'});
    assert.equal(f.invocations.length,count);
    const rollback=await executeNativeTransaction({action:'rollback',...f});
    assert.equal(rollback.status,'NATIVE_PACKAGE_ROLLED_BACK');
    assert.equal(rollback.transactionId,installed.transactionId);
    assert.equal(f.getVersion(),null);
  }
});
