import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {evaluateExecutionScope,loadExecutionScope,dispatchScopedTask} from '../src/execution-scope.mjs';

const policy={schema:1,generation:1,revision:'BUILD-V03-SCOPE-R1',authority:'human',gameEnabled:false,videoEnabled:false,coreBuildEnabled:true,browserMonitorBuildEnabled:true,runtimeInstalled:false,automaticPromotion:false};
for(const category of ['GAME','VIDEO']) {
  test(category+' remains disabled even if caller proposes enable',()=>{
    assert.equal(evaluateExecutionScope({category},policy).code,'USER_PAUSED');
    assert.equal(evaluateExecutionScope({category},{...policy,gameEnabled:true,videoEnabled:true}).allowed,false);
  });
  test(category+' never reaches an executor',async()=>{
    let calls=0;
    const result=await dispatchScopedTask({category},policy,async()=>{calls++;});
    assert.equal(calls,0);assert.equal(result.allowed,false);
  });
}
test('core and browser build stay admitted but not promoted',()=>{
  for(const category of ['CORE_BUILD','BROWSER_MONITOR_BUILD']) {
    const r=evaluateExecutionScope({category},policy);
    assert.equal(r.allowed,true);assert.equal(r.promotionAllowed,false);
  }
});
test('unknown category fails closed',()=>assert.equal(evaluateExecutionScope({category:'SHELL'},policy).allowed,false));
test('invalid or absent policy fails closed',()=>{
  for(const p of [null,{}, {...policy,schema:2},{...policy,automaticPromotion:true}]) assert.equal(evaluateExecutionScope({category:'CORE_BUILD'},p).allowed,false);
});
test('getters and proxies are not executed',()=>{
  let calls=0;const p={...policy};Object.defineProperty(p,'gameEnabled',{get(){calls++;return false;}});
  assert.equal(evaluateExecutionScope({category:'GAME'},p).allowed,false);
  assert.equal(evaluateExecutionScope({category:'CORE_BUILD'},new Proxy(policy,{})).allowed,false);
  assert.equal(calls,0);
});
test('explicit scope dispatcher invokes only admitted build adapter',async()=>{
  let calls=0;const result=await dispatchScopedTask({category:'CORE_BUILD'},policy,async()=>{calls++;return 'built';});
  assert.equal(calls,1);assert.equal(result.result,'built');
});
test('persisted policy reload has exact expected hash',()=>{
  const file=fileURLToPath(new URL('../../control/EXECUTION_SCOPE.json',import.meta.url));
  const digest=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const result=loadExecutionScope(file,digest);
  assert.equal(result.policy.gameEnabled,false);assert.equal(result.policy.videoEnabled,false);
  assert.equal(result.sha256,digest);
});
test('wrong hash, relative path and missing input deny load',()=>{
  const file=fileURLToPath(new URL('../../control/EXECUTION_SCOPE.json',import.meta.url));
  assert.throws(()=>loadExecutionScope(file,'0'.repeat(64)),/SCOPE_HASH_MISMATCH/);
  assert.throws(()=>loadExecutionScope(path.basename(file),'0'.repeat(64)),/SCOPE_ABSOLUTE_PATH_REQUIRED/);
  assert.throws(()=>loadExecutionScope(file,null),/SCOPE_EXPECTED_HASH_REQUIRED/);
});
test('scope loader uses finite explicit reads, not an unbounded fd reader',()=>{
  const file=fileURLToPath(new URL('../../control/EXECUTION_SCOPE.json',import.meta.url));
  const digest=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const original=fs.readFileSync;
  fs.readFileSync=()=>{throw new Error('UNBOUNDED_READER_FORBIDDEN');};
  try {assert.equal(loadExecutionScope(file,digest).sha256,digest);}
  finally {fs.readFileSync=original;}
});
