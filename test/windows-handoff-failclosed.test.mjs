import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const repo=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(repo,'handoff-user-session-windows.ps1'),'utf8');
const between=(from,to)=>{
  const begin=source.indexOf(from);
  const end=source.indexOf(to,begin);
  assert.ok(begin>=0&&end>begin,'required handoff section missing: '+from);
  return source.slice(begin,end);
};

test('Windows handoff fails closed on unavailable or malformed MCP status',()=>{
  const f=between('function Get-CommanderBusy {','function Stop-ExactProcess(');
  for(const marker of [
    'HANDOFF_BUSY_STATE_UNVERIFIED','HANDOFF_BUSY_STATE_INVALID',
    'HANDOFF_GUI_STATE_UNVERIFIED','HANDOFF_BROWSER_STATE_UNVERIFIED',
    "foreach($tool in @('gui_status','browser_status'))",
    '$s.concurrency.activeOperations','$s.concurrency.queued',
    '$s.durableWorkflows.schedulerState.currentLeases'
  ])assert.ok(f.includes(marker),'missing fail-closed prerequisite '+marker);
  assert.match(f,/catch\s*\{[^}]*active=1;queued=1;leases=1/su);
  assert.doesNotMatch(f,/catch\s*\{[^}]*active=0;leases=0/su);
  assert.match(source,/\$busy\.queued -eq 0/u);
  assert.match(source,/\$busy\.queued -ne 0/u);
});

test('Windows handoff stops only SYSTEM processes and excludes independent Headless server',()=>{
  const stop=between('function Stop-ExactProcess(','$deadline=');
  assert.match(stop,/if\(-not\(Test-SystemOwner \$Process\)\)\{return\}/u);
  const filter=between('$ownerCommanderRoot=','Start-Sleep -Seconds 1');
  for(const marker of [
    "$ownerCommanderPrefix=[regex]::Escape($ownerCommanderRoot+'\\')",
    'server-headless-v1\\auth-preload.cjs',
    'server-headless-v1\\run-headless.ps1',
    "$_.CommandLine -notmatch [regex]::Escape($headlessPreload)",
    "$_.ParentProcessId -notin $headlessSupervisorPids"
  ])assert.ok(filter.includes(marker),'missing independently protected process constraint '+marker);
  assert.doesNotMatch(filter,/\$commanderPattern\s*=\s*'ChatGPTRemoteCommander'/u);
  assert.match(source,/\$expectedTunnel=\[IO\.Path\]::GetFullPath/u);
  assert.match(source,/\$_\.ExecutablePath.*-eq \$expectedTunnel/u);
});

test('Windows handoff retains bounded idle wait, busy deferral, and user-profile parametrization',()=>{
  assert.match(source,/\[ValidateRange\(30,900\)\]\[int\]\$WaitSeconds/u);
  assert.match(source,/\$OwnerUserProfile=\[IO\.Path\]::GetFullPath\(\$OwnerUserProfile\)/u);
  assert.match(source,/HANDOFF_DEFERRED_BUSY/u);
  assert.match(source,/exit 75/u);
  assert.match(source,/USER_SESSION_HANDOFF_RECOVERY_PENDING/u);
  assert.match(source,/exit 76/u);
  assert.match(source,/USER_SESSION_HANDOFF_PASS/u);
});


test('Native Windows PowerShell mock covers idle, queued, GUI/browser leases, malformed and unauthorized status',
  {skip:process.platform!=='win32'},()=>{
    const result=spawnSync('pwsh.exe',[
      '-NoLogo','-NoProfile','-NonInteractive','-File',
      path.join(repo,'test','windows-handoff-failclosed-native.ps1')
    ],{cwd:repo,encoding:'utf8',timeout:15000,windowsHide:true});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.match(result.stdout,/HANDOFF_NATIVE_FAILCLOSED_PASS cases=7/u);
  });

test('Windows handoff PASS requires SID-qualified user-owned Router and Tunnel listeners',()=>{
  const profile=between('function Get-OwnerProfileSid {','$recoverDeadline=');
  for(const required of [
    "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList",
    'ProfileImagePath','GetOwnerSid','Get-NetTCPConnection',
    "LocalAddress '127.0.0.1'","State Listen","$listeners.Count -ne 1",
    "$owner.ReturnValue -eq 0","[string]$owner.Sid -eq $OwnerSid"
  ])assert.ok(profile.includes(required),'missing owner proof '+required);
  const recovery=source.slice(source.indexOf('$recoverDeadline='));
  assert.match(recovery,/\$ownerSid=Get-OwnerProfileSid/u);
  assert.match(recovery,/Test-OwnerListener 47831 \$ownerSid 'node\.exe'/u);
  assert.match(recovery,/Test-OwnerListener \$port \$ownerSid 'tunnel-client\.exe'/u);
  assert.match(recovery,/if\(\$mcp -and \$tunnelOk\)\{\$ok=\$true;break\}/u);
  assert.match(recovery,/USER_SESSION_HANDOFF_PASS/u);
});

test('Native Windows ownership fixture denies SYSTEM, wrong SID, ambiguous listener and profile',
  {skip:process.platform!=='win32'},()=>{
    const result=spawnSync('pwsh.exe',[
      '-NoLogo','-NoProfile','-NonInteractive','-File',
      path.join(repo,'test','windows-handoff-owner-listener-native.ps1')
    ],{cwd:repo,encoding:'utf8',timeout:15000,windowsHide:true});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.match(result.stdout,/HANDOFF_OWNER_NATIVE_PASS cases=15/u);
  });
