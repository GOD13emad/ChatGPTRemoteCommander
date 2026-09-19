param(
  [Parameter(Mandatory=$true)]
  [string]$AppId,
  [string]$MarketplaceName = 'chatgpt-remote-commander-personal',
  [string]$InstallRoot,
  [string]$TemplateSource
)
$ErrorActionPreference = 'Stop'
$ScriptPath = $MyInvocation.MyCommand.Path
$Root = if ([string]::IsNullOrWhiteSpace($ScriptPath)) { (Get-Location).Path } else { Split-Path -Parent $ScriptPath }
$TempTemplateRoot = $null
$ReleaseTag = '__REMOTE_COMMANDER_RELEASE_TAG__'
$PluginTemplateSha256 = '__REMOTE_COMMANDER_PLUGIN_TEMPLATE_SHA256__'
$PluginTemplateManifestBase64 = '__REMOTE_COMMANDER_PLUGIN_TEMPLATE_MANIFEST_BASE64__'
$CanonicalReleaseBase = 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/download'

function Normalize-AppId([string]$Value) {
  $v = $Value.Trim()
  if ($v -match '^plugin_((?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+)$') { $v = $Matches[1] }
  if ($v -notmatch '^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+$') {
    throw 'AppId must be an app id (asdk_app_/connector_/templated_apps_) or the corresponding plugin_ technical id.'
  }
  return $v
}

function Test-PublishedTemplatePin {
  return $ReleaseTag -match '^v[0-9]+\.[0-9]+\.[0-9]+'
}

