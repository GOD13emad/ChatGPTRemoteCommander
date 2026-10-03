import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundNodeTestConcurrency, parseQualificationArgs, prioritizeSensitiveQualificationCommands } from '../tools/run-bounded-test-script.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('qualification paths bound full test file concurrency',()=>{
  const pkg=JSON.parse(read('package.json'));
  const original=pkg.scripts.test;
  const result=boundNodeTestConcurrency(original,2);
  const checkOriginal=pkg.scripts.check;
  const checkResult=boundNodeTestConcurrency(checkOriginal,2);
  const originalCount=(original.match(/node --test /g)||[]).length;
  const boundedCount=(result.command.match(/node --test --test-concurrency=2 /g)||[]).length;
  assert.ok(originalCount>=1);
  assert.equal(result.replacements,originalCount);
  assert.equal(boundedCount,originalCount);
  assert.equal(result.command.includes('node --test test/'),false);
  const checkOriginalCount=(checkOriginal.match(/node --test /g)||[]).length;
  const checkBoundedCount=(checkResult.command.match(/node --test --test-concurrency=2 /g)||[]).length;
  assert.ok(checkOriginalCount>=1);
  assert.equal(checkResult.replacements,checkOriginalCount);
  assert.equal(checkBoundedCount,checkOriginalCount);
  assert.equal(checkResult.command.includes('node --test test/'),false);
  assert.equal(pkg.scripts['check:qualification'],'node tools/run-bounded-test-script.mjs --script check --concurrency 2');
  assert.equal(pkg.scripts['test:qualification'],'node tools/run-bounded-test-script.mjs --script test --concurrency 2');
  for (const sensitive of ['test/workflow-http.test.mjs','test/async-operations.test.mjs','test/tunnel-log-rotation.test.mjs','test/mcp-tasks-extension.test.mjs']) {
    for (const scriptName of ['check','test']) {
      const script = pkg.scripts[scriptName];
      assert.equal((script.match(new RegExp(sensitive.replaceAll('.', '[.]'), 'g')) || []).length, 1, `${scriptName} must reference ${sensitive} exactly once`);
      assert.ok(script.includes(`node --test ${sensitive}`), `${scriptName} must run ${sensitive} as an isolated test-file command`);
    }
  }
  const wrapper=read('tools/run-bounded-test-script.mjs');
  assert.ok(wrapper.includes("args.prioritizeSensitive||process.platform==='win32'"),'Windows updater qualification must prioritize isolated sensitive fixtures automatically');
  assert.ok(wrapper.includes("effectiveConcurrency=process.platform==='win32'?1:requestedConcurrency"),'Windows installer/updater qualification must use deterministic concurrency=1 under workstation load');
  const workflow=read('.github/workflows/ci.yml');
  assert.ok(workflow.includes("if: runner.os == 'Windows'"));
  assert.ok(workflow.includes('run: node tools/run-bounded-test-script.mjs --script check --concurrency 1 --prioritize-sensitive 1'));
  assert.equal(workflow.includes('run: npm run check:qualification'),false);
  assert.ok(workflow.includes('run: node tools/run-bounded-test-script.mjs --script test --concurrency 1 --prioritize-sensitive 1'));
  assert.equal(workflow.includes('run: npm run test:qualification'),false);
  assert.ok(workflow.includes("if: runner.os != 'Windows'"));
  assert.ok(workflow.includes('run: npm run check'));
  assert.ok(workflow.includes('run: npm test'));
  const installPs1=read('install.ps1');
  const installSh=read('install.sh');
  const updateLinux=read('auto-update-linux.sh');
  const updateWindows=read('auto-update-windows.ps1');
  assert.ok(installPs1.includes('& npm.cmd run check:qualification'));
  assert.ok(installPs1.includes('& npm.cmd run test:qualification'));
  assert.ok(installSh.includes('npm run check:qualification'));
  assert.ok(installSh.includes('npm run test:qualification'));
  assert.ok(updateLinux.includes('run_gate "$STAGE_DIR" check npm run check:qualification'));
  assert.ok(updateLinux.includes('run_gate "$STAGE_DIR" test npm run test:qualification'));
  assert.ok(updateWindows.includes("Run-Gate $stage.Dir 'check' @('run','check:qualification')"));
  assert.ok(updateWindows.includes("Run-Gate $stage.Dir 'test' @('run','test:qualification')"));
});

test('bounded test wrapper rejects unsafe configuration',()=>{
  assert.throws(()=>boundNodeTestConcurrency('node --test test/a.test.mjs',0),/CI_TEST_CONCURRENCY_INVALID/);
  assert.throws(()=>boundNodeTestConcurrency('node test/a.mjs',2),/CI_TEST_COMMAND_MISSING/);
  assert.deepEqual(parseQualificationArgs(['--script','test','--concurrency','2']),{script:'test',concurrency:'2',prioritizeSensitive:false});
  assert.deepEqual(parseQualificationArgs(['--script','check','--concurrency','2']),{script:'check',concurrency:'2',prioritizeSensitive:false});
  assert.deepEqual(parseQualificationArgs(['--script','test','--concurrency','1','--prioritize-sensitive','1']),{script:'test',concurrency:'1',prioritizeSensitive:true});
  assert.throws(()=>parseQualificationArgs(['--script','audit','--concurrency','2']),/CI_TEST_SCRIPT_NOT_ALLOWED/);
});


test('hosted Windows priority mode runs scheduler-sensitive isolated fixtures before the bulk qualification batch',()=>{
  const pkg=JSON.parse(read('package.json'));
  for(const scriptName of ['check','test']){
    const bounded=boundNodeTestConcurrency(pkg.scripts[scriptName],1).command;
    const prioritized=prioritizeSensitiveQualificationCommands(bounded);
    const bulkIndex=prioritized.indexOf('test/boot-recovery-diagnostics.test.mjs');
    assert.ok(bulkIndex>0,'bulk qualification command must remain present');
    const ordered=['test/mcp-tasks-extension.test.mjs','test/tunnel-log-rotation.test.mjs','test/async-operations.test.mjs','test/workflow-http.test.mjs'];
    const positions=ordered.map(sensitive=>prioritized.indexOf(sensitive));
    for(let i=0;i<ordered.length;i++) assert.ok(positions[i]>=0 && positions[i]<bulkIndex, ordered[i]+' must execute before bulk qualification');
    assert.ok(positions.every((position,index)=>index===0||positions[index-1]<position), 'sensitive fixtures must preserve deterministic priority order');
  }
});
