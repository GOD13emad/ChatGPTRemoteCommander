import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseSignedPair} from './universal-native-coordinator-hosted.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script=path.join(root,'test','universal-native-coordinator-hosted.mjs');
function invoke(args,env){
  const r=spawnSync(process.execPath,[script,...args],{
    cwd:root,env,encoding:'utf8',windowsHide:true,timeout:12000
  });
  assert.equal(r.error,undefined,String(r.error??''));
  return r;
}
test('the hosted real native executor refuses any owner host and incomplete source pins',()=>{
  const head=spawnSync('git',['-C',root,'rev-parse','HEAD'],
    {encoding:'utf8'}).stdout.trim();
  const env={...process.env,CI:'false',GITHUB_ACTIONS:'false',
    RUNNER_ENVIRONMENT:'local'};
  for(const args of [
    [],
    ['--plan','--expected-commit',head],
    ['--run','--expected-commit','0'.repeat(40)]
  ]){
    const r=invoke(args,env);
    assert.equal(r.status,2);
    assert.equal(JSON.parse(r.stderr).productionPromotion,false);
  }
  const refused=invoke(['--run','--expected-commit',head],env);
  assert.equal(refused.status,2);
  assert.equal(JSON.parse(refused.stderr).reason,
    'RC012_HOSTED_NATIVE_COORDINATOR_CI_ONLY');
  const signedRefused=invoke(['--run-signed-pair','--expected-commit',head],env);
  assert.equal(signedRefused.status,2);
  assert.equal(JSON.parse(signedRefused.stderr).reason,
    'RC012_HOSTED_NATIVE_COORDINATOR_CI_ONLY');
});

test('a signed upgrade pair pins two ordered, distinct immutable package sources',()=>{
  const baseline={run:'123',head:'a'.repeat(40),version:'0.12.0-dev.12'};
  const candidate={run:'456',head:'b'.repeat(40),version:'0.12.0-dev.13'};
  const pair=[baseline,candidate];
  assert.deepEqual(parseSignedPair(JSON.stringify(pair)),pair);
  for(const invalid of [
    [candidate,baseline],
    [baseline,{...candidate,run:baseline.run}],
    [baseline,{...candidate,head:baseline.head}],
    [baseline,{...candidate,version:baseline.version}],
    [baseline,{...candidate,version:'0.12.0-dev.013'}],
    [baseline,{...candidate,run:'--repo'}],
    [baseline,{...candidate,path:'/tmp/installer'}],
    [baseline,{...candidate,head:'main'}],
    [baseline]
  ])assert.throws(()=>parseSignedPair(JSON.stringify(invalid)),{
    code:'RC012_HOSTED_SIGNED_PAIR_INVALID'
  });
});
