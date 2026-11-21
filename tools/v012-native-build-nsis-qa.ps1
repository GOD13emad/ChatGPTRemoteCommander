param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$Output
)
# Current-user Commander V2 v0.12 QA NSIS build from the same release assembler.
# No installation, ChatGPT enrollment, credentials or owner service replacement.
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'V012_NSI_WINDOWS_ONLY'}
if(-not [IO.Path]::IsPathFullyQualified($SourceRoot)){throw 'V012_NSI_SOURCE_ABSOLUTE'}
if(-not [IO.Path]::IsPathFullyQualified($Output) -or
  [IO.Path]::GetExtension($Output).ToLowerInvariant() -ne '.exe'){throw 'V012_NSI_OUTPUT_ABSOLUTE_EXE'}
$SourceRoot=[IO.Path]::GetFullPath($SourceRoot)
$Output=[IO.Path]::GetFullPath($Output)
if(Test-Path -LiteralPath $Output){throw 'V012_NSI_OUTPUT_ALREADY_EXISTS'}
$parent=Split-Path -Parent $Output
if(-not(Test-Path -LiteralPath $parent -PathType Container)){throw 'V012_NSI_OUTPUT_PARENT_MISSING'}
if($parent.StartsWith(($SourceRoot.TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)){
  throw 'V012_NSI_SOURCE_OUTPUT_OVERLAP'
}
if(-not(Test-Path -LiteralPath (Join-Path $SourceRoot '.git'))){throw 'V012_NSI_GIT_SOURCE_REQUIRED'}
$node=(Get-Command node -ErrorAction Stop).Source
$nodeVersion=(& node -p 'JSON.stringify({major:Number(process.versions.node.split(".")[0]),version:process.versions.node,platform:process.platform,arch:process.arch})')|ConvertFrom-Json
if($nodeVersion.platform -ne 'win32' -or $nodeVersion.arch -ne 'x64' -or $nodeVersion.major -lt 22){
  throw 'V012_NSI_NODE22_X64_REQUIRED'
}
if(@('22.23.2','22.23.5') -notcontains $nodeVersion.version){throw 'V012_NSI_NODE_RUNTIME_UNQUALIFIED'}
$license=Join-Path $SourceRoot 'assetsuntime-license
ode-v22-LICENSE.txt'
if(-not(Test-Path -LiteralPath $license -PathType Leaf) -or
  (Get-FileHash -LiteralPath $license -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4'){
  throw 'V012_NSI_NODE_LICENSE_MISSING_OR_CHANGED'
}
$nsisOptions=@(
  (Get-Command makensis.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
  'C:\Program Files (x86)\NSIS\makensis.exe',
  'C:\Program Files\NSIS\makensis.exe'
)
$compiler=@($nsisOptions|Where-Object{$_ -and (Test-Path -LiteralPath $_ -PathType Leaf)}|Select-Object -First 1)
if($compiler.Count -ne 1){throw 'V012_NSI_COMPILER_MISSING'}
$template=Join-Path $PSScriptRoot 'v012-candidate-windows-nsis.nsi'
if(-not(Test-Path -LiteralPath $template -PathType Leaf)){throw 'V012_NSI_TEMPLATE_MISSING'}
$work=Join-Path $parent ('v012-nsis-qa-'+[guid]::NewGuid().ToString('N'))
if(Test-Path -LiteralPath $work){throw 'V012_NSI_WORK_COLLISION'}
[void](New-Item -ItemType Directory -Path $work -ErrorAction Stop)
try{
  $raw=@(& node (Join-Path $SourceRoot 'tools\v012-unified-release-assemble.mjs') --source $SourceRoot --out $work --mode desktop)
  if($LASTEXITCODE -ne 0){throw 'V012_NSI_ASSEMBLY_FAILED'}
  $receipt=($raw -join '')|ConvertFrom-Json
  if($receipt.version -ne '0.12.0-rc.1' -or $receipt.sourceCoreVersion -ne '0.11.0-dev.19' -or
    $receipt.nativeOsInstallerBuilt -ne $false){throw 'V012_NSI_IDENTITY_SCOPE_INVALID'}
  $bundle=[IO.Path]::GetFullPath([string]$receipt.bundle)
  if(-not $bundle.StartsWith(($work.TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)){
    throw 'V012_NSI_BUNDLE_ESCAPE'
  }
  $payload=Join-Path $work 'payload'
  [void](New-Item -ItemType Directory -Path $payload -ErrorAction Stop)
  Copy-Item -Path (Join-Path $bundle '*') -Destination $payload -Recurse -Force -ErrorAction Stop
  $runtime=Join-Path $payload 'runtime'
  [void](New-Item -ItemType Directory -Path $runtime -ErrorAction Stop)
  Copy-Item -LiteralPath $node -Destination (Join-Path $runtime 'node.exe') -ErrorAction Stop
  $licenses=Join-Path $payload 'licenses'
  [void](New-Item -ItemType Directory -Path $licenses -ErrorAction Stop)
  Copy-Item -LiteralPath $license -Destination (Join-Path $licenses 'Node-LICENSE') -ErrorAction Stop
  Copy-Item -LiteralPath (Join-Path $SourceRoot 'LICENSE') -Destination (Join-Path $licenses 'Commander-LICENSE') -ErrorAction Stop
  $tempExe=Join-Path $work 'candidate-installer.exe'
  $parameters=@('/V2',('/DV012_STAGE='+$payload),('/DV012_OUTPUT='+$tempExe),$template)
  & $compiler[0] @parameters
  if($LASTEXITCODE -ne 0){throw 'V012_NSI_COMPILATION_FAILED'}
  if(-not(Test-Path -LiteralPath $tempExe -PathType Leaf)){throw 'V012_NSI_OUTPUT_MISSING'}
  $file=[IO.File]::OpenRead($tempExe)
  try{$signature=New-Object byte[] 2;[void]$file.Read($signature,0,2)}
  finally{$file.Dispose()}
  if($signature[0] -ne 77 -or $signature[1] -ne 90){throw 'V012_NSI_NOT_PE'}
  [IO.File]::Copy($tempExe,$Output,$false)
  $sha=(Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
  if($sha -ne (Get-FileHash -LiteralPath $tempExe -Algorithm SHA256).Hash.ToLowerInvariant()){
    throw 'V012_NSI_OUTPUT_READBACK_HASH'
  }
  "V012_NATIVE_WINDOWS_QA_NSIS_BUILD_PASS sha256=$sha bytes=$((Get-Item -LiteralPath $Output).Length)"
}finally{
  if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop}
}
