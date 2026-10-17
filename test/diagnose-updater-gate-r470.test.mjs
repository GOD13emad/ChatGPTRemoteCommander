import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const win=process.platform==='win32';
const onWindows=(label,fn)=>test(label,{skip:!win,timeout:20000},fn);
const tool=fileURLToPath(new URL('../tools/diagnose-updater-gate-r470.ps1',import.meta.url));
const head='c'.repeat(40);
const label='benign public diagnostics fixture';

function probe(logs){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rcm-r470-diagnostic-'));
  try{
    const folder=path.join(root,'STATE','ChatGPTRemoteCommander','update-logs');
    fs.mkdirSync(folder,{recursive:true});
    logs.forEach((body,i)=>fs.writeFileSync(
      path.join(folder,`qualification-output-qualification-test-${head.slice(0,12)}-case-${i}.stdout.log`),body,'utf8'));
    const result=spawnSync('pwsh.exe',[
      '-NoLogo','-NoProfile','-NonInteractive','-File',tool,
      '-Root',root,'-ExpectedCommit',head,
    ],{encoding:'utf8',timeout:12000,windowsHide:true});
    assert.equal(result.error,undefined);
    assert.equal(result.status,0,(result.stderr||'').slice(-750));
    const diagnostic=JSON.parse(fs.readFileSync(path.join(root,'DIAGNOSTIC_R470.json'),'utf8'));
    assert.equal(diagnostic.schema,1);
    assert.equal(diagnostic.revision,'R470');
    assert.equal(diagnostic.commit,head);
    assert.equal(diagnostic.rawLogIncluded,false);
    assert.equal(diagnostic.secretsIncluded,false);
    assert.equal(diagnostic.absolutePathsIncluded,false);
    assert.equal(diagnostic.stablePromoted,false);
    return diagnostic;
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
}

onWindows('R470 recognizes real Node spec reporter failure exactly once',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rcm-r470-failing-spec-'));
  try{
    const fixture=path.join(root,'benign.test.mjs');
    fs.writeFileSync(fixture,
      `import test from 'node:test';import assert from 'node:assert/strict';test('${label}',()=>assert.equal(1,2));`,
      'utf8');
    // The outer node:test worker exports NODE_TEST_CONTEXT. Inheriting it
    // causes a nested Node test process to behave as an existing test worker
    // instead of an independent failing runner (false zero exit).
    const childEnv={...process.env};
    delete childEnv.NODE_TEST_CONTEXT;
    const failed=spawnSync(process.execPath,['--test','--test-reporter=spec',fixture],{
      encoding:'utf8',timeout:8000,windowsHide:true,env:childEnv});
    assert.equal(failed.status,1);
    const output=(failed.stdout||'')+'\n'+(failed.stderr||'');
    assert.match(output,/✖/u);
    assert.match(output,/ℹ fail 1/u);
    const report=probe([output]);
    assert.equal(report.status,'NODE_SPEC_SUMMARY_EXTRACTED');
    assert.equal(report.reporterFormat,'NODE_SPEC');
    assert.equal(report.matchingLogCount,1);
    assert.equal(report.tapCounts.fail,'1');
    assert.equal(report.failureTests.length,1);
    assert.equal(report.failureTests[0].publicTestName,label);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

onWindows('R470 still parses legacy TAP and fail count',()=>{
  const report=probe([
    'TAP version 13\nnot ok 1 - public legacy fixture\n# tests 1\n# pass 0\n# fail 1\n']);
  assert.equal(report.status,'TAP_SUMMARY_EXTRACTED');
  assert.equal(report.reporterFormat,'TAP');
  assert.equal(report.tapCounts.fail,'1');
  assert.deepEqual(report.failureTests,[{index:1,publicTestName:'public legacy fixture'}]);
});

onWindows('R470 strips sensitive test names from Node spec output',()=>{
  const report=probe([
    '✖ bearer=sample and C:\\Users\\private-user\\secrets.txt (1.23ms)\nℹ tests 1\nℹ fail 1\n']);
  assert.equal(report.status,'NODE_SPEC_SUMMARY_EXTRACTED');
  assert.equal(report.failureTests.length,1);
  assert.equal(report.failureTests[0].publicTestName,'REDACTED_TEST_NAME');
  assert.equal(JSON.stringify(report).includes('private-user'),false);
});

onWindows('R470 does not claim successful extraction from unknown output',()=>{
  const report=probe(['unrecognized short output without test markers\n']);
  assert.equal(report.status,'FORMAT_UNRECOGNIZED');
  assert.equal(report.reporterFormat,'UNKNOWN');
  assert.deepEqual(report.failureTests,[]);
});

onWindows('R470 declines ambiguous multiple matching logs',()=>{
  const report=probe(['ℹ fail 1\n','ℹ fail 2\n']);
  assert.equal(report.status,'AMBIGUOUS_MULTIPLE_MATCHING_LOGS');
  assert.equal(report.matchingLogCount,2);
  assert.deepEqual(report.failureTests,[]);
});
