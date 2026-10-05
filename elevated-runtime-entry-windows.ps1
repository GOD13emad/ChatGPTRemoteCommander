param(
  [switch]$ProbeOnly,
  [string]$ProbeOutput = ''
)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$StateRoot=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
$StateDir=Join-Path $StateRoot 'admin-runtime'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$record=[ordered]@{
  schema=1
  at=(Get-Date).ToUniversalTime().ToString('o')
  user=$identity.Name
  processId=$PID
  sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId
  elevated=[bool]$isAdmin
  appRoot=$Root
  probeOnly=[bool]$ProbeOnly
}
$json=$record|ConvertTo-Json -Depth 6
$defaultOutput=Join-Path $StateDir 'last-entry.json'
[IO.File]::WriteAllText($defaultOutput,$json+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
if($ProbeOutput){
  $out=[IO.Path]::GetFullPath($ProbeOutput)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $out) | Out-Null
  [IO.File]::WriteAllText($out,$json+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
}
Write-Output $json
if(-not $isAdmin){throw 'ADMIN_RUNTIME_NOT_ELEVATED'}
if($ProbeOnly){exit 0}

$supervisor=Join-Path $Root 'autostart-windows.ps1'
if(-not(Test-Path -LiteralPath $supervisor -PathType Leaf)){throw 'ADMIN_RUNTIME_SUPERVISOR_MISSING'}
& $supervisor
exit $LASTEXITCODE
