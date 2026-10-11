import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../desktop/install-windows.ps1',import.meta.url),'utf8').replace(/\r\n/g,'\n');
test('R203 idempotent one current, no overwrite and no duplicate installation',()=>{
  assert.match(s,/R203_VERSION_PATH_ALREADY_EXISTS_NO_OVERWRITE/);
  assert.match(s,/R203_ALREADY_CURRENT_FILE_HASH_DRIFT/);
  assert.match(s,/REMOTE_COMMANDER_UI_ALREADY_CURRENT_VERIFIED/);
  assert.doesNotMatch(s,/Remove-Item -LiteralPath \$Current -Force -Recurse/);
  assert.match(s,/R203_UNRESOLVED_PRIOR_TRANSACTION/);
});
test('R203 verify content before commit and fail-closed prior route restoration',()=>{
  const verify=s.indexOf('R203_STAGED_PAYLOAD_SHA_MISMATCH_');
  const commit=s.indexOf('Move-Item -LiteralPath $stage -Destination $VersionDir');
  const prev=s.indexOf('Move-Item -LiteralPath $Current -Destination $rollback');
  const activate=s.indexOf('Move-Item -LiteralPath $pending -Destination $Current');
  const rollback=s.indexOf('Move-Item -LiteralPath $rollback -Destination $Current');
  assert.ok(verify>0&&commit>verify&&prev>commit&&activate>prev&&rollback>activate);
  assert.match(s,/R203_RESTORED_BASELINE_POINTER_MISMATCH/);
  assert.match(s,/R203_TRANSACTION_DEGRADED_ROLLBACK_UNRESOLVED/);
});
test('R203 test faults cannot modify public integration nor personal browser data',()=>{
  assert.match(s,/R203_FAULT_INJECTION_REQUIRES_ISOLATION/);
  assert.match(s,/R203_ISOLATED_ROOT_OUTSIDE_DEVELOPMENT/);
  const swap=s.indexOf('Move-Item -LiteralPath $pending -Destination $Current');
  const exit=s.indexOf('REMOTE_COMMANDER_UI_PRIVATE_TRANSACTION_PASS',swap);
  const menu=s.indexOf('$Wsh=New-Object -ComObject WScript.Shell',swap);
  const reg=s.indexOf("New-Item -Path $Reg -Force",swap);
  assert.ok(swap>0&&exit>swap&&menu>exit&&reg>menu);
  assert.match(s,/R203_SYNTHETIC_AFTER_BASELINE_MOVE/);
  assert.match(s,/R203_SYNTHETIC_AFTER_CANDIDATE_MOVE/);
  assert.doesNotMatch(s,/\bchatgpt-cef-v2\b/i);
});
