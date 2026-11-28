[CmdletBinding()]
param([string]$RepoRoot = (Split-Path -Parent $PSScriptRoot))
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
if (-not $IsWindows) { throw 'WINDOWS_NATIVE_TEST_REQUIRED' }
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'WINDOWS_FIXTURE_COMPILER_MISSING' }
$root=Join-Path ([IO.Path]::GetTempPath()) ('rc-tunnel-parity-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$prior=[Environment]::GetEnvironmentVariable('RC_QA_TUNNEL_MARKER')
$passed=0
$failed=0
function Assert-True([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function JsonWrite($Value,[string]$Path) { $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8 }
try {
  $code=Join-Path $root 'Fixture.cs'
  $binary=Join-Path $root 'Fixture.exe'
  @'
using System;
using System.IO;
public static class Fixture {
  public static int Main(string[] args) {
    if(args.Length != 1 || args[0] != "--version") return 2;
    File.WriteAllText(Environment.GetEnvironmentVariable("RC_QA_TUNNEL_MARKER"), "invoked");
    Console.WriteLine("0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0");
    return 0;
  }
}
'@ | Set-Content -LiteralPath $code -Encoding utf8
  & $compiler /nologo /target:exe "/out:$binary" $code
  Assert-True ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $binary)) 'FIXTURE_COMPILE_FAILED'
  $arch=if($env:PROCESSOR_ARCHITEW6432 -eq 'ARM64' -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'amd64'}
  foreach($case in @('valid','changed-companion','missing-companion','changed-main','changed-receipt','changed-metadata','legacy-verify','legacy-adopt','legacy-state-repair','missing-companion-pin')) {
    try {
      $fixture=Join-Path $root $case
      $tools=Join-Path $fixture 'tools'
      $dir=Join-Path $tools "tunnel-client-v0.0.15-windows-$arch"
      $var=Join-Path $fixture 'var'
      New-Item -ItemType Directory -Path $dir,$var -Force | Out-Null
      $helper=Join-Path $tools 'install-tunnel-client-windows.ps1'
      Copy-Item -LiteralPath (Join-Path $RepoRoot 'tools\install-tunnel-client-windows.ps1') -Destination $helper
      $exe=Join-Path $dir 'tunnel-client.exe'
      $companion=Join-Path $dir 'cloudflared.exe'
      Copy-Item -LiteralPath $binary -Destination $exe
      [IO.File]::WriteAllText($companion,'synthetic companion; never executed')
      $pin=Get-Content -LiteralPath (Join-Path $RepoRoot 'tools\tunnel-client-pin.json') -Raw | ConvertFrom-Json
      $asset=$pin.assets.PSObject.Properties["windows-$arch"].Value
      $asset.binarySha256=Hash $exe
      $asset.cloudflaredSha256=Hash $companion
      $meta=[ordered]@{schema=1;version=$pin.version;releaseTag=$pin.releaseTag;upstreamCommit=$pin.upstreamCommit;asset=$asset.file;assetSha256=$asset.sha256;binarySha256=$asset.binarySha256;cloudflaredSha256=$asset.cloudflaredSha256;verification='archive-and-binary-set-sha256'}
      $state=[ordered]@{path=$exe;sha256=$asset.binarySha256;cloudflaredSha256=$asset.cloudflaredSha256}
      $metaPath=Join-Path $var 'tunnel-client-installed.json'
      $statePath=Join-Path $var 'tunnel-client.json'
      $receipt=Join-Path $dir '.verified-archive-sha256'
      Set-Content -LiteralPath $receipt -Value $asset.sha256 -Encoding ascii -NoNewline
      $marker=Join-Path $fixture 'invoked'
      $env:RC_QA_TUNNEL_MARKER=$marker
      $expectSuccess=$case -in @('valid','legacy-adopt','legacy-state-repair')
      $verifyOnly=$case -notin @('legacy-adopt','legacy-state-repair')
      switch($case) {
        'changed-companion' { [IO.File]::AppendAllText($companion,' changed') }
        'missing-companion' { Remove-Item -LiteralPath $companion }
        'changed-main' { [IO.File]::AppendAllText($exe,' changed') }
        'changed-receipt' { Set-Content -LiteralPath $receipt -Value ('0'*64) -Encoding ascii }
        'changed-metadata' { $meta.cloudflaredSha256='0'*64 }
        'legacy-verify' { $meta.Remove('cloudflaredSha256');$meta.Remove('verification') }
        'legacy-adopt' { $meta.Remove('cloudflaredSha256');$meta.Remove('verification');$state.Remove('path');$state.Remove('sha256') }
        'legacy-state-repair' { $state.Remove('path');$state.Remove('sha256') }
        'missing-companion-pin' { $asset.PSObject.Properties.Remove('cloudflaredSha256') }
      }
      JsonWrite $pin (Join-Path $tools 'tunnel-client-pin.json')
      JsonWrite $meta $metaPath
      JsonWrite $state $statePath
      $beforeMeta=Hash $metaPath; $beforeState=Hash $statePath
      $argsForHelper=@('-NoLogo','-NoProfile','-NonInteractive','-File',$helper,'-InstallDir',$fixture)
      if($verifyOnly){$argsForHelper+='-VerifyOnly'}
      $output=(& pwsh.exe @argsForHelper 2>&1 | Out-String)
      $exit=$LASTEXITCODE
      if($expectSuccess){
        Assert-True ($exit -eq 0) ('EXPECTED_SUCCESS: '+$output)
        Assert-True (Test-Path -LiteralPath $marker) 'VERSION_PROBE_NOT_OBSERVED'
        if(-not $verifyOnly){
          $newMeta=Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
          $newState=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
          Assert-True ($newMeta.cloudflaredSha256 -eq $asset.cloudflaredSha256 -and $newState.path -eq $exe -and $newState.sha256 -eq $asset.binarySha256 -and $newState.cloudflaredSha256 -eq $asset.cloudflaredSha256) 'COMPATIBILITY_STATE_INVALID'
          $verifyOutput=(& pwsh.exe @argsForHelper -VerifyOnly 2>&1 | Out-String)
          Assert-True ($LASTEXITCODE -eq 0) ('ADOPTED_STATE_NOT_VERIFIABLE: '+$verifyOutput)
        }
      } else {
        Assert-True ($exit -ne 0) ('UNEXPECTED_SUCCESS: '+$output)
        Assert-True (-not (Test-Path -LiteralPath $marker)) 'UNVERIFIED_EXECUTABLE_INVOKED'
      }
      if($verifyOnly){Assert-True ((Hash $metaPath) -eq $beforeMeta -and (Hash $statePath) -eq $beforeState) 'VERIFY_ONLY_MUTATED_METADATA'}
      Write-Output "PASS $case";$passed++
    } catch { Write-Output "FAIL $case $($_.Exception.Message)";$failed++ }
  }
  Write-Output "WINDOWS_TUNNEL_PROVENANCE passed=$passed failed=$failed"
  if($failed -ne 0){exit 1}
} finally {
  [Environment]::SetEnvironmentVariable('RC_QA_TUNNEL_MARKER',$prior)
  Remove-Item -LiteralPath $root -Recurse -Force
}
