[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$ExpectedCommit,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'EXPECTED_COMMIT_INVALID' }
$ExpectedCommit = $ExpectedCommit.ToLowerInvariant()
$Git = (Get-Command git -ErrorAction Stop).Source
$CanonicalRepository = 'https://github.com/GOD13emad/ChatGPTRemoteCommander'
$CanonicalOrigin = "$CanonicalRepository.git"
$CanonicalPackageName = 'chatgpt-remote-commander'
$PayloadNames = @(
  'install-work-plugin.ps1', 'install-work-plugin.sh', 'install.ps1', 'install.sh',
  'plugin-icon.png', 'plugin-icon.svg', 'plugin-logo.png',
  'START_HERE.md', 'WORK_SETUP.md'
)

function Get-FullDirectory([string]$Path, [string]$Code) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "${Code}_INVALID" }
  return [IO.Path]::GetFullPath($item.FullName).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
}

function Test-PathUnder([string]$Parent, [string]$Child) {
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  $childFull = [IO.Path]::GetFullPath($Child)
  if ($childFull -eq $parentFull) { return $true }
  return $childFull.StartsWith($parentFull + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)
}

function Invoke-Git([string[]]$Arguments) {
  $output = @(& $Git @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "GIT_FAILED exit=$LASTEXITCODE" }
  return $output
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-StreamSha256([IO.Stream]$Stream) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([Convert]::ToHexString($algorithm.ComputeHash($Stream))).ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

function Write-Utf8([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false))
}

function Set-ExactPlaceholder([string]$Path, [string]$Needle, [string]$Replacement, [string]$Code) {
  $text = [IO.File]::ReadAllText($Path)
  $count = [regex]::Matches($text,[regex]::Escape($Needle)).Count
  if ($count -ne 1) { throw "${Code}_PLACEHOLDER_COUNT expected=1 actual=$count" }
  $pinned = $text.Replace($Needle,$Replacement)
  if ([regex]::Matches($pinned,[regex]::Escape($Needle)).Count -ne 0 -or
      [regex]::Matches($pinned,[regex]::Escape($Replacement)).Count -ne 1) {
    throw "${Code}_PIN_REPLACEMENT_FAILED"
  }
  Write-Utf8 $Path $pinned
}

function Assert-PowerShellParser([string]$Path) {
  $tokens = $null; $errors = $null
  [Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors) | Out-Null
  if ($errors.Count -ne 0) { throw "POWERSHELL_PARSE_FAILED file=$([IO.Path]::GetFileName($Path))" }
}

function Assert-WindowsInstallerPin([string]$Path, [string]$Commit) {
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
  if ($errors.Count -ne 0) { throw 'INSTALL_PS1_EFFECTIVE_PIN_PARSE_FAILED' }
  $parameters = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'ExpectedCommit' })
  if ($parameters.Count -ne 1) { throw 'INSTALL_PS1_EFFECTIVE_PIN_PARAMETER_INVALID' }
  $default = $parameters[0].DefaultValue
  if ($null -eq $default -or
      $default -isnot [Management.Automation.Language.StringConstantExpressionAst] -or
      [string]$default.Value -ne $Commit) {
    throw 'INSTALL_PS1_EFFECTIVE_PIN_INVALID'
  }
  $reassignments = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
      $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and
      $node.Left.VariablePath.UserPath -eq 'ExpectedCommit'
  },$true))
  if ($reassignments.Count -ne 0) { throw 'INSTALL_PS1_EFFECTIVE_PIN_REASSIGNMENT_REFUSED' }
}

function Assert-WindowsInstallerSourceRef([string]$Path, [string]$Tag) {
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
  if ($errors.Count -ne 0) { throw 'INSTALL_PS1_DEFAULT_SOURCE_REF_PARSE_FAILED' }
  $parameters = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'SourceRef' })
  if ($parameters.Count -ne 1) { throw 'INSTALL_PS1_DEFAULT_SOURCE_REF_PARAMETER_INVALID' }
  $default = $parameters[0].DefaultValue
  if ($null -eq $default -or
      $default -isnot [Management.Automation.Language.StringConstantExpressionAst] -or
      [string]$default.Value -ne $Tag) {
    throw 'INSTALL_PS1_DEFAULT_SOURCE_REF_INVALID'
  }
}

