# Native Windows bounded metadata-only local-state classifier contract.
$ErrorActionPreference='Stop'
$tool=Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\v012-windows-local-state-inventory.ps1'
if($env:OS -ne 'Windows_NT'){throw 'V012_LOCAL_INVENTORY_QA_WINDOWS_ONLY'}
if(-not (Test-Path -LiteralPath $tool -PathType Leaf)){throw 'V012_LOCAL_INVENTORY_QA_TOOL_MISSING'}
$root=Join-Path $env:TEMP ('v012-local-inventory-fixture-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $root)
try{
 foreach($dir in @('credentials','app','qa','private-unrecognized-name')){
   [void](New-Item -ItemType Directory -Path (Join-Path $root $dir))
 }
 [IO.File]::WriteAllBytes((Join-Path $root 'credentials\owner.bin'),[byte[]]@(1,2,3))
 [IO.File]::WriteAllBytes((Join-Path $root 'app\runtime.bin'),[byte[]]@(4,5))
 [IO.File]::WriteAllBytes((Join-Path $root 'qa\stage.bin'),[byte[]]@(6))
 [IO.File]::WriteAllBytes((Join-Path $root 'private-unrecognized-name\private-file-name.bin'),[byte[]]@(7,8,9,10))
 $out=@(& pwsh -NoProfile -File $tool -Mode Fixture -FixtureRoot $root -MaxEntries 100 -MaxSeconds 10)
 if($LASTEXITCODE -ne 0 -or $out.Count -ne 1){throw 'V012_LOCAL_INVENTORY_QA_NONZERO_EXIT'}
 $o=$out[0] | ConvertFrom-Json
 if(-not $o.inventoryComplete -or $o.totalFiles -ne 4 -or $o.totalBytes -ne 10 -or
     $o.groups.'state-candidate'.files -ne 1 -or $o.groups.'runtime-candidate'.bytes -ne 2 -or
     $o.groups.'staging-candidate'.files -ne 1 -or $o.groups.unclassified.files -ne 1 -or
     $o.filesOpenedForContent -ne 0 -or $o.filesCopied -ne 0 -or
     $o.consistentBackupVerified -ne $false -or $o.cutoverAccepted -ne $false) {
   throw 'V012_LOCAL_INVENTORY_QA_CLASSIFICATION_MISMATCH'
 }
 if(($out[0] -match 'private-unrecognized-name') -or ($out[0] -match 'private-file-name')){
   throw 'V012_LOCAL_INVENTORY_QA_PRIVATE_NAME_LEAK'
 }
 $limited= & pwsh -NoProfile -File $tool -Mode Fixture -FixtureRoot $root -MaxEntries 1 -MaxSeconds 10 | ConvertFrom-Json
 if($LASTEXITCODE -ne 0 -or $limited.inventoryComplete -ne $false -or
     $limited.stopReason -ne 'ENTRY_LIMIT' -or $limited.scannedEntries -ne 1){
   throw 'V012_LOCAL_INVENTORY_QA_CAP_NOT_ENFORCED'
 }
 $rejected=@(& pwsh -NoProfile -File $tool -Mode OwnerLocal -FixtureRoot $root 2>&1)
 if($LASTEXITCODE -eq 0 -or -not (($rejected | Out-String) -match 'OWNER_PATH_OVERRIDE_DENIED')){
   throw 'V012_LOCAL_INVENTORY_QA_OWNER_OVERRIDE_NOT_DENIED'
 }
 'V012_LOCAL_INVENTORY_NATIVE_PASS fixtureFiles=4 bytes=10 privateNames=HIDDEN entryCap=ENFORCED ownerOverride=DENIED'
}finally{
 if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Force -Recurse}
}
