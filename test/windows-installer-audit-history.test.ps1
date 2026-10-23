# QA-only native regression. Never installs, starts, or modifies live Commander.
$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText((Join-Path (Split-Path $PSScriptRoot -Parent) 'install.ps1'))
$a=$source.IndexOf('function Assert-CompleteCandidateAuditHistory {')
$b=$source.IndexOf('function Test-Installation {',$a)
if($a -lt 0 -or $b -le $a){throw 'HISTORY_GUARD_MISSING'}
$guardCall=$source.IndexOf('    Assert-CompleteCandidateAuditHistory -Candidate $InstallDir',$b)
$auditCall=$source.IndexOf('    & npm.cmd run audit',$b)
if($guardCall -lt 0 -or $auditCall -le $guardCall){throw 'HISTORY_GUARD_AFTER_AUDIT'}
$updater=[IO.File]::ReadAllText((Join-Path (Split-Path $PSScriptRoot -Parent) 'auto-update-windows.ps1'))
$ua=$updater.IndexOf('function Assert-CompleteCandidateAuditHistory {')
$ub=$updater.IndexOf('function Run-Gate(', $ua)
if($ua -lt 0 -or $ub -le $ua){throw 'UPDATER_GUARD_MISSING'}
$stageCall=$updater.IndexOf('Assert-CompleteCandidateAuditHistory -Candidate $stage.Dir',$ub)
$updateAudit=$updater.IndexOf("Run-Gate "+'$stage.Dir'+" 'audit' @('run','audit')",$ub)
if($stageCall -lt 0 -or $updateAudit -le $stageCall){throw 'UPDATER_AUDIT_GATE_ORDER_INVALID'}
if($source.Contains('tools\windows-audit-history.ps1') -or $updater.Contains('tools\windows-audit-history.ps1')){throw 'STANDALONE_OLD_DEPENDENCY_REMAINED'}
if($source.Substring($a,$b-$a).Trim() -ne $updater.Substring($ua,$ub-$ua).Trim()){throw 'STANDALONE_GUARD_DIVERGED'}
$guardBody=$source.Substring($a,$b-$a)
foreach($required in @('362375c464948be3001b307650c13fc3353ed05b',' M enable-boot-recovery.ps1','diff --cached --quiet --','hash-object --no-filters --','rev-parse HEAD:enable-boot-recovery.ps1','remote get-url origin')) {
  if(-not $guardBody.Contains($required)){throw ('LEGACY_EOL_RESTRICTION_MISSING_'+$required)}
}
. ([ScriptBlock]::Create($source.Substring($a,$b-$a)))
function Invoke-CandidateAuditTest {
  Assert-CompleteCandidateAuditHistory -Candidate $InstallDir -ExpectedSha $ExpectedCommit -AllowedOrigin $Repo
}
$root=Join-Path $env:TEMP ('rc-winaudit-unit-'+[Guid]::NewGuid().ToString('N'))
$repoDir=Join-Path $root 'origin'
$stage=Join-Path $root 'stage'
New-Item -ItemType Directory -Force -Path $repoDir|Out-Null
function Git-Required([string]$cwd,[string[]]$arguments) {
  $output=& git.exe -C $cwd @arguments
  if($LASTEXITCODE -ne 0){throw ('GIT_UNIT_FAIL_'+($arguments -join '_'))}
  return $output
}
try{
  [void](Git-Required $repoDir @('init','-q','-b','main'))
  [void](Git-Required $repoDir @('config','user.name','RC Local QA'))
  [void](Git-Required $repoDir @('config','user.email','qa@example.invalid'))
  [IO.File]::WriteAllText((Join-Path $repoDir 'fixture.txt'),('original'+[Environment]::NewLine))
  [void](Git-Required $repoDir @('add','fixture.txt'))
  [void](Git-Required $repoDir @('commit','-q','-m','fixture one'))
  [IO.File]::AppendAllText((Join-Path $repoDir 'fixture.txt'),('second'+[Environment]::NewLine))
  [void](Git-Required $repoDir @('add','fixture.txt'))
  [void](Git-Required $repoDir @('commit','-q','-m','fixture two'))
  $uri=([uri](Resolve-Path $repoDir).Path).AbsoluteUri
  & git.exe clone -q --depth 1 --branch main $uri $stage
  if($LASTEXITCODE -ne 0){throw 'UNIT_CLONE_FAIL'}
  $InstallDir=$stage
  $Repo=$uri
  $ExpectedCommit=([string](Git-Required $stage @('rev-parse','HEAD'))).Trim()
  if(([string](Git-Required $stage @('rev-parse','--is-shallow-repository'))).Trim() -ne 'true'){throw 'UNIT_NOT_SHALLOW'}
  $pinned=$ExpectedCommit
  $ExpectedCommit='a'*40
  try{Invoke-CandidateAuditTest;throw 'UNIT_BAD_SHA_ADMITTED'}catch{if($_.Exception.Message -ne 'INSTALL_AUDIT_HEAD_MISMATCH'){throw}}
  'WIN_AUDIT_WRONG_SHA_REJECT_PASS'
  $ExpectedCommit=$pinned
  [IO.File]::AppendAllText((Join-Path $stage 'fixture.txt'),('dirty'+[Environment]::NewLine))
  try{Invoke-CandidateAuditTest;throw 'UNIT_DIRTY_ADMITTED'}catch{if($_.Exception.Message -ne 'INSTALL_AUDIT_TRACKED_TREE_DIRTY'){throw}}
  'WIN_AUDIT_DIRTY_REJECT_PASS'
  [void](Git-Required $stage @('restore','--','fixture.txt'))
  [void](Git-Required $stage @('remote','set-url','origin','https://invalid.example/denied.git'))
  try{Invoke-CandidateAuditTest;throw 'UNIT_BAD_ORIGIN_ADMITTED'}catch{if($_.Exception.Message -ne 'INSTALL_AUDIT_ORIGIN_MISMATCH'){throw}}
  'WIN_AUDIT_BAD_ORIGIN_REJECT_PASS'
  [void](Git-Required $stage @('remote','set-url','origin',$Repo))
  Invoke-CandidateAuditTest
  if(([string](Git-Required $stage @('rev-parse','--is-shallow-repository'))).Trim() -ne 'false'){throw 'UNIT_STILL_SHALLOW'}
  if(([string](Git-Required $stage @('rev-parse','HEAD'))).Trim() -ne $pinned){throw 'UNIT_SHA_CHANGED'}
  if(@(Git-Required $stage @('status','--porcelain','--untracked-files=no')).Count){throw 'UNIT_WORKTREE_DIRTY'}
  'WIN_AUDIT_HISTORY_FULL_PASS'
  Invoke-CandidateAuditTest
  'WIN_AUDIT_HISTORY_IDEMPOTENT_PASS'
}finally{
  if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}