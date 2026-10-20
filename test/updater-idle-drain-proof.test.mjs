import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'auto-update-windows.ps1'),'utf8');
const start=source.indexOf('function Complete-DeferredDrains {');
const end=source.indexOf('function Has-SupersededRelease {',start);
assert.ok(start>0&&end>start);
const func=source.slice(start,end);

test('zero-inflight backend cannot be stopped without transitive idle proof',()=>{
 const zero=func.indexOf('if($st.ok -and $st.count-eq 0)');
 const proof=func.indexOf('Get-StaleDrainEvidence $old $canonical',zero);
 const kill=func.indexOf('Stop-StaleBackendTree $old $canonical',zero);
 const cancel=func.indexOf('elseif($st.ok -and $st.cancellableOnly)',zero);
 const stopDirect=func.indexOf('Stop-OldBackend $old',zero);
 assert.ok(zero>0&&proof>zero&&kill>proof&&cancel>kill&&stopDirect>cancel);
 assert.match(func,/DRAIN_IDLE_DEFER/);
 assert.match(func,/Retire-PreviousRoute/);
});

for(const scenario of [
 {name:'idle-proof-accepted',safe:true,ok:true,expectedPending:0,expectedRetire:1,expectedStale:1},
 {name:'live-lease-deferred',safe:false,ok:true,expectedPending:1,expectedRetire:0,expectedStale:0},
 {name:'router-unverified-deferred',safe:true,ok:false,expectedPending:1,expectedRetire:0,expectedStale:0},
 {name:'cancellable-router-work',safe:false,ok:true,count:1,cancellable:true,expectedPending:0,expectedRetire:1,expectedStale:0,expectedDirect:1}
]){
 test('Windows bounded drain fixture: '+scenario.name,{skip:process.platform!=='win32'},()=>{
  const script=[
   "$ErrorActionPreference='Stop'",
   "$RoutingRoot='isolated-fixture'",
   "$script:owned=$true;$script:retired=0;$script:stale=0;$script:direct=0",
   "function Get-ChildItem { [CmdletBinding()]param([string]$LiteralPath,[string]$Filter,[switch]$File);[pscustomobject]@{Name='default.json';BaseName='default';FullName='fixture-route'} }",
   "function Read-Json($f){[pscustomobject]@{profile='default';previous=[pscustomobject]@{port=48831;version='0.10.25';commit='b'.PadRight(40,'b')}}}",
   "function Test-OwnedOldBackend($old){return $script:owned}",
   "function Get-CanonicalPortForProfile($profile){return 47831}",
   "function Get-PersistentTerminalChildren($old){return @()}",
   "function Get-RetainableLongCommandRoots($old,$port){return @()}",
   "function Get-DrainStatus($canonical,$old){return [pscustomobject]@{ok=$"+String(scenario.ok).toLowerCase()+";count="+String(scenario.count??0)+";cancellableOnly=$"+String(Boolean(scenario.cancellable)).toLowerCase()+"}}",
   "function Get-StaleDrainEvidence($old,$port){return [pscustomobject]@{safe=$"+String(scenario.safe).toLowerCase()+";decision='DEFER_ACTIVE'}}",
   "function Stop-StaleBackendTree($old,$port){$script:stale++;return $true}",
   "function Stop-OldBackend($old){$script:direct++;$script:owned=$false}",
   "function Retire-PreviousRoute($route,$old,$profile){$script:retired++}",
   "function Log($line){}",
   func,
   "$pending=@(Complete-DeferredDrains)",
   "[pscustomobject]@{pending=$pending.Count;retired=$script:retired;stale=$script:stale;direct=$script:direct}|ConvertTo-Json -Compress"
  ].join('\n');
  const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:9000});
  assert.equal(r.error,undefined,r.error?.message);
  assert.equal(r.status,0,r.stderr);
  const j=JSON.parse(r.stdout.trim());
  assert.equal(j.pending,scenario.expectedPending);
  assert.equal(j.retired,scenario.expectedRetire);
  assert.equal(j.stale,scenario.expectedStale);
  assert.equal(j.direct,scenario.expectedDirect??0,'unproven old backend must never be stopped directly');
 });
}
