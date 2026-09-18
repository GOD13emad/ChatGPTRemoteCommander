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

function Normalize-AppId([string]$Value) {
  $v = $Value.Trim()
  if ($v -match '^plugin_((?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+)$') { $v = $Matches[1] }
  if ($v -notmatch '^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+$') {
    throw 'AppId must be an app id (asdk_app_/connector_/templated_apps_) or the corresponding plugin_ technical id.'
  }
  return $v
}

function Resolve-TemplateSource {
  if (-not [string]::IsNullOrWhiteSpace($TemplateSource)) {
    $candidate = [IO.Path]::GetFullPath($TemplateSource)
    if (-not (Test-Path (Join-Path $candidate 'plugin.json'))) { throw "TemplateSource is not a Plugin template: $candidate" }
    return $candidate
  }
  $adjacent = Join-Path $Root 'plugin-template'
  if (Test-Path (Join-Path $adjacent 'plugin.json')) { return $adjacent }

  $script:TempTemplateRoot = Join-Path ([IO.Path]::GetTempPath()) ('chatgpt-remote-commander-template-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force $script:TempTemplateRoot | Out-Null
  $zip = Join-Path $script:TempTemplateRoot 'plugin-template.zip'
  $url = 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/plugin-template.zip'
  Write-Host 'Local Plugin template not found; downloading latest Release template.'
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $script:TempTemplateRoot -Force
  foreach ($candidate in @((Join-Path $script:TempTemplateRoot 'plugin-template'), $script:TempTemplateRoot)) {
    if (Test-Path (Join-Path $candidate 'plugin.json')) { return $candidate }
  }
  throw 'Downloaded Plugin template did not contain plugin.json.'
}

$ResolvedAppId = Normalize-AppId $AppId
if ($MarketplaceName -notmatch '^[A-Za-z0-9._-]+$') { throw 'MarketplaceName contains unsupported characters.' }
$Codex = Get-Command codex.exe -ErrorAction SilentlyContinue
if (-not $Codex) { $Codex = Get-Command codex -ErrorAction Stop }
if ([string]::IsNullOrWhiteSpace($InstallRoot)) { $InstallRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\work-plugin' }

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
