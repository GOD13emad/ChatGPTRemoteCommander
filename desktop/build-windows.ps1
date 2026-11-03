param(
  [string]$Runtime = 'win-x64',
  [string]$OutputDir = ''
)
$ErrorActionPreference='Stop'
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Version=((Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version)
if(-not $OutputDir){$OutputDir=Join-Path $Root 'dist\desktop\remote-commander-windows-x64'}
Remove-Item -LiteralPath $OutputDir -Recurse -Force -ErrorAction SilentlyContinue
dotnet publish (Join-Path $Root 'desktop\RemoteCommanderDashboard\RemoteCommanderDashboard.csproj') -c Release -r $Runtime --self-contained true -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false -p:Version=$Version -p:FileVersion="$Version.0" -o $OutputDir
if($LASTEXITCODE -ne 0){throw "dotnet publish failed: $LASTEXITCODE"}
foreach($name in @('profile-manager-windows.ps1','profile-enrollment-windows.ps1','operations-monitor-windows.ps1','admin-runtime-windows.ps1')){
  $source=Join-Path $Root (Join-Path 'desktop' $name)
  if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw "Desktop tool missing: $name"}
  Copy-Item -LiteralPath $source -Destination (Join-Path $OutputDir $name) -Force
}
$Exe=Join-Path $OutputDir 'RemoteCommander.exe'
if(-not (Test-Path -LiteralPath $Exe -PathType Leaf)){throw 'RemoteCommander.exe missing after publish'}
$Sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $Exe).Hash.ToLowerInvariant()
Write-Output "REMOTE_COMMANDER_DESKTOP_BUILD_PASS version=$Version exe=$Exe sha256=$Sha"
