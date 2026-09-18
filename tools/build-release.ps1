param(
  [string]$OutputDir = '',
  [Parameter(Mandatory=$true)][string]$AcceptanceSummary,
  [string]$RemoteAcceptanceSummary = ''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$Root=[IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)))
$git=(Get-Command git -ErrorAction Stop).Source
$node=(Get-Command node -ErrorAction Stop).Source
$npm=(Get-Command npm -ErrorAction Stop).Source

function Assert-True([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function FileHash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}

$version=(Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw|ConvertFrom-Json).version
$commit=(& $git -C $Root rev-parse HEAD).Trim().ToLowerInvariant()
Assert-True ($commit -match '^[0-9a-f]{40}$') 'RELEASE_BAD_HEAD'
& $git -C $Root diff --quiet
Assert-True ($LASTEXITCODE -eq 0) 'RELEASE_TRACKED_WORKTREE_DIRTY'
& $git -C $Root diff --cached --quiet
Assert-True ($LASTEXITCODE -eq 0) 'RELEASE_INDEX_DIRTY'

$accept=Get-Content -LiteralPath $AcceptanceSummary -Raw|ConvertFrom-Json
Assert-True ($accept.pass -eq $true) 'RELEASE_LOCAL_ACCEPTANCE_NOT_PASS'
Assert-True ($accept.interactive -eq $true) 'RELEASE_INTERACTIVE_ACCEPTANCE_REQUIRED'
Assert-True ([string]$accept.candidateCommit -eq $commit) "RELEASE_ACCEPTANCE_COMMIT_MISMATCH expected=$commit got=$($accept.candidateCommit)"
Assert-True ([string]$accept.packageVersion -eq $version) 'RELEASE_ACCEPTANCE_VERSION_MISMATCH'

if(-not [string]::IsNullOrWhiteSpace($RemoteAcceptanceSummary)){
  $remote=Get-Content -LiteralPath $RemoteAcceptanceSummary -Raw|ConvertFrom-Json
  Assert-True ([string]$remote.candidateCommit -eq $commit) 'RELEASE_REMOTE_COMMIT_MISMATCH'
  foreach($field in @('systemStatusVerified','guiImageRendered','guiInputVisuallyVerified','secondGuiLeaseRefused','credentialHashesUnchanged')){
    Assert-True ($remote.$field -eq $true) "RELEASE_REMOTE_ACCEPTANCE_MISSING_$field"
  }
}else{
  throw 'RELEASE_REMOTE_ACCEPTANCE_REQUIRED'
}

Push-Location $Root
try{
  & $npm run check; Assert-True ($LASTEXITCODE -eq 0) 'RELEASE_NPM_CHECK_FAILED'
  & $npm test; Assert-True ($LASTEXITCODE -eq 0) 'RELEASE_NPM_TEST_FAILED'
  & $npm run audit; Assert-True ($LASTEXITCODE -eq 0) 'RELEASE_SECURITY_AUDIT_FAILED'
}finally{Pop-Location}

if([string]::IsNullOrWhiteSpace($OutputDir)){$OutputDir=Join-Path $Root "dist\v$version"}
$OutputDir=[IO.Path]::GetFullPath($OutputDir)
if(Test-Path -LiteralPath $OutputDir){Remove-Item -LiteralPath $OutputDir -Recurse -Force}
New-Item -ItemType Directory -Force -Path $OutputDir|Out-Null

$copy=@(
  'install-work-plugin.ps1','install-work-plugin.sh',
  'START_HERE.md','WORK_SETUP.md','README.md','docs/GUI_ACCEPTANCE.md',
  'assets/plugin-icon.png','assets/plugin-logo.png','assets/plugin-icon.svg',
  'tools/verify-release.ps1'
)
foreach($rel in $copy){
  $src=Join-Path $Root $rel
  Assert-True (Test-Path -LiteralPath $src -PathType Leaf) "RELEASE_MISSING_$rel"
  Copy-Item -LiteralPath $src -Destination (Join-Path $OutputDir ([IO.Path]::GetFileName($rel)))
}

$winSource=Get-Content -LiteralPath (Join-Path $Root 'install.ps1') -Raw
$winNeed="[string]`$ExpectedCommit = ''"
Assert-True ($winSource.Split($winNeed).Count-1 -eq 1) 'RELEASE_WINDOWS_STAMP_ANCHOR_INVALID'
$winStamped=$winSource.Replace($winNeed,"[string]`$ExpectedCommit = '$commit'")
$winOut=Join-Path $OutputDir 'install.ps1'
[IO.File]::WriteAllText($winOut,$winStamped,[Text.UTF8Encoding]::new($false))

$linuxSource=Get-Content -LiteralPath (Join-Path $Root 'install.sh') -Raw
$linuxNeed='EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"'
Assert-True ($linuxSource.Split($linuxNeed).Count-1 -eq 1) 'RELEASE_LINUX_STAMP_ANCHOR_INVALID'
$linuxStamped=$linuxSource.Replace($linuxNeed,('EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-'+$commit+'}"'))
$linuxOut=Join-Path $OutputDir 'install.sh'
[IO.File]::WriteAllText($linuxOut,$linuxStamped,[Text.UTF8Encoding]::new($false))

$errors=$null
[Management.Automation.Language.Parser]::ParseFile($winOut,[ref]$null,[ref]$errors)|Out-Null
Assert-True ($errors.Count -eq 0) ('RELEASE_WINDOWS_INSTALLER_PARSE_FAILED '+(($errors|ForEach-Object Message)-join '; '))
$bash=Get-Command bash -ErrorAction SilentlyContinue
if($bash){& $bash.Source -n $linuxOut;Assert-True ($LASTEXITCODE -eq 0) 'RELEASE_LINUX_INSTALLER_PARSE_FAILED'}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$pluginStage=Join-Path $env:TEMP ("rc-plugin-release-{0}-{1}" -f $PID,[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $pluginStage|Out-Null
$trackedPlugin=@(& $git -C $Root ls-files -- plugin-template)
Assert-True ($trackedPlugin.Count -gt 0) 'RELEASE_PLUGIN_TRACKED_FILES_MISSING'
foreach($rel in $trackedPlugin){
  if([string]::IsNullOrWhiteSpace($rel)){continue}
  Assert-True $rel.StartsWith('plugin-template/') "RELEASE_PLUGIN_TRACKED_PATH_INVALID $rel"
  $sub=$rel.Substring('plugin-template/'.Length)
  $src=Join-Path $Root $rel
  Assert-True (Test-Path -LiteralPath $src -PathType Leaf) "RELEASE_TRACKED_PLUGIN_FILE_MISSING $rel"
  $dst=Join-Path $pluginStage $sub
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst)|Out-Null
  Copy-Item -LiteralPath $src -Destination $dst
}
Assert-True (-not (Test-Path -LiteralPath (Join-Path $pluginStage '.app.json'))) 'RELEASE_PRIVATE_APP_BINDING_PRESENT'

$zipStable=Join-Path $OutputDir 'plugin-template.zip'
$zipVersioned=Join-Path $OutputDir "plugin-template-v$version.zip"
try{
  [IO.Compression.ZipFile]::CreateFromDirectory($pluginStage,$zipStable,[IO.Compression.CompressionLevel]::Optimal,$false)
}finally{
  Remove-Item -LiteralPath $pluginStage -Recurse -Force -ErrorAction SilentlyContinue
}
Copy-Item -LiteralPath $zipStable -Destination $zipVersioned
$zip=[IO.Compression.ZipFile]::OpenRead($zipStable)
try{
  $entries=@($zip.Entries|ForEach-Object FullName)
  foreach($required in @('plugin.json','.app.json.example','skills/remote-commander/SKILL.md','assets/icon.png','assets/logo.png')){
    Assert-True ($entries -contains $required) "RELEASE_PLUGIN_ZIP_MISSING_$required"
  }
}finally{$zip.Dispose()}

$pluginManifest=Get-Content -LiteralPath (Join-Path $pluginDir 'plugin.json') -Raw|ConvertFrom-Json
Assert-True ([string]$pluginManifest.version -eq $version) 'RELEASE_PLUGIN_VERSION_MISMATCH'
Assert-True ((Get-Content -LiteralPath $winOut -Raw).Contains("[string]`$ExpectedCommit = '$commit'")) 'RELEASE_WINDOWS_COMMIT_NOT_STAMPED'
Assert-True ((Get-Content -LiteralPath $linuxOut -Raw).Contains($commit)) 'RELEASE_LINUX_COMMIT_NOT_STAMPED'

$assets=@(Get-ChildItem -LiteralPath $OutputDir -File|Sort-Object Name)
$manifestFiles=@()
foreach($f in $assets){$manifestFiles+=[ordered]@{name=$f.Name;bytes=$f.Length;sha256=FileHash $f.FullName}}
$manifest=[ordered]@{name='ChatGPT Remote Commander';version=$version;tag="v$version";sourceCommit=$commit;builtAt=(Get-Date).ToUniversalTime().ToString('o');localAcceptance=(FileHash $AcceptanceSummary);remoteAcceptance=(FileHash $RemoteAcceptanceSummary);files=$manifestFiles}
$manifestPath=Join-Path $OutputDir 'RELEASE_MANIFEST.json'
[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))

$sumLines=@()
foreach($f in Get-ChildItem -LiteralPath $OutputDir -File|Sort-Object Name){$sumLines+=("{0}  {1}" -f (FileHash $f.FullName),$f.Name)}
$sums=Join-Path $OutputDir 'SHA256SUMS.txt'
[IO.File]::WriteAllLines($sums,$sumLines,[Text.UTF8Encoding]::new($false))

& (Join-Path $Root 'tools\verify-release.ps1') -Directory $OutputDir -ExpectedVersion $version -ExpectedCommit $commit
Assert-True ($LASTEXITCODE -eq 0) 'RELEASE_VERIFY_FAILED'

Write-Host 'RELEASE_BUILD_PASS'
Write-Host "Version: $version"
Write-Host "Commit: $commit"
Write-Host "Output: $OutputDir"
Write-Host "Manifest: $manifestPath"
Write-Host "SHA256: $sums"
