# Real native Windows fixture acceptance: ACL, bytes, offline restore and fail-closed modes.
$ErrorActionPreference='Stop'
$script=Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\v2-owner-state-snapshot-windows.ps1'
if(-not (Test-Path -LiteralPath $script -PathType Leaf)){throw 'V012_WINDOWS_QA_SCRIPT_MISSING'}
if($env:OS -ne 'Windows_NT'){throw 'V012_WINDOWS_QA_WINDOWS_ONLY'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$root=Join-Path $env:TEMP ('v012-acl-native-qa-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $root -ErrorAction Stop)
function Invoke-Fixture([string]$source,[string]$output) {
  $result=@(& pwsh -NoProfile -File $script -Mode Fixture -FixtureRoot $source -OutputParent $output 2>&1)
  if($LASTEXITCODE -ne 0){throw 'V012_WINDOWS_QA_FIXTURE_FAILED'}
  $line=@($result | Where-Object { $_ -is [string] -and $_ -like 'V012_WIN_OWNER_STATE_SNAPSHOT=*'})
  if($line.Count -ne 1){throw 'V012_WINDOWS_QA_RECEIPT_MISSING'}
  return ($line[0] -replace '^V012_WIN_OWNER_STATE_SNAPSHOT=','' | ConvertFrom-Json)
}
try{
  $src=Join-Path $root 'src'
  [void](New-Item -ItemType Directory -Path $src)
  $nest=Join-Path $src 'nested'
  [void](New-Item -ItemType Directory -Path $nest)
  $plain='V012_TEST_BYTES_ONLY'
  [IO.File]::WriteAllText((Join-Path $nest 'state.txt'),$plain)
  [IO.File]::WriteAllBytes((Join-Path $src 'empty.bin'),[byte[]]@())
  # Elevated Windows tokens may default to the BUILTIN\Administrators group as
  # the owner of newly created files. Prove current-user ownership explicitly
  # in this disposable fixture; never rewrite real source ownership.
  foreach($owned in @($src,$nest,(Join-Path $nest 'state.txt'),(Join-Path $src 'empty.bin'))){
    $ownerAcl=Get-Acl -LiteralPath $owned
    $ownerAcl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
    Set-Acl -LiteralPath $owned -AclObject $ownerAcl -ErrorAction Stop
  }
  $output=Join-Path $root 'private-output'
  $receipt=Invoke-Fixture $src $output
  $expected=[Text.Encoding]::UTF8.GetByteCount($plain)
  if($receipt.files -ne 2 -or $receipt.bytes -ne $expected -or
      $receipt.offlineCopyAndRestore -ne 'PASS' -or
      $receipt.ownerOnlyDaclVerified -ne $true -or
      $receipt.liveConsistencyVerified -ne $false -or
      $receipt.installedCutoverAuthorized -ne $false -or
      $receipt.adminGroupOwnedSourceEntries -ne 0 -or
      $receipt.privilegedSourceReadAttested -ne $false){throw 'V012_WINDOWS_QA_SCOPE_OR_BYTE_COUNT_MISMATCH'}
  $dest=Join-Path $output $receipt.snapshotId
  $manifestFile=Join-Path $dest 'manifest.json'
  $m=Get-Content -LiteralPath $manifestFile -Raw
  $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($m))).ToLowerInvariant()
  if($digest -ne $receipt.manifestSha256){throw 'V012_WINDOWS_QA_MANIFEST_HASH_MISMATCH'}
  $manifest=$m|ConvertFrom-Json
  if($manifest.files -ne 2 -or $manifest.bytes -ne $expected){throw 'V012_WINDOWS_QA_MANIFEST_BYTE_MISMATCH'}
  foreach($item in @($manifest.entries)){
    $rel=[IO.Path]::Combine([string[]]$item.relative.Split('/'))
    $path=Join-Path (Join-Path $dest 'data') $rel
    if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256){
      throw 'V012_WINDOWS_QA_SNAPSHOT_FILE_HASH_MISMATCH'
    }
    $acl=Get-Acl -LiteralPath $path
    if(-not $acl.AreAccessRulesProtected -or @($acl.Access).Count -ne 1 -or
       $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){
      throw 'V012_WINDOWS_QA_FILE_ACL_MISMATCH'
    }
  }
  $outAcl=Get-Acl -LiteralPath $dest
  if(-not $outAcl.AreAccessRulesProtected -or @($outAcl.Access).Count -ne 1 -or
     $outAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){
    throw 'V012_WINDOWS_QA_PARENT_ACL_MISMATCH'
  }
  $rejectOverlap=@(& pwsh -NoProfile -File $script -Mode Fixture -FixtureRoot $src -OutputParent $src 2>&1)
  if($LASTEXITCODE -ne 2 -or -not (($rejectOverlap | Out-String) -match 'SOURCE_DESTINATION_OVERLAP')){
    throw 'V012_WINDOWS_QA_OVERLAP_NOT_REJECTED'
  }
  $unsafe=Join-Path $root 'unsafe-output'
  [void](New-Item -ItemType Directory -Path $unsafe)
  # Do not mutate the inherited or broad ACL. It must be rejected, not silently narrowed.
  $unsafeAcl=Get-Acl -LiteralPath $unsafe
  if(-not $unsafeAcl.AreAccessRulesProtected) {
    $rejected=@(& pwsh -NoProfile -File $script -Mode Fixture -FixtureRoot $src -OutputParent $unsafe 2>&1)
    if($LASTEXITCODE -ne 2 -or -not (($rejected | Out-String) -match 'EXISTING_DESTINATION_ACL_NOT_PRIVATE')){
      throw 'V012_WINDOWS_QA_UNSAFE_OUTPUT_NOT_REJECTED'
    }
  }
  $groupOverride=@(& pwsh -NoProfile -File $script -Mode Fixture -FixtureRoot $src -OutputParent $output -PermitAdministratorsGroupSource 2>&1)
  if($LASTEXITCODE -ne 2 -or -not (($groupOverride | Out-String) -match 'GROUP_SOURCE_MODE_RESTRICTED')){
    throw 'V012_WINDOWS_QA_GROUP_OVERRIDE_NOT_REJECTED'
  }
  $roamingOverride=@(& pwsh -NoProfile -File $script -Mode OwnerRoaming -FixtureRoot $src 2>&1)
  if($LASTEXITCODE -ne 2 -or -not (($roamingOverride | Out-String) -match 'OWNER_PATH_OVERRIDE_DENIED')){
    throw 'V012_WINDOWS_QA_OWNER_OVERRIDE_NOT_REJECTED'
  }
  $localOverride=@(& pwsh -NoProfile -File $script -Mode OwnerLocalRuntime -FixtureRoot $src 2>&1)
  if($LASTEXITCODE -ne 2 -or -not (($localOverride | Out-String) -match 'OWNER_PATH_OVERRIDE_DENIED')){
    throw 'V012_WINDOWS_QA_LOCAL_OVERRIDE_NOT_REJECTED'
  }
  'V012_WINDOWS_ACL_SNAPSHOT_NATIVE_QA_PASS files=2 restore=PASS privateDacl=PASS overlap=DENIED override=DENIED localOverride=DENIED'
}finally{
  if(Test-Path -LiteralPath $root){
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
  }
}
