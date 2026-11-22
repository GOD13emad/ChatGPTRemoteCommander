// Isolated regression for RC012 Windows runtime fingerprints.
// It exercises the PowerShell witness embedded in the exact production source,
// with deterministic, synthetic Win32 inventories. No real process/port changes.
// Red on head 258ca0dc: Syncthing transfer-only listener must not rebind owner approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nativeSource=fs.readFileSync(path.join(projectRoot,'tools','universal-install','native-os-adapters.mjs'),'utf8');
const startToken='const windowsRuntimeSource=String.raw`';
const a=nativeSource.indexOf(startToken);
const b=nativeSource.indexOf('`;',a+startToken.length);
assert.ok(a>=0&&b>a,'RC012_WINDOWS_WITNESS_SOURCE_NOT_FOUND');
const original=nativeSource.slice(a+startToken.length,b);

function replaceOne(src,oldText,newText){
  assert.ok(src.includes(oldText),'RC012_TEST_NATIVE_SOURCE_CHANGED: '+oldText.slice(0,80));
  assert.equal(src.indexOf(oldText),src.lastIndexOf(oldText),'RC012_TEST_AMBIGUOUS_PATCH');
  return src.replace(oldText,()=>newText);
}
function replaceRange(src,start,end,newText){
  const from=src.indexOf(start);
  assert.ok(from>=0,'RC012_TEST_WITNESS_RANGE_START_CHANGED: '+start);
  const to=src.indexOf(end,from+start.length);
  assert.ok(to>=0,'RC012_TEST_WITNESS_RANGE_END_CHANGED: '+end);
  return src.slice(0,from)+newText+src.slice(to+end.length);
}
const initial=String.raw`
# Synthetic OS facts; native watcher code below remains the production source.
$ErrorActionPreference='Stop'
$script:syntheticSid='S-1-5-21-RC012-OWNER'
$script:transfer=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'CommanderTransferPilot/bin/syncthing.exe'))
$script:core=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander/node-current/bin/node'))
$script:syntheticTask=[pscustomobject]@{
 TaskName='CommanderTransferMeshPilot';TaskPath='\\';State='Running'
 Principal=[pscustomobject]@{UserId=$script:syntheticSid;LogonType='Interactive'}
 Actions=@([pscustomobject]@{Execute=$script:transfer;Arguments='serve --home=/tmp/CommanderTransferPilot/state';WorkingDirectory=''})
}
$script:syntheticProcess=@(
 [pscustomobject]@{pid=100;ProcessId=100;ParentProcessId=900;CreationDate='2026-11-22T02:00:00Z';ExecutablePath=$script:transfer;CommandLine='syncthing serve';created='2026-11-22T02:00:00Z';exe=$script:transfer;entry=$script:transfer;cmdHash='aa';parentPid=900;parent=900}
 [pscustomobject]@{pid=101;ProcessId=101;ParentProcessId=100;CreationDate='2026-11-22T02:00:01Z';ExecutablePath=$script:transfer;CommandLine='syncthing serve';created='2026-11-22T02:00:01Z';exe=$script:transfer;entry=$script:transfer;cmdHash='bb';parentPid=100;parent=100}
 [pscustomobject]@{pid=200;ProcessId=200;ParentProcessId=900;CreationDate='2026-11-22T02:00:03Z';ExecutablePath=$script:core;CommandLine='node server-v0.3.mjs';created='2026-11-22T02:00:03Z';exe=$script:core;entry='/tmp/ChatGPTRemoteCommander/server-v0.3.mjs';cmdHash='cc';parentPid=900;parent=900}
)
if($env:RC012_FIXTURE -eq 'process-restart'){$script:syntheticProcess[2].created='2026-11-22T02:00:04Z'}
if($env:RC012_FIXTURE -eq 'rogue-transfer-copy'){
 $script:syntheticProcess+= [pscustomobject]@{pid=111;ProcessId=111;ParentProcessId=77;CreationDate='2026-11-22T02:00:02Z';ExecutablePath=$script:transfer;CommandLine='syncthing serve';created='2026-11-22T02:00:02Z';exe=$script:transfer;entry=$script:transfer;cmdHash='dd';parentPid=77;parent=77}
}
$script:syntheticTcp=@(
 [pscustomobject]@{OwningProcess=101;LocalAddress='127.0.0.1';LocalPort=18384}
 [pscustomobject]@{OwningProcess=200;LocalAddress='127.0.0.1';LocalPort=47831}
)
if($env:RC012_FIXTURE -eq 'transfer-flap'){
 $script:syntheticTcp+= [pscustomobject]@{OwningProcess=101;LocalAddress='::';LocalPort=22000}
}
if($env:RC012_FIXTURE -eq 'core-drift'){$script:syntheticTcp[1].LocalPort=47832}
if($env:RC012_FIXTURE -eq 'task-drift'){$script:syntheticTask.State='Disabled'}
if($env:RC012_FIXTURE -eq 'dormant-transfer'){
 $script:syntheticTask.State='Disabled'
 $script:syntheticProcess=@($script:syntheticProcess|Where-Object pid -eq 200)
}
if($env:RC012_FIXTURE -eq 'broken-transfer-lineage'){
 $script:syntheticProcess[1].ParentProcessId=777
 $script:syntheticProcess[1].parent=777
}
function Get-CimInstance {
 param([string]$ClassName,[string]$Filter)
 if($ClassName -eq 'Win32_Service'){return [pscustomobject]@{Name='Schedule';ProcessId=900;State='Running';StartName='LocalSystem'}}
 if($ClassName -eq 'Win32_Process'){
  if($Filter -match 'ProcessId=(\\d+)'){return $script:syntheticProcess|Where-Object ProcessId -eq [int]$Matches[1]}
  return $script:syntheticProcess
 }
 throw 'RC012_TEST_UNEXPECTED_CIM'
}
function Get-ScheduledTask {param([string]$TaskName) return $script:syntheticTask}
function Get-NetTCPConnection {param([string]$State,[int]$OwningProcess)
 if($OwningProcess){return $script:syntheticTcp|Where-Object OwningProcess -eq $OwningProcess}
 return $script:syntheticTcp
}
function Invoke-CimMethod {param($InputObject,[string]$MethodName)
 return [pscustomobject]@{ReturnValue=0;Sid=$script:syntheticSid}
}
`;
function scripted(){
  let script=original;
  script=replaceOne(script,"$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value","$sid=$script:syntheticSid");
  // The fixture uses OS-neutral paths; do not emulate the Windows-only
  // backslash root formatter when running this deterministic test on POSIX.
  script=replaceOne(script,"function InRoot([string]$v) {",String.raw`$roots=@(([IO.Path]::GetFullPath([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($script:transfer))).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar).ToLowerInvariant())
function InRoot([string]$v) {`);
  // Real Win32 owner-SID translation is exercised in physical native tests.
  // Synthetic cross-platform PowerShell has no Windows NTAccount translation.
  script=replaceOne(script,String.raw`$taskOwnerSid=([Security.Principal.NTAccount]::new([string]$t.Principal.UserId)).
    Translate([Security.Principal.SecurityIdentifier]).Value`,String.raw`$taskOwnerSid=$sid`);
  script=replaceOne(script,"$records=@(SnapshotCandidates @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop))","$records=@($script:syntheticProcess)");
  script=replaceRange(script,"$verified=@($records |ForEach-Object -Parallel {","} -ThrottleLimit 8)","$verified=@($records)");
  script=replaceOne(script,"$tcp=@(Get-NetTCPConnection -State Listen -ErrorAction Stop)","$tcp=@($script:syntheticTcp)");
  script=replaceRange(script,"$tasks=@(Get-ScheduledTask -ErrorAction Stop|Where-Object {","}|Sort-Object key)",String.raw`
$tasks=@([pscustomobject]@{
 key='\\commandertransfermeshpilot'
 state=[string]$script:syntheticTask.State
 principal=$script:syntheticSid
 actions=@([pscustomobject]@{exe=$script:transfer;args='task-args-hash';cwd=''})
})`);
  script=replaceOne(script,"$again=@(SnapshotCandidates @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop))","$again=@($records)");
  return initial+script;
}
function evaluate(fixture){
  const runner=process.platform==='win32'?'pwsh':'pwsh';
  const r=spawnSync(runner,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(scripted(),'utf16le').toString('base64')],{
    env:{...process.env,RC012_FIXTURE:fixture,LOCALAPPDATA:os.tmpdir(),ProgramData:os.tmpdir()},
    encoding:'utf8',timeout:20000
  });
  assert.equal(r.status,0,`RC012_NATIVE_PWSH_FAILED fixture=${fixture} stderr=${r.stderr} stdout=${r.stdout}`);
  const out=(r.stdout||'').trim();
  assert.match(out,/^[a-f0-9]{64}$/,'RC012_RUNTIME_FINGERPRINT_INVALID');
  return out;
}
test('owner-specific transfer listener flap does not change install approval ID',()=>{
  assert.equal(evaluate('transfer-flap'),evaluate('baseline'));
});
test('Core/Tunnel listener drift changes approval ID',()=>{
  assert.notEqual(evaluate('core-drift'),evaluate('baseline'));
});
test('Core/Tunnel process restart changes approval ID',()=>{
  assert.notEqual(evaluate('process-restart'),evaluate('baseline'));
});
test('registered transfer task drift fails closed before issuing approval ID',()=>{
  assert.throws(()=>evaluate('task-drift'),/COMMANDER_TRANSFER_TASK_NOT_ACTIVE/);
});
test('unexpected transfer executable instance fails closed',()=>{
  assert.throws(()=>evaluate('rogue-transfer-copy'),/COMMANDER_TRANSFER_TASK_PROCESS_TREE_UNTRUSTED/);
});
test('a dormant registered transfer task with no live transfer process permits the stable owner witness',()=>{
  assert.match(evaluate('dormant-transfer'),/^[a-f0-9]{64}$/);
});
test('a broken transfer task parent-child ancestry fails closed',()=>{
  assert.throws(()=>evaluate('broken-transfer-lineage'),/COMMANDER_TRANSFER_TASK_PROCESS_TREE_UNTRUSTED/);
});