function Get-PinnedTemplateRecords {
  if ($ReleaseTag -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$' -or
      $PluginTemplateSha256 -notmatch '^[0-9a-f]{64}$' -or
      $PluginTemplateManifestBase64 -notmatch '^[A-Za-z0-9+/]+={0,2}$') {
    throw 'PLUGIN_TEMPLATE_PIN_INVALID'
  }
  try {
    $json = [Text.UTF8Encoding]::new($false).GetString([Convert]::FromBase64String($PluginTemplateManifestBase64))
    $records = @($json | ConvertFrom-Json)
  } catch { throw 'PLUGIN_TEMPLATE_MANIFEST_INVALID' }
  if ($records.Count -eq 0) { throw 'PLUGIN_TEMPLATE_MANIFEST_INVALID' }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($record in $records) {
    $name = [string]$record.name
    if ([string]::IsNullOrWhiteSpace($name) -or $name -notmatch '^[A-Za-z0-9._+/-]+$' -or $name.Contains('\') -or $name.StartsWith('/') -or
        $name -match '(^|/)\.\.?(/|$)' -or $name -match '^[A-Za-z]:' -or
        [long]$record.bytes -lt 0 -or [string]$record.sha256 -notmatch '^[0-9a-f]{64}$' -or
        -not $seen.Add($name)) { throw 'PLUGIN_TEMPLATE_MANIFEST_INVALID' }
  }
  return $records
}

function Get-ContainedTemplatePath([string]$Base, [string]$Relative) {
  if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative -notmatch '^[A-Za-z0-9._+/-]+$' -or $Relative.Contains('\') -or $Relative.StartsWith('/') -or
      $Relative -match '(^|/)\.\.?(/|$)' -or $Relative -match '^[A-Za-z]:') {
    throw 'PLUGIN_TEMPLATE_ENTRY_INVALID'
  }
  $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  $target = [IO.Path]::GetFullPath((Join-Path $baseFull ($Relative.Replace('/',[IO.Path]::DirectorySeparatorChar))))
  if (-not $target.StartsWith($baseFull + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'PLUGIN_TEMPLATE_ENTRY_INVALID'
  }
  return $target
}

function Assert-TemplateDirectory([string]$Directory) {
  if (-not (Test-PublishedTemplatePin)) { return }
  $records = @(Get-PinnedTemplateRecords)
  $rootItem = Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
  if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $rootItem.LinkType) {
    throw 'PLUGIN_TEMPLATE_ENTRY_INVALID'
  }
  if (Get-ChildItem -LiteralPath $Directory -Directory -Recurse -Force | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.LinkType } | Select-Object -First 1) {
    throw 'PLUGIN_TEMPLATE_ENTRY_INVALID'
  }
  $files = @(Get-ChildItem -LiteralPath $Directory -File -Recurse -Force)
  $directories = @(Get-ChildItem -LiteralPath $Directory -Directory -Recurse -Force)
  $actual = @{}
  $actualDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $expectedDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($record in $records) {
    $parts = ([string]$record.name).Split('/')
    for ($index=1; $index -lt $parts.Count; $index++) { [void]$expectedDirectories.Add(($parts[0..($index-1)] -join '/')) }
  }
  foreach ($directory in $directories) {
    $relative = [IO.Path]::GetRelativePath($Directory,$directory.FullName).Replace('\','/')
    [void](Get-ContainedTemplatePath $Directory $relative)
    if (-not $actualDirectories.Add($relative)) { throw 'PLUGIN_TEMPLATE_SET_MISMATCH' }
  }
  if ($actualDirectories.Count -ne $expectedDirectories.Count -or @($actualDirectories | Where-Object { -not $expectedDirectories.Contains($_) }).Count -ne 0) {
    throw 'PLUGIN_TEMPLATE_SET_MISMATCH'
  }
  foreach ($file in $files) {
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.LinkType) { throw 'PLUGIN_TEMPLATE_ENTRY_INVALID' }
    $relative = [IO.Path]::GetRelativePath($Directory,$file.FullName).Replace('\','/')
    [void](Get-ContainedTemplatePath $Directory $relative)
    if ($actual.ContainsKey($relative)) { throw 'PLUGIN_TEMPLATE_SET_MISMATCH' }
    $actual[$relative] = $file
  }
  if ($actual.Count -ne $records.Count) { throw 'PLUGIN_TEMPLATE_SET_MISMATCH' }
  foreach ($record in $records) {
    $name = [string]$record.name
    if (-not $actual.ContainsKey($name)) { throw 'PLUGIN_TEMPLATE_SET_MISMATCH' }
    $file = $actual[$name]
    if ($file.Length -ne [long]$record.bytes -or
        (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$record.sha256) {
      throw 'PLUGIN_TEMPLATE_ENTRY_HASH_MISMATCH'
    }
  }
}

function Expand-VerifiedTemplateZip([string]$ZipPath, [string]$Destination) {
  $actualZipSha = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualZipSha -ne $PluginTemplateSha256) { throw 'PLUGIN_TEMPLATE_SHA256_MISMATCH' }
  $records = @(Get-PinnedTemplateRecords)
  $expected = @{}
  $expectedDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($record in $records) {
    $expected[[string]$record.name] = $record
    $parts = ([string]$record.name).Split('/')
    for ($index=1; $index -lt $parts.Count; $index++) { [void]$expectedDirectories.Add(($parts[0..($index-1)] -join '/')) }
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $files = @{}
    $archiveDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
      $relative = $entry.FullName.Replace('\','/')
      if ([string]::IsNullOrEmpty($entry.Name)) {
        $directoryName = $relative.TrimEnd('/')
        if (-not [string]::IsNullOrEmpty($directoryName)) {
          [void](Get-ContainedTemplatePath $Destination $directoryName)
          if (-not $expectedDirectories.Contains($directoryName) -or -not $archiveDirectories.Add($directoryName)) { throw 'PLUGIN_TEMPLATE_SET_MISMATCH' }
        }
        continue
      }
      [void](Get-ContainedTemplatePath $Destination $relative)
      if ($files.ContainsKey($relative) -or -not $expected.ContainsKey($relative)) { throw 'PLUGIN_TEMPLATE_SET_MISMATCH' }
      if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'PLUGIN_TEMPLATE_ENTRY_INVALID' }
      $stream = $entry.Open()
      try {
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $entryHash = ([Convert]::ToHexString($algorithm.ComputeHash($stream))).ToLowerInvariant() }
        finally { $algorithm.Dispose() }
      } finally { $stream.Dispose() }
      $record = $expected[$relative]
      if ($entry.Length -ne [long]$record.bytes -or $entryHash -ne [string]$record.sha256) { throw 'PLUGIN_TEMPLATE_ENTRY_HASH_MISMATCH' }
      $files[$relative] = $entry
    }
    if ($files.Count -ne $records.Count) { throw 'PLUGIN_TEMPLATE_SET_MISMATCH' }
    foreach ($record in $records) {
      $relative = [string]$record.name
      if (-not $files.ContainsKey($relative)) { throw 'PLUGIN_TEMPLATE_SET_MISMATCH' }
      $target = Get-ContainedTemplatePath $Destination $relative
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      $input = $files[$relative].Open()
      try {
        $output = [IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $input.CopyTo($output) } finally { $output.Dispose() }
      } finally { $input.Dispose() }
    }
  } finally { $zip.Dispose() }
  Assert-TemplateDirectory $Destination
}

