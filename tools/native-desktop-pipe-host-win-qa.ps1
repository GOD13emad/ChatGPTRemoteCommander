# QA ONLY: limited-duration observation-only Windows Desktop object host.
# Named pipe restricts to current Windows user, NOT a ChatGPT identity.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^rc_qa_desk_[a-f0-9]{32}$')]
  [string]$PipeName,
  [ValidateRange(1000,60000)][int]$LifetimeMs=40000
)
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'QA_HOST_WINDOWS_ONLY'}
if([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){
  throw 'QA_HOST_SESSION_ZERO_REJECTED'
}
$source=Join-Path $PSScriptRoot 'native-desktop-pipe-host-win-qa.cs'
$child=Join-Path $PSScriptRoot 'native-live-desktop-child-win-qa.ps1'
$exe=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
if(-not (Test-Path -LiteralPath $source) -or
   -not (Test-Path -LiteralPath $child)){throw 'QA_HOST_DEPENDENCY_MISSING'}
Add-Type -Path $source -ErrorAction Stop
$status=[RcQaRetainedDesktopPipeHost]::Run($PipeName,$exe,$child,$LifetimeMs)
if($status -ne 0){throw "QA_HOST_FAILED:$status"}
