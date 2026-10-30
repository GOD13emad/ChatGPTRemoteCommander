import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const autostart=readFileSync('autostart-windows.ps1','utf8');
const elevated=readFileSync('elevated-runtime-entry-windows.ps1','utf8');

test('ordinary supervisor retains legacy no-op on duplicate without fail flag',()=>{
  assert.match(autostart,/\[switch\]\$FailIfRunning/);
  assert.match(autostart,/if \(-not \$created\) \{\s*if \(\$FailIfRunning\) \{/);
  assert.match(autostart,/exit 0\s*\}/);
});
test('explicit elevated entry refuses silent success when mutex is already owned',()=>{
  assert.match(autostart,/ADMIN_RUNTIME_EXISTING_SUPERVISOR_REQUIRES_CONTROLLED_HANDOFF/);
  assert.match(elevated,/& \$supervisor -FailIfRunning/);
  assert.doesNotMatch(elevated,/& \$supervisor\s*\nexit \$LASTEXITCODE/);
});
test('UAC/elevated token proof and ProbeOnly gate precede any supervisor launch',()=>{
  const p=elevated.indexOf('if(-not $isAdmin)');
  const q=elevated.indexOf('if($ProbeOnly){exit 0}');
  const launch=elevated.indexOf('& $supervisor -FailIfRunning');
  assert.ok(p>=0 && q>p && launch>q);
  assert.match(elevated,/\[Security\.Principal\.WindowsPrincipal\]/);
});

// Source-only guard: native cross-session SYSTEM/owner admission remains a release gate.
test('admin supervisor uses cross-session mutex namespace instead of Local session scope',()=>{
  assert.match(autostart,/\[Threading\.Mutex\]::new\(\$false,\s*'Global\\ChatGPTRemoteCommanderSupervisor'/);
  assert.doesNotMatch(autostart,/'Local\\ChatGPTRemoteCommanderSupervisor'/);
});
