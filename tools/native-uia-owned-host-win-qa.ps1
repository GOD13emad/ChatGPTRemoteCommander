# QA ONLY: use the existing bounded named-pipe/Desktop host unchanged,
# selecting a same-Desktop managed UIA child as a separate owned test fixture.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidatePattern('^rc_qa_desk_[a-f0-9]{32}$')]
 [string]$PipeName,
 [ValidateRange(1000,60000)][int]$LifetimeMs=40000
)
$ErrorActionPreference='Stop'
if(-not $IsWindows -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){
 throw 'QA_UIA_HOST_NONINTERACTIVE'
}
$source=Join-Path $PSScriptRoot 'native-desktop-pipe-host-win-qa.cs'
$child=Join-Path $PSScriptRoot 'native-uia-owned-child-win-qa.ps1'
$exe=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
if(-not (Test-Path $source) -or -not (Test-Path $child)){
 throw 'QA_UIA_SOURCE_MISSING'
}
Add-Type -Path $source -ErrorAction Stop
$result=[RcQaRetainedDesktopPipeHost]::Run($PipeName,$exe,$child,$LifetimeMs)
if($result -ne 0){throw 'QA_UIA_HOST_FAILED'}