function Resolve-TemplateSource {
  if (-not [string]::IsNullOrWhiteSpace($TemplateSource)) {
    $candidate = if ([IO.Path]::IsPathRooted($TemplateSource)) {
      [IO.Path]::GetFullPath($TemplateSource)
    } else {
      [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $TemplateSource))
    }
    if (-not (Test-Path -LiteralPath (Join-Path $candidate 'plugin.json') -PathType Leaf)) { throw "TemplateSource is not a Plugin template: $candidate" }
    Assert-TemplateDirectory $candidate
    return $candidate
  }
  $adjacent = Join-Path $Root 'plugin-template'
  if (Test-Path -LiteralPath (Join-Path $adjacent 'plugin.json') -PathType Leaf) {
    Assert-TemplateDirectory $adjacent
    return $adjacent
  }

  if (-not (Test-PublishedTemplatePin)) { throw 'PLUGIN_TEMPLATE_PIN_REQUIRED' }

  $script:TempTemplateRoot = Join-Path ([IO.Path]::GetTempPath()) ('chatgpt-remote-commander-template-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force $script:TempTemplateRoot | Out-Null
  $zip = Join-Path $script:TempTemplateRoot 'plugin-template.zip'
  $url = "$CanonicalReleaseBase/$ReleaseTag/plugin-template.zip"
  Write-Host "Local Plugin template not found; downloading pinned Release template $ReleaseTag."
  Invoke-WebRequest -Uri $url -OutFile $zip
  $extract = Join-Path $script:TempTemplateRoot 'verified-template'
  New-Item -ItemType Directory -Path $extract | Out-Null
  Expand-VerifiedTemplateZip $zip $extract
  if (-not (Test-Path -LiteralPath (Join-Path $extract 'plugin.json') -PathType Leaf)) { throw 'Downloaded Plugin template did not contain plugin.json.' }
  return $extract
}

$ResolvedAppId = Normalize-AppId $AppId
if ($MarketplaceName -notmatch '^[A-Za-z0-9._-]+$') { throw 'MarketplaceName contains unsupported characters.' }
$Codex = Get-Command codex.exe -ErrorAction SilentlyContinue
if (-not $Codex) { $Codex = Get-Command codex -ErrorAction Stop }
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
  $InstallRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\work-plugin'
} elseif ([IO.Path]::IsPathRooted($InstallRoot)) {
  $InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
} else {
  $InstallRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $InstallRoot))
}

try {
  $ResolvedTemplate = Resolve-TemplateSource
  $MarketplaceRoot = Join-Path $InstallRoot 'marketplace'
  $PluginRoot = Join-Path $MarketplaceRoot 'plugins\chatgpt-remote-commander'
  $ManifestDir = Join-Path $MarketplaceRoot '.agents\plugins'
  $ManifestPath = Join-Path $ManifestDir 'marketplace.json'

  Remove-Item -LiteralPath $PluginRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $PluginRoot,$ManifestDir | Out-Null
  Get-ChildItem $ResolvedTemplate -Force | ForEach-Object { Copy-Item $_.FullName -Destination $PluginRoot -Recurse -Force }

  & (Join-Path $PluginRoot 'bind-app.ps1') -AppId $ResolvedAppId
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "bind-app.ps1 failed: $LASTEXITCODE" }

  $pluginManifestPath = Join-Path $PluginRoot 'plugin.json'
  $pluginManifest = Get-Content $pluginManifestPath -Raw | ConvertFrom-Json
  $pluginManifest.extensions.'com.openai'.interface.displayName = 'ChatGPT Remote Commander (Personal)'
  $pluginManifest.extensions.'com.openai'.interface.shortDescription = 'Use your registered Remote Commander app'
  [IO.File]::WriteAllText($pluginManifestPath,($pluginManifest | ConvertTo-Json -Depth 20)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))

  $market = [ordered]@{
    name = $MarketplaceName
    interface = [ordered]@{ displayName = 'ChatGPT Remote Commander (Personal)' }
    plugins = @([ordered]@{
      name = 'chatgpt-remote-commander'
      source = [ordered]@{ source = 'local'; path = './plugins/chatgpt-remote-commander' }
      policy = [ordered]@{ installation = 'AVAILABLE'; authentication = 'ON_INSTALL' }
      category = 'Productivity'
    })
  }
  [IO.File]::WriteAllText($ManifestPath,($market | ConvertTo-Json -Depth 10)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))

  & $Codex.Source plugin remove "chatgpt-remote-commander@$MarketplaceName" *> $null
  & $Codex.Source plugin marketplace remove $MarketplaceName *> $null
  & $Codex.Source plugin marketplace add $MarketplaceRoot
  if ($LASTEXITCODE) { throw "codex marketplace add failed: $LASTEXITCODE" }
  & $Codex.Source plugin add "chatgpt-remote-commander@$MarketplaceName" --json
  if ($LASTEXITCODE) { throw "codex plugin add failed: $LASTEXITCODE" }

  $app = Get-Content (Join-Path $PluginRoot '.app.json') -Raw | ConvertFrom-Json
  $manifest = Get-Content (Join-Path $PluginRoot 'plugin.json') -Raw | ConvertFrom-Json
  if ($app.apps.'remote-commander'.id -ne $ResolvedAppId) { throw 'Generated .app.json does not match requested app.' }
  if ($manifest.extensions.'com.openai'.apps -ne './.app.json') { throw 'Generated plugin manifest is not app-bound.' }

  Write-Host "WORK_PLUGIN_INSTALL_PASS marketplace=$MarketplaceName app=$ResolvedAppId root=$MarketplaceRoot"
  Write-Host 'Restart/reload ChatGPT Desktop or start a fresh Work task so the plugin inventory reloads.'
} finally {
  if ($TempTemplateRoot -and (Test-Path $TempTemplateRoot)) { Remove-Item $TempTemplateRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