function Get-BashPath {
  $command = Get-Command bash -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if ($IsWindows) {
    $gitDirectory = Split-Path -Parent $Git
    foreach ($candidate in @(
      (Join-Path $gitDirectory '..\bin\bash.exe'),
      (Join-Path $gitDirectory '..\usr\bin\bash.exe')
    )) {
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
    }
  }
  throw 'BASH_PARSER_REQUIRED'
}

function Assert-BashParser([string]$Bash, [string]$Path) {
  & $Bash -n $Path
  if ($LASTEXITCODE -ne 0) { throw "BASH_PARSE_FAILED file=$([IO.Path]::GetFileName($Path))" }
}

function Assert-LinuxInstallerPin([string]$Path, [string]$Commit) {
  $text = [IO.File]::ReadAllText($Path)
  $expected = 'EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-' + $Commit + '}"'
  $effective = [regex]::Matches($text,'(?m)^EXPECTED_COMMIT="\$\{REMOTE_COMMANDER_EXPECTED_COMMIT:-[0-9a-f]{40}\}"\r?$')
  if ($effective.Count -ne 1 -or $effective[0].Value.TrimEnd("`r") -ne $expected) {
    throw 'INSTALL_SH_EFFECTIVE_PIN_INVALID'
  }
}

function Assert-LinuxInstallerSourceRef([string]$Path, [string]$Tag) {
  $text = [IO.File]::ReadAllText($Path)
  $expected = 'SOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-' + $Tag + '}"'
  $effective = [regex]::Matches($text,'(?m)^SOURCE_REF="\$\{REMOTE_COMMANDER_SOURCE_REF:-v[0-9][0-9A-Za-z.+-]*\}"\r?$')
  if ($effective.Count -ne 1 -or $effective[0].Value.TrimEnd("`r") -ne $expected) {
    throw 'INSTALL_SH_DEFAULT_SOURCE_REF_INVALID'
  }
}

function Assert-PublishedPluginInstaller([string]$Path, [string]$Tag, [string]$TemplateSha256, [string]$ManifestBase64, [bool]$PowerShell) {
  $text = [IO.File]::ReadAllText($Path)
  $pins = [ordered]@{ ReleaseTag=$Tag; PluginTemplateSha256=$TemplateSha256; PluginTemplateManifestBase64=$ManifestBase64 }
  if ($PowerShell) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
    if ($errors.Count -ne 0) { throw 'PLUGIN_INSTALLER_EFFECTIVE_PIN_INVALID' }
    foreach ($pin in $pins.GetEnumerator()) {
      $assignments = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.AssignmentStatementAst] -and
          $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and
          $node.Left.VariablePath.UserPath -eq $pin.Key
      },$true))
      $expression = if ($assignments.Count -eq 1 -and $assignments[0].Right -is [Management.Automation.Language.CommandExpressionAst]) { $assignments[0].Right.Expression } else { $null }
      if ($assignments.Count -ne 1 -or
          $expression -isnot [Management.Automation.Language.StringConstantExpressionAst] -or
          [string]$expression.Value -ne [string]$pin.Value) { throw 'PLUGIN_INSTALLER_EFFECTIVE_PIN_INVALID' }
    }
  } else {
    foreach ($pin in $pins.GetEnumerator()) {
      $expected = $pin.Key.Replace('ReleaseTag','RELEASE_TAG').Replace('PluginTemplateSha256','PLUGIN_TEMPLATE_SHA256').Replace('PluginTemplateManifestBase64','PLUGIN_TEMPLATE_MANIFEST_BASE64') + "='$($pin.Value)'"
      $matches = [regex]::Matches($text,'(?m)^' + [regex]::Escape($expected) + '\r?$')
      if ($matches.Count -ne 1) { throw 'PLUGIN_INSTALLER_EFFECTIVE_PIN_INVALID' }
    }
  }
  if ($text.Contains('/releases/latest/download/plugin-template.zip')) { throw 'PLUGIN_INSTALLER_LATEST_URL_REFUSED' }
  if (-not $text.Contains('ChatGPTRemoteCommander/releases/download') -or
      (-not $text.Contains('$CanonicalReleaseBase/$ReleaseTag/plugin-template.zip') -and
       -not $text.Contains('$CANONICAL_RELEASE_BASE/$RELEASE_TAG/plugin-template.zip'))) {
    throw 'PLUGIN_INSTALLER_TAGGED_URL_MISSING'
  }
  foreach ($marker in @('PLUGIN_TEMPLATE_SHA256_MISMATCH','PLUGIN_TEMPLATE_ENTRY_INVALID','PLUGIN_TEMPLATE_SET_MISMATCH','PLUGIN_TEMPLATE_ENTRY_HASH_MISMATCH')) {
    if (-not $text.Contains($marker)) { throw "PLUGIN_INSTALLER_VALIDATOR_MISSING marker=$marker" }
  }
  if ($PowerShell) { Assert-PowerShellParser $Path }
}

