param([Parameter(Mandatory=$true)][string]$AppId)
$ErrorActionPreference = 'Stop'
if ($AppId -match '^plugin_((?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+)$') { $AppId = $Matches[1] }
if ($AppId -notmatch '^(asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+$') {
  throw 'AppId must start with asdk_app_, connector_, or templated_apps_ (plugin_ technical ids are also accepted).'
}
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $Root 'plugin.json'
$nativePath = Join-Path $Root '.codex-plugin\plugin.json'
$appPath = Join-Path $Root '.app.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$openai = $manifest.extensions.'com.openai'
$openai | Add-Member -NotePropertyName apps -NotePropertyValue './.app.json' -Force
$native = Get-Content -LiteralPath $nativePath -Raw | ConvertFrom-Json
$native | Add-Member -NotePropertyName apps -NotePropertyValue './.app.json' -Force
$app = [ordered]@{ apps = [ordered]@{ 'remote-commander' = [ordered]@{ id=$AppId; required=$true } } }
[IO.File]::WriteAllText($appPath,(($app|ConvertTo-Json -Depth 8)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($manifestPath,(($manifest|ConvertTo-Json -Depth 20)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($nativePath,(($native|ConvertTo-Json -Depth 20)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
Write-Host "PLUGIN_APP_BOUND id=$AppId native=true"
