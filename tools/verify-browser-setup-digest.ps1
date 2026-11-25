param(
  [Parameter(Mandatory=$true)][string]$BrowserInstaller,
  [Parameter(Mandatory=$true)][string]$CatalogPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$artifact=[IO.Path]::GetFullPath($BrowserInstaller)
if(-not(Test-Path -LiteralPath $artifact -PathType Leaf) -or
   [IO.Path]::GetExtension($artifact) -ne '.exe'){
  throw 'BROWSER_PIN_ARTIFACT_INVALID'
}
$leaf=Get-Item -LiteralPath $artifact -Force -ErrorAction Stop
if(([int]$leaf.Attributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0){
  throw 'BROWSER_PIN_ARTIFACT_ALIAS_DENIED'
}
$catalog=Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json -ErrorAction Stop
if($catalog.schema -ne 1 -or -not $catalog.products){
  throw 'BROWSER_PIN_CATALOG_INVALID'
}
$entries=@($catalog.products|Where-Object{$_.id -ceq 'browser'})
if($entries.Count -ne 1){throw 'BROWSER_PIN_CATALOG_AMBIGUOUS'}
$state=$entries[0].platforms.windows
if($null -eq $state -or $state.status -cne 'conditional' -or
   [string]$state.version -cnotmatch '^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$' -or
   [string]$state.sha256 -cnotmatch '^[0-9a-f]{64}$'){
  throw 'BROWSER_PIN_CATALOG_UNQUALIFIED'
}
$expected=[string]$state.sha256
$actual=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
if($actual -cne $expected){throw 'BROWSER_PIN_SHA256_MISMATCH'}
# Exact lowercase SHA256 is the only output: the build script pins it to the source catalog.
Write-Output $actual
