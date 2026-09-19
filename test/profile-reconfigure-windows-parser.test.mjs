import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Windows reconfigure script parses without executing', t => {
  if (process.platform !== 'win32') { t.skip('Windows-only parser gate'); return; }
  const command="$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'reconfigure-profile-instance.ps1'),[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|% Message;exit 2}";
  const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8'});
  assert.equal(r.status,0,(r.stdout||'')+(r.stderr||''));
});
