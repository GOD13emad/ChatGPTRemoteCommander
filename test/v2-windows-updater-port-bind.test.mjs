import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const updater=path.join(root,'auto-update-windows.ps1');
const source=fs.readFileSync(updater,'utf8');
const selectBlock=source.slice(source.indexOf('function Get-FreePort('),source.indexOf('function Test-VersionGreater('));
test('Windows candidate port selection uses exclusive loopback bind, not CIM enumeration',()=>{
  assert.match(selectBlock,/ExclusiveAddressUse=\$true/);
  assert.match(selectBlock,/\.Bind\(\[Net\.IPEndPoint\]::new\(\[Net\.IPAddress\]::Loopback,\$p\)\)/);
  assert.doesNotMatch(selectBlock,/Get-NetTCPConnection/);
});
test('candidate cleanup requires the spawned process, exact runtime marker and matching health identity',()=>{
  const start=source.indexOf('function Stop-OwnedCandidate(');
  const end=source.indexOf('function Get-Targets {',start);
  const section=source.slice(start,end);
  assert.match(section,/\$proc\.HasExited/);
  assert.match(section,/\$marker\.configSha256/);
  assert.match(section,/\$health\.configSha256/);
  assert.match(section,/\$marker\.projectDir/);
  assert.match(section,/\$Candidate\.ProjectDir/);
  assert.match(section,/\$marker\.pid/);
  assert.match(section,/\$timeValid/);
  assert.match(source,/ProjectDir=\$stage\.Dir/g);
});
test('Windows native Get-FreePort skips a real occupied socket and selects bindable port',
 {skip:process.platform!=='win32'},()=>{
  const helper=path.join(root,'test/v2-windows-port-bind-qa.ps1');
  const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',helper,'-Upgrader',updater],
    {cwd:root,encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,r.stderr||r.stdout||r.error?.message);
  assert.match(r.stdout,/V2_PORT_BIND_QA_PASS/);
});
