import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync('desktop/profile-manager-windows.ps1', 'utf8');

function guardSource() {
  const start = source.indexOf('function Assert-EditableSelection(');
  const end = source.indexOf('$form=New-Object Windows.Forms.Form', start);
  assert.ok(start >= 0 && end > start, 'owner-only selection guard should be an independently testable function');
  return source.slice(start, end);
}

test('shared account and headless worker are explicitly read-only at the action boundary', () => {
  const guard = guardSource();
  assert.match(guard, /Selection\.IsPrimary\s+-or\s+\$Selection\.IsIsolated/);
  assert.match(guard, /read-only/);
  assert.match(guard, /Profile route or permission boundary changed/);
  const apply = source.slice(source.indexOf('$apply.Add_Click({'), source.indexOf('$add.Add_Click({'));
  assert.ok(apply.includes('Assert-EditableSelection'));
  assert.ok(apply.includes('@(Get-Profiles)'));
  assert.ok(apply.indexOf('Assert-EditableSelection') < apply.indexOf('Invoke-HiddenPwsh'));
});

test('policy hash is captured at selection and checked again before a mutating command', () => {
  const guard = guardSource();
  assert.match(guard, /Get-FileHash\s+-LiteralPath\s+\$file\s+-Algorithm\s+SHA256/);
  assert.match(guard, /\$fresh\.Generation\s+-ne\s+\[int\]\$Selection\.Generation/);
  assert.match(guard, /\$fresh\.ConfigPath\s+-ne\s+\[string\]\$Selection\.ConfigPath/);
  assert.match(guard, /FileAttributes\]::ReparsePoint/);
  assert.ok(source.includes('$script:selectedFingerprint='));
  assert.ok(source.includes('Account tunnel') || source.includes('Shared (inherited)'));
});

test('native Windows guard rejects a shared account and stale policy, but accepts an unchanged isolated profile', t => {
  if (process.platform !== 'win32') {
    t.skip('native PowerShell behavior verified on Windows fleet; this CI runner is not Windows');
    return;
  }
  const ps = String.raw`
$ErrorActionPreference='Stop'
` + guardSource() + String.raw`
$file=Join-Path $env:TEMP ('rc-access-guard-'+[Guid]::NewGuid().ToString('N')+'.json')
try {
  [IO.File]::WriteAllText($file,'{"test":true}')
  $hash=(Get-FileHash $file -Algorithm SHA256).Hash
  $valid=[pscustomobject]@{Profile='synthetic-isolated';IsPrimary=$false;IsIsolated=$true;ConfigPath=$file;Commit='testsha';Generation=2}
  if(-not(Assert-EditableSelection $valid @($valid) $hash)){throw 'ISOLATED_REJECTED'}
  $shared=[pscustomobject]@{Profile='saeid-secondary';IsPrimary=$false;IsIsolated=$false;ConfigPath=$file;Commit='testsha';Generation=2}
  $denied=$false
  try{[void](Assert-EditableSelection $shared @($shared) $hash)}catch{$denied=$true}
  if(!$denied){throw 'SHARED_UNEXPECTEDLY_EDITABLE'}
  $changed=[pscustomobject]@{Profile='synthetic-isolated';IsPrimary=$false;IsIsolated=$true;ConfigPath=$file;Commit='testsha';Generation=3}
  $denied=$false
  try{[void](Assert-EditableSelection $valid @($changed) $hash)}catch{$denied=$true}
  if(!$denied){throw 'ROUTE_DRIFT_UNDETECTED'}
  [IO.File]::AppendAllText($file,' ')
  $denied=$false
  try{[void](Assert-EditableSelection $valid @($valid) $hash)}catch{$denied=$true}
  if(!$denied){throw 'POLICY_DRIFT_UNDETECTED'}
  'NATIVE_ACCESS_GUARD_PASS'
} finally {Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
`;
  const result = spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''));
  assert.match(result.stdout, /NATIVE_ACCESS_GUARD_PASS/);
});
