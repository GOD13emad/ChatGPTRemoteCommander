param(
  [string]$VersionOverride = '',
  [string]$SourceRef = '',
  [string]$ExpectedCommit = '',
  [string]$BrowserInstaller = '',
  [switch]$AllowDirty
)
$ErrorActionPreference='Stop'
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Package=Get-Content (Join-Path $Root 'package.json') -Raw|ConvertFrom-Json
$Version=if($VersionOverride){$VersionOverride}else{[string]$Package.version}
if($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9._-]+)?$'){throw "Invalid setup version: $Version"}

$Head=(git -C $Root rev-parse HEAD).Trim()
if($Head -notmatch '^[0-9a-f]{40}$'){throw 'Could not resolve repository HEAD.'}
if($ExpectedCommit){
  if($ExpectedCommit.ToLowerInvariant() -ne $Head){throw "ExpectedCommit $ExpectedCommit does not equal HEAD $Head"}
}else{$ExpectedCommit=$Head}

if(-not $SourceRef){
  $SourceRef=(git -C $Root branch --show-current).Trim()
  if(-not $SourceRef){throw 'SourceRef is required for a detached HEAD.'}
}
if($SourceRef -notmatch '^[A-Za-z0-9._/-]{1,128}$'){throw "Invalid SourceRef: $SourceRef"}

$dirty=@(git -C $Root status --porcelain --untracked-files=all)
if($dirty.Count -gt 0 -and -not $AllowDirty){
  throw "Setup release build requires a clean worktree. Dirty entries: $($dirty.Count)"
}

& (Join-Path $Root 'desktop\build-windows.ps1')
if($LASTEXITCODE -ne 0){throw 'Desktop payload build failed.'}

$isccCandidates=@(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe')
)
$Iscc=$isccCandidates|Where-Object{$_ -and (Test-Path -LiteralPath $_ -PathType Leaf)}|Select-Object -First 1
if(-not $Iscc){
  $keys=@(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $entry=Get-ItemProperty $keys -ErrorAction SilentlyContinue|Where-Object{$_.DisplayName -like 'Inno Setup version *'}|Select-Object -First 1
  if($entry.InstallLocation){
    $candidate=Join-Path ([string]$entry.InstallLocation) 'ISCC.exe'
    if(Test-Path -LiteralPath $candidate -PathType Leaf){$Iscc=$candidate}
  }
}
if(-not $Iscc){throw 'Inno Setup 6 compiler (ISCC.exe) is required to build the single-file installer.'}

$args=@(
  ('/DMyVersion='+$Version),
  ('/DMyCommit='+$ExpectedCommit),
  ('/DMySourceRef='+$SourceRef)
)
$BrowserSha=$null
if($BrowserInstaller){
  $BrowserInstaller=[IO.Path]::GetFullPath($BrowserInstaller)
  if(-not(Test-Path -LiteralPath $BrowserInstaller -PathType Leaf)){throw "Browser installer not found: $BrowserInstaller"}
  if([IO.Path]::GetExtension($BrowserInstaller) -ne '.exe'){throw 'Browser installer must be an .exe artifact.'}
  $BrowserSha=(Get-FileHash -LiteralPath $BrowserInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
  $args+=('/DBrowserSetup='+$BrowserInstaller)
}
$args+=(Join-Path $PSScriptRoot 'RemoteCommander.iss')

& $Iscc @args
if($LASTEXITCODE -ne 0){throw "Inno Setup compile failed: $LASTEXITCODE"}

$Setup=Join-Path $Root ("dist\installer\Remote-Commander-Setup-v$Version.exe")
if(-not(Test-Path -LiteralPath $Setup -PathType Leaf)){throw "Expected setup artifact missing: $Setup"}
$Sha=(Get-FileHash -LiteralPath $Setup -Algorithm SHA256).Hash.ToLowerInvariant()
$Signature=Get-AuthenticodeSignature -LiteralPath $Setup
$result=[ordered]@{
  status='REMOTE_COMMANDER_SETUP_BUILD_PASS'
  version=$Version
  sourceRef=$SourceRef
  commit=$ExpectedCommit
  setup=$Setup
  sha256=$Sha
  signatureStatus=[string]$Signature.Status
  browserBundled=[bool]$BrowserInstaller
  browserSha256=$BrowserSha
}
$result|ConvertTo-Json -Depth 5
