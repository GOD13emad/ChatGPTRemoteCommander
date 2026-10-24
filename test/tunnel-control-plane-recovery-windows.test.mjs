import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Windows Tunnel recovery guards and owner', {skip: process.platform!=='win32'}, () => {
  const f=fileURLToPath(new URL('./tunnel-control-plane-recovery-windows.tests.ps1',import.meta.url));
  const r=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-File',f],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0,(r.stdout||'')+(r.stderr||''));
  assert.match(r.stdout,/PASS=\d+/);
});
