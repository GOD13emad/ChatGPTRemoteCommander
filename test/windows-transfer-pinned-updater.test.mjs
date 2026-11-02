import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const updater=readFileSync('auto-update-windows.ps1','utf8');
const builder=readFileSync('tools/build-candidate-config.mjs','utf8');
test('Windows native updater exposes explicit, scoped transfer opt-in',()=>{
 assert.match(updater,/\[string\]\$TransferRoot\s*=\s*''/);
 assert.match(updater,/WINDOWS_TRANSFER_ROOT_NOT_ABSOLUTE/);
 assert.match(updater,/if\(\$TransferRoot\)\{\$buildArgs\+=@\('--transfer-root',\$TransferRoot\)\}/);
 assert.match(updater,/if\(\$TransferRoot\)\{\$finalArgs\+=@\('--transfer-root',\$TransferRoot\)\}/);
 for(const x of ['TRANSFER_OPTIN_ROOT_ABSOLUTE','TRANSFER_OPTIN_ROOT_TOO_BROAD','TRANSFER_OPTIN_PATH_UNTRUSTED','TRANSFER_OPTIN_EXISTING_POLICY_CONFLICT'])
  assert.ok(builder.includes(x),x);
});
test('Windows local-source stage is pinned and never default',()=>{
 assert.match(updater,/\[string\]\$LocalSourceRepository\s*=\s*''/);
 assert.match(updater,/\$Repo='https:\/\/github\.com\/GOD13emad\/ChatGPTRemoteCommander\.git'/);
 assert.match(updater,/WINDOWS_LOCAL_SOURCE_PIN_REQUIRED/);
 assert.match(updater,/WINDOWS_LOCAL_SOURCE_COMMIT_MISMATCH/);
 assert.match(updater,/WINDOWS_LOCAL_SOURCE_NOT_GIT/);
 assert.match(updater,/WINDOWS_LOCAL_SOURCE_INVALID/);
 assert.ok(updater.indexOf('WINDOWS_LOCAL_SOURCE_PIN_REQUIRED')<updater.indexOf('$StateRoot='));
 assert.match(updater,/if\(\$LocalSourceRepository\)\{/);
 assert.match(updater,/\$Repo=\$LocalSourceRepository/);
 assert.match(updater,/STAGE_EXPECTED_COMMIT_MISMATCH/);
 assert.match(updater,/git\.exe -C \$tmp fetch --depth 1 --no-tags origin \$Ref/);
 assert.match(updater,/Local\\ChatGPTRemoteCommanderAutoUpdater/);
});
test('Windows RuntimeOnly promotion preserves dirty Control and supervisor',()=>{
 assert.match(updater, /\[switch\]\$RuntimeOnly,/);
 assert.match(updater, /RUNTIME_ONLY_REQUIRES_FORCE_PINNED_LOCAL_SOURCE_PROMOTION/);
 assert.match(updater, /if\(\$RuntimeOnly\)\{\s*Log "CONTROL_PROMOTION_DEFER mode=RUNTIME_ONLY/);
 assert.match(updater, /if\(\$RuntimeOnly\)\{\s*Log 'SUPERVISOR_RECYCLE_DEFER mode=RUNTIME_ONLY'/);
 assert.match(updater, /if\(\$RuntimeOnly\)\{\s*Log 'RELEASE_CLEANUP_DEFER mode=RUNTIME_ONLY'/);
 assert.match(updater, /\$report\.controlMode='PRESERVED_WITHOUT_CHECKOUT'/);
 assert.match(updater, /\$report\.supervisorMode='UNCHANGED'/);
 assert.match(updater, /PROMOTED_RUNTIME_ONLY_DRAIN_PENDING/);
 assert.match(updater, /PROMOTED_RUNTIME_ONLY'/);
 assert.match(updater, /CONTROL_TRACKED_DIRTY/);
 assert.match(updater, /SCHEMA_CONTINUITY_GATE_FAIL/);
 assert.match(updater, /if\(\$NoPromote\)\{/);
});
test('Windows source/transfer gates are inert unless explicitly enabled',()=>{
 assert.ok(!updater.includes("$TransferRoot=(Join-Path"));
 assert.ok(!updater.includes('$Repo=$LocalSourceRepository\n$StateRoot='));
 assert.ok(updater.includes('if($TransferRoot){$buildArgs'));
 assert.ok(updater.includes('if($TransferRoot){$finalArgs'));
 assert.ok(updater.includes("if($LocalSourceRepository){"));
});
