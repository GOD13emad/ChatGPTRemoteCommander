import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const src=fs.readFileSync('reconfigure-profile-instance.ps1','utf8');
const start=src.indexOf('function Restore-ProfileBackupIfStillCurrent(');
const end=src.indexOf('foreach($i in 1..$WaitSeconds)',start);
assert.ok(start>=0 && end>start,'guarded rollback helper must be isolated from production script');
const helper=src.slice(start,end);
test('rollback requires same per-profile mutex and exact new policy hash before any copy',()=>{
 assert.match(helper,/FileMode\]::CreateNew/);
 assert.match(helper,/PROFILE_RECONFIGURE_ROLLBACK_BUSY/);
 assert.match(helper,/PROFILE_RECONFIGURE_ROLLBACK_STALE_POLICY/);
 assert.match(helper,/PROFILE_RECONFIGURE_ROLLBACK_BACKUP_SCOPE_INVALID/);
 assert.match(helper,/Get-FileHash -LiteralPath \$config/);
 assert.match(helper,/IO\.File\]::Move\(\$tempConfig,\$config,\$true\)/);
 assert.match(helper,/IO\.File\]::Move\(\$tempRecord,\$record,\$true\)/);
 assert.doesNotMatch(src, /Copy-Item \$oldConfig \(Join-Path \$StateDir 'config\.json'\) -Force/);
});
test('native Windows guarded rollback restores exact bytes and refuses competing or stale edits',t=>{
 if(process.platform!=='win32'){t.skip('requires native Windows PowerShell');return}
 const ps=String.raw`
$ErrorActionPreference='Stop'
`+helper+String.raw`
$root=Join-Path $env:TEMP ('rc-backup-cas-'+[Guid]::NewGuid().ToString('N'))
$state=Join-Path $root 'state'
$back=Join-Path $state 'backups\reconfigure-1'
[IO.Directory]::CreateDirectory($back)|Out-Null
$c=Join-Path $state 'config.json'
$r=Join-Path $state 'instance.json'
$bc=Join-Path $back 'config.json'
$br=Join-Path $back 'instance.json'
$old='{"port":47834,"powerMode":{"enabled":false}}'
$new='{"port":47834,"powerMode":{"enabled":true}}'
$enc=[Text.UTF8Encoding]::new($false)
function Put([string]$Path,[string]$Text){[IO.File]::WriteAllText($Path,$Text,$enc)}
function Sha([string]$Text){
 $bytes=$enc.GetBytes($Text)
 return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
}
$shaOld=Sha $old
$shaNew=Sha $new
$recordOld=(@{profile='saeid-secondary';configSha256=$shaOld}|ConvertTo-Json -Compress)
$recordNew=(@{profile='saeid-secondary';configSha256=$shaNew}|ConvertTo-Json -Compress)
function CallGuard {
 Restore-ProfileBackupIfStillCurrent -ProfileState $state -BackupDir $back -ProfileName 'saeid-secondary' -OriginalSha256 $shaOld -ExpectedLiveSha256 $shaNew
}
function AssertThrows([scriptblock]$Action,[string]$Message){
 $caught=$null
 try{& $Action}catch{$caught=[string]$_.Exception.Message}
 if(!$caught -or !$caught.Contains($Message)){throw "EXPECTED_$Message_ACTUAL_$caught"}
}
try{
 Put $bc $old;Put $br $recordOld
 Put $c $new;Put $r $recordNew
 CallGuard
 if((Get-FileHash $c -Algorithm SHA256).Hash -ne $shaOld){throw 'VALID_ROLLBACK_FAIL'}
 if((Get-Content $r -Raw|ConvertFrom-Json).configSha256 -ne $shaOld){throw 'RECORD_NOT_RESTORED'}
 if(Test-Path (Join-Path $state '.profile-reconfigure.lock')){throw 'LOCK_NOT_RELEASED'}

 Put $c $new;Put $r $recordNew
 $lock=Join-Path $state '.profile-reconfigure.lock'
 Put $lock 'other writer'
 AssertThrows {CallGuard} 'PROFILE_RECONFIGURE_ROLLBACK_BUSY'
 if((Get-Content $lock -Raw) -ne 'other writer'){throw 'LOCK_OVERWRITTEN'}
 if((Get-FileHash $c -Algorithm SHA256).Hash -ne $shaNew){throw 'BUSY_CLOBBER'}
 Remove-Item $lock

 $changed=$new+' '
 Put $c $changed
 $changedHash=Sha $changed
 Put $r (@{profile='saeid-secondary';configSha256=$changedHash}|ConvertTo-Json -Compress)
 AssertThrows {CallGuard} 'PROFILE_RECONFIGURE_ROLLBACK_STALE_POLICY'
 if((Get-FileHash $c -Algorithm SHA256).Hash -ne $changedHash){throw 'STALE_CLOBBER'}
 if(Test-Path $lock){throw 'STALE_LOCK_LEAK'}

 Put $c $new;Put $r $recordNew
 Put $br (@{profile='other-account';configSha256=$shaOld}|ConvertTo-Json -Compress)
 AssertThrows {CallGuard} 'PROFILE_RECONFIGURE_ROLLBACK_BACKUP_MISMATCH'
 if((Get-FileHash $c -Algorithm SHA256).Hash -ne $shaNew){throw 'BACKUP_MISMATCH_CLOBBER'}
 Put $br $recordOld
 $outside=Join-Path $root 'outside'
 [IO.Directory]::CreateDirectory($outside)|Out-Null
 AssertThrows {
  Restore-ProfileBackupIfStillCurrent -ProfileState $state -BackupDir $outside -ProfileName 'saeid-secondary' -OriginalSha256 $shaOld -ExpectedLiveSha256 $shaNew
 } 'PROFILE_RECONFIGURE_ROLLBACK_BACKUP_SCOPE_INVALID'
 if((Get-FileHash $c -Algorithm SHA256).Hash -ne $shaNew){throw 'OUTSIDE_BACKUP_CLOBBER'}
 'WIN_ROLLBACK_VALID_BUSY_STALE_CORRUPT_SCOPE_TEST_PASS'
}finally{Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue}
`;
 const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(r.status,0,(r.stdout??'')+(r.stderr??''));
 assert.match(r.stdout,/WIN_ROLLBACK_VALID_BUSY_STALE_CORRUPT_SCOPE_TEST_PASS/);
});
