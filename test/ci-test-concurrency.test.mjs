import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundNodeTestConcurrency, parseQualificationArgs } from '../tools/run-bounded-test-script.mjs';

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
  for (const sensitive of ['test/workflow-http.test.mjs','test/async-operations.test.mjs','test/tunnel-log-rotation.test.mjs']) {
    for (const scriptName of ['check','test']) {
      const script = pkg.scripts[scriptName];
      assert.equal((script.match(new RegExp(sensitive.replaceAll('.', '[.]'), 'g')) || []).length, 1, `${scriptName} must reference ${sensitive} exactly once`);
      assert.ok(script.includes(`node --test ${sensitive}`), `${scriptName} must run ${sensitive} as an isolated test-file command`);
    }
  }
  const workflow=read('.github/workflows/ci.yml');
  assert.ok(workflow.includes("if: runner.os == 'Windows'"));
  assert.ok(workflow.includes('run: node tools/run-bounded-test-script.mjs --script check --concurrency 1'));
  assert.equal(workflow.includes('run: npm run check:qualification'),false);
  assert.ok(workflow.includes('run: node tools/run-bounded-test-script.mjs --script test --concurrency 1'));
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
  assert.deepEqual(parseQualificationArgs(['--script','test','--concurrency','2']),{script:'test',concurrency:'2'});
  assert.deepEqual(parseQualificationArgs(['--script','check','--concurrency','2']),{script:'check',concurrency:'2'});
  assert.throws(()=>parseQualificationArgs(['--script','audit','--concurrency','2']),/CI_TEST_SCRIPT_NOT_ALLOWED/);
});