function Assert-UniqueNames([string[]]$Names, [string]$Code) {
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($name in $Names) { if (-not $seen.Add($name)) { throw "${Code}_DUPLICATE name=$name" } }
}

function Assert-ExactFileSet([string]$Directory, [string[]]$Expected) {
  Assert-UniqueNames $Expected 'ASSET_SET'
  $items = @(Get-ChildItem -LiteralPath $Directory -Force)
  $directories = @($items | Where-Object PSIsContainer)
  if ($directories.Count -ne 0) { throw "ASSET_SET_EXTRAS directory=$($directories[0].Name)" }
  $actual = @($items | ForEach-Object Name)
  Assert-UniqueNames $actual 'ASSET_SET_ACTUAL'
  $missing = @($Expected | Where-Object { $_ -notin $actual })
  $extras = @($actual | Where-Object { $_ -notin $Expected })
  if ($missing.Count -ne 0) { throw "ASSET_SET_MISSING name=$($missing[0])" }
  if ($extras.Count -ne 0) { throw "ASSET_SET_EXTRAS name=$($extras[0])" }
}

function Assert-PluginZip([string]$ZipPath, [string]$TemplateRoot) {
  $sourceFiles = @(Get-ChildItem -LiteralPath $TemplateRoot -File -Recurse -Force | ForEach-Object {
    [IO.Path]::GetRelativePath($TemplateRoot,$_.FullName).Replace('\','/')
  })
  Assert-UniqueNames $sourceFiles 'PLUGIN_SOURCE_SET'
  $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entries = @($zip.Entries | Where-Object { -not [string]::IsNullOrEmpty($_.Name) })
    $names = @($entries | ForEach-Object { $_.FullName.Replace('\','/') })
    Assert-UniqueNames $names 'PLUGIN_ZIP_SET'
    $missing = @($sourceFiles | Where-Object { $_ -notin $names })
    $extras = @($names | Where-Object { $_ -notin $sourceFiles })
    if ($missing.Count -ne 0) { throw "PLUGIN_ZIP_MISSING path=$($missing[0])" }
    if ($extras.Count -ne 0) { throw "PLUGIN_ZIP_EXTRA path=$($extras[0])" }
    foreach ($entry in $entries) {
      $relative = $entry.FullName.Replace('\','/')
      $source = Join-Path $TemplateRoot ($relative.Replace('/',[IO.Path]::DirectorySeparatorChar))
      $stream = $entry.Open()
      try { $entryHash = Get-StreamSha256 $stream } finally { $stream.Dispose() }
      if ($entryHash -ne (Get-Sha256 $source)) { throw "PLUGIN_ZIP_HASH_MISMATCH path=$relative" }
    }
  } finally { $zip.Dispose() }
}

function Write-HashManifest([string]$Directory, [string[]]$Names) {
  Assert-UniqueNames $Names 'HASH_MANIFEST_INPUT'
  $lines = @($Names | Sort-Object | ForEach-Object { "$(Get-Sha256 (Join-Path $Directory $_))  $_" })
  Write-Utf8 (Join-Path $Directory 'SHA256SUMS.txt') (($lines -join "`n") + "`n")
}

function Assert-HashManifest([string]$Directory, [string[]]$ExpectedNames) {
  $manifest = Join-Path $Directory 'SHA256SUMS.txt'
  $lines = @([IO.File]::ReadAllLines($manifest) | Where-Object { $_ -ne '' })
  $records = @()
  foreach ($line in $lines) {
    if ($line -notmatch '^([0-9a-f]{64})  ([A-Za-z0-9._+-]+)$') { throw 'HASH_MANIFEST_SCHEMA_INVALID' }
    $records += [pscustomobject]@{ sha256=$Matches[1]; name=$Matches[2] }
  }
  $names = @($records | ForEach-Object name)
  Assert-UniqueNames $names 'HASH_MANIFEST'
  $missing = @($ExpectedNames | Where-Object { $_ -notin $names })
  $extras = @($names | Where-Object { $_ -notin $ExpectedNames })
  if ($missing.Count -ne 0) { throw "HASH_MANIFEST_MISSING name=$($missing[0])" }
  if ($extras.Count -ne 0) { throw "HASH_MANIFEST_EXTRA name=$($extras[0])" }
  foreach ($record in $records) {
    if ((Get-Sha256 (Join-Path $Directory $record.name)) -ne $record.sha256) { throw "HASH_MANIFEST_MISMATCH name=$($record.name)" }
  }
}

function Remove-ExactStage([string]$Stage, [string]$Parent) {
  if ([string]::IsNullOrWhiteSpace($Stage) -or -not (Test-Path -LiteralPath $Stage)) { return }
  $full = [IO.Path]::GetFullPath($Stage).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  if ([IO.Path]::GetDirectoryName($full) -ne $Parent -or [IO.Path]::GetFileName($full) -notmatch '^\.release-assets-stage-[0-9a-f]{32}$') { throw 'STAGE_CLEANUP_PATH_REFUSED' }
  $item = Get-Item -LiteralPath $full -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.LinkType) { throw 'STAGE_CLEANUP_REPARSE_POINT_REFUSED' }
  if (Get-ChildItem -LiteralPath $full -Directory -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) { throw 'STAGE_CLEANUP_NESTED_REPARSE_POINT_REFUSED' }
  if (Get-ChildItem -LiteralPath $full -File -Recurse -Force | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.LinkType } | Select-Object -First 1) { throw 'STAGE_CLEANUP_NESTED_FILE_LINK_REFUSED' }
  Remove-Item -LiteralPath $full -Recurse -Force
}

$SourceRoot = Get-FullDirectory $SourceRoot 'SOURCE_ROOT'
$gitTop = ((Invoke-Git @('-C',$SourceRoot,'rev-parse','--show-toplevel')) | Select-Object -Last 1).Trim()
if ([IO.Path]::GetFullPath($gitTop).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar) -ne $SourceRoot) { throw 'SOURCE_ROOT_NOT_GIT_TOP' }
$origin = ((Invoke-Git @('-C',$SourceRoot,'remote','get-url','origin')) | Select-Object -Last 1).Trim()
if ($origin -ne $CanonicalOrigin) { throw "CANONICAL_ORIGIN_MISMATCH expected=$CanonicalOrigin actual=$origin" }
$head = ((Invoke-Git @('-C',$SourceRoot,'rev-parse','--verify','HEAD^{commit}')) | Select-Object -Last 1).Trim().ToLowerInvariant()
if ($head -ne $ExpectedCommit) { throw "SOURCE_COMMIT_MISMATCH expected=$ExpectedCommit actual=$head" }
$resolved = ((Invoke-Git @('-C',$SourceRoot,'rev-parse','--verify',"$ExpectedCommit^{commit}")) | Select-Object -Last 1).Trim().ToLowerInvariant()
if ($resolved -ne $ExpectedCommit) { throw 'EXPECTED_COMMIT_NOT_EXACT' }
$status = @(Invoke-Git @('-C',$SourceRoot,'status','--porcelain=v1','--untracked-files=all'))
if (@($status | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -ne 0) { throw 'SOURCE_TREE_DIRTY' }
$index = @(Invoke-Git @('-C',$SourceRoot,'ls-files','--stage'))
if ($index | Where-Object { $_ -match '^(120000|160000) ' } | Select-Object -First 1) { throw 'SOURCE_SPECIAL_ENTRY_REFUSED' }
$tree = ((Invoke-Git @('-C',$SourceRoot,'rev-parse',"$ExpectedCommit^{tree}")) | Select-Object -Last 1).Trim().ToLowerInvariant()

$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
if (Test-Path -LiteralPath $OutputDirectory) { throw 'OUTPUT_ALREADY_EXISTS' }
if (Test-PathUnder $SourceRoot $OutputDirectory) { throw 'OUTPUT_INSIDE_SOURCE_REFUSED' }
$outputParent = Get-FullDirectory (Split-Path -Parent $OutputDirectory) 'OUTPUT_PARENT'
$stage = Join-Path $outputParent ".release-assets-stage-$([guid]::NewGuid().ToString('N'))"
try {
  $archive = Join-Path $stage 'source.zip'
  $expanded = Join-Path $stage 'source'
  $assets = Join-Path $stage 'assets'
  New-Item -ItemType Directory -Path $stage,$expanded,$assets | Out-Null
  [void](Invoke-Git @('-C',$SourceRoot,'archive','--format=zip',"--output=$archive",$ExpectedCommit))
  Expand-Archive -LiteralPath $archive -DestinationPath $expanded

  $packagePath = Join-Path $expanded 'package.json'
  $pluginManifestPath = Join-Path $expanded 'plugin-template\plugin.json'
  foreach ($required in @(
    'package.json','install.ps1','install.sh','install-work-plugin.ps1','install-work-plugin.sh',
    'START_HERE.md','WORK_SETUP.md','assets\plugin-icon.png','assets\plugin-icon.svg',
    'assets\plugin-logo.png','plugin-template\plugin.json'
  )) {
    $path = Join-Path $expanded $required
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) { throw "SOURCE_ASSET_MISSING path=$required" }
  }
  $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
  $pluginManifest = Get-Content -LiteralPath $pluginManifestPath -Raw | ConvertFrom-Json
  $version = [string]$package.version
  if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') { throw 'RELEASE_VERSION_INVALID' }
  $tag = "v$version"
  $tagOutput = @(& $Git -C $SourceRoot rev-parse --verify "refs/tags/$tag^{commit}" 2>$null)
  if ($LASTEXITCODE -ne 0 -or $tagOutput.Count -eq 0) { throw "RELEASE_TAG_NOT_FOUND tag=$tag" }
  $tagCommit = ([string]($tagOutput | Select-Object -Last 1)).Trim().ToLowerInvariant()
  if ($tagCommit -ne $ExpectedCommit) { throw "RELEASE_TAG_MISMATCH tag=$tag expected=$ExpectedCommit actual=$tagCommit" }
  if ([string]$package.name -ne $CanonicalPackageName) { throw 'PACKAGE_NAME_MISMATCH' }
  if ([string]$package.repository -ne $CanonicalRepository) { throw 'PACKAGE_REPOSITORY_MISMATCH' }
  if ([string]$pluginManifest.version -ne $version) { throw 'PLUGIN_VERSION_MISMATCH' }
  if ([string]$pluginManifest.name -ne $CanonicalPackageName -or
      [string]$pluginManifest.repository -ne $CanonicalRepository -or
      [string]$pluginManifest.homepage -ne $CanonicalRepository) { throw 'PLUGIN_IDENTITY_MISMATCH' }

  $copies = [ordered]@{
    'install.ps1'='install.ps1'; 'install.sh'='install.sh'
    'install-work-plugin.ps1'='install-work-plugin.ps1'; 'install-work-plugin.sh'='install-work-plugin.sh'
    'START_HERE.md'='START_HERE.md'; 'WORK_SETUP.md'='WORK_SETUP.md'
    'plugin-icon.png'='assets\plugin-icon.png'; 'plugin-icon.svg'='assets\plugin-icon.svg'; 'plugin-logo.png'='assets\plugin-logo.png'
  }
  foreach ($entry in $copies.GetEnumerator()) { Copy-Item -LiteralPath (Join-Path $expanded $entry.Value) -Destination (Join-Path $assets $entry.Key) }

  Set-ExactPlaceholder (Join-Path $assets 'install.ps1') "[string]`$ExpectedCommit = ''" "[string]`$ExpectedCommit = '$ExpectedCommit'" 'INSTALL_PS1_PIN'
  Set-ExactPlaceholder (Join-Path $assets 'install.sh') 'EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"' ('EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-' + $ExpectedCommit + '}"') 'INSTALL_SH_PIN'
  Assert-PowerShellParser (Join-Path $assets 'install.ps1')
  Assert-WindowsInstallerPin (Join-Path $assets 'install.ps1') $ExpectedCommit
  Assert-WindowsInstallerSourceRef (Join-Path $assets 'install.ps1') $tag
  $bash = Get-BashPath
  Assert-BashParser $bash (Join-Path $assets 'install.sh')
  Assert-LinuxInstallerPin (Join-Path $assets 'install.sh') $ExpectedCommit
  Assert-LinuxInstallerSourceRef (Join-Path $assets 'install.sh') $tag

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $templateRoot = Join-Path $expanded 'plugin-template'
  $committedTemplateFiles = @(Invoke-Git @('-C',$SourceRoot,'ls-tree','-r','--name-only',$ExpectedCommit,'--','plugin-template') | ForEach-Object {
    ([string]$_).Substring('plugin-template/'.Length).Replace('\','/')
  })
  $expandedTemplateFiles = @(Get-ChildItem -LiteralPath $templateRoot -File -Recurse -Force | ForEach-Object {
    [IO.Path]::GetRelativePath($templateRoot,$_.FullName).Replace('\','/')
  })
  Assert-UniqueNames $committedTemplateFiles 'PLUGIN_COMMIT_SET'
  Assert-UniqueNames $expandedTemplateFiles 'PLUGIN_ARCHIVE_SET'
  $templateMissing = @($committedTemplateFiles | Where-Object { $_ -notin $expandedTemplateFiles })
  $templateExtras = @($expandedTemplateFiles | Where-Object { $_ -notin $committedTemplateFiles })
  if ($templateMissing.Count -ne 0) { throw "PLUGIN_ARCHIVE_MISSING path=$($templateMissing[0])" }
  if ($templateExtras.Count -ne 0) { throw "PLUGIN_ARCHIVE_EXTRA path=$($templateExtras[0])" }
  $versionedTemplate = "plugin-template-v$version.zip"
  [IO.Compression.ZipFile]::CreateFromDirectory($templateRoot,(Join-Path $assets $versionedTemplate),[IO.Compression.CompressionLevel]::Optimal,$false)
  Assert-PluginZip (Join-Path $assets $versionedTemplate) $templateRoot
  Copy-Item -LiteralPath (Join-Path $assets $versionedTemplate) -Destination (Join-Path $assets 'plugin-template.zip')
  Assert-PluginZip (Join-Path $assets 'plugin-template.zip') $templateRoot
  $templateSha256 = Get-Sha256 (Join-Path $assets $versionedTemplate)
  if ($templateSha256 -ne (Get-Sha256 (Join-Path $assets 'plugin-template.zip'))) { throw 'PLUGIN_ZIP_ALIAS_MISMATCH' }
  $templateRecords = @($expandedTemplateFiles | Sort-Object | ForEach-Object {
    $file = Get-Item -LiteralPath (Join-Path $templateRoot ($_.Replace('/',[IO.Path]::DirectorySeparatorChar)))
    [ordered]@{ name=$_; bytes=$file.Length; sha256=(Get-Sha256 $file.FullName) }
  })
  $templateManifestJson = ConvertTo-Json -InputObject @($templateRecords) -Compress -Depth 5
  $templateManifestBase64 = [Convert]::ToBase64String([Text.UTF8Encoding]::new($false).GetBytes($templateManifestJson))
  foreach ($pluginInstaller in @('install-work-plugin.ps1','install-work-plugin.sh')) {
    $pluginInstallerPath = Join-Path $assets $pluginInstaller
    Set-ExactPlaceholder $pluginInstallerPath '__REMOTE_COMMANDER_RELEASE_TAG__' $tag 'PLUGIN_INSTALLER_TAG'
    Set-ExactPlaceholder $pluginInstallerPath '__REMOTE_COMMANDER_PLUGIN_TEMPLATE_SHA256__' $templateSha256 'PLUGIN_INSTALLER_TEMPLATE_SHA'
    Set-ExactPlaceholder $pluginInstallerPath '__REMOTE_COMMANDER_PLUGIN_TEMPLATE_MANIFEST_BASE64__' $templateManifestBase64 'PLUGIN_INSTALLER_TEMPLATE_MANIFEST'
  }
  Assert-PublishedPluginInstaller (Join-Path $assets 'install-work-plugin.ps1') $tag $templateSha256 $templateManifestBase64 $true
  Assert-PublishedPluginInstaller (Join-Path $assets 'install-work-plugin.sh') $tag $templateSha256 $templateManifestBase64 $false
  Assert-BashParser $bash (Join-Path $assets 'install-work-plugin.sh')

  $payload = @($PayloadNames + $versionedTemplate + 'plugin-template.zip')
  Assert-ExactFileSet $assets $payload
  $payloadRecords = @($payload | Sort-Object | ForEach-Object {
    $file = Get-Item -LiteralPath (Join-Path $assets $_)
    [ordered]@{ name=$_; bytes=$file.Length; sha256=(Get-Sha256 $file.FullName) }
  })
  $authority = [ordered]@{
    schema=2; product=$CanonicalPackageName; version=$version; repository=$CanonicalRepository; tag=$tag; commit=$ExpectedCommit; tree=$tree
    source=[ordered]@{ kind='git-archive'; clean=$true; canonicalOrigin=$origin; tagPeeledToCommit=$true }
    provenance=[ordered]@{ builder='tools/build-release-assets.ps1'; exactCommit=$true; exactTree=$true; exactAssetSet=$true }
    buildRuntime=[ordered]@{ os=[Environment]::OSVersion.Platform.ToString(); powershell=$PSVersionTable.PSVersion.ToString(); dotnet=[Environment]::Version.ToString(); git=([string]((Invoke-Git @('--version')) | Select-Object -Last 1)).Trim() }
    reproducibility=[ordered]@{ crossRuntime='UNPROVEN'; note='Hashes prove these emitted bytes; they do not claim independent cross-runtime reproduction.' }
    installerDefaultPins=[ordered]@{
      windows=[ordered]@{ sourceRef=$tag; expectedCommit=$ExpectedCommit }
      linux=[ordered]@{ sourceRef=$tag; expectedCommit=$ExpectedCommit }
    }
    pluginTemplate=[ordered]@{ versioned=$versionedTemplate; generic='plugin-template.zip'; releaseTag=$tag; sha256=$templateSha256; files=$templateRecords }
    assets=$payloadRecords
    hashManifest=[ordered]@{ file='SHA256SUMS.txt'; excludesSelf=$true; coversAuthority=$true }
  }
  Write-Utf8 (Join-Path $assets 'release-authority.json') (($authority | ConvertTo-Json -Depth 12) + "`n")
  $manifestNames = @($payload + 'release-authority.json')
  Write-HashManifest $assets $manifestNames
  $finalNames = @($manifestNames + 'SHA256SUMS.txt')
  Assert-ExactFileSet $assets $finalNames
  Assert-HashManifest $assets $manifestNames

  $verifiedAuthority = Get-Content -LiteralPath (Join-Path $assets 'release-authority.json') -Raw | ConvertFrom-Json
  if ([int]$verifiedAuthority.schema -ne 2 -or [string]$verifiedAuthority.repository -ne $CanonicalRepository -or [string]$verifiedAuthority.tag -ne $tag -or [string]$verifiedAuthority.commit -ne $ExpectedCommit -or [string]$verifiedAuthority.tree -ne $tree -or [string]$verifiedAuthority.version -ne $version) { throw 'RELEASE_AUTHORITY_MISMATCH' }
  $authorityNames = @($verifiedAuthority.assets | ForEach-Object name)
  Assert-UniqueNames $authorityNames 'RELEASE_AUTHORITY_ASSET'
  if (@($payload | Where-Object { $_ -notin $authorityNames }).Count -ne 0 -or @($authorityNames | Where-Object { $_ -notin $payload }).Count -ne 0) { throw 'RELEASE_AUTHORITY_ASSET_SET_MISMATCH' }
  foreach ($record in @($verifiedAuthority.assets)) {
    $file = Get-Item -LiteralPath (Join-Path $assets ([string]$record.name))
    if ($file.Length -ne [long]$record.bytes -or (Get-Sha256 $file.FullName) -ne [string]$record.sha256) { throw "RELEASE_AUTHORITY_HASH_MISMATCH name=$($record.name)" }
  }

  $manifestSha256 = Get-Sha256 (Join-Path $assets 'SHA256SUMS.txt')
  [IO.Directory]::Move($assets,$OutputDirectory)
  [pscustomobject]@{
    ok=$true; version=$version; commit=$ExpectedCommit; tree=$tree; output=$OutputDirectory
    assetCount=$finalNames.Count; sha256Manifest=$manifestSha256
  } | ConvertTo-Json -Compress
} finally {
  Remove-ExactStage $stage $outputParent
}
