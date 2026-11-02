# Owner-local installation of the preview; V1 services and other users are not touched.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_ONLY' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$major = [int](& $node -p 'process.versions.node.split(".")[0]')
if ($major -lt 22) { throw 'NODE_22_REQUIRED' }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'MANIFEST.json') -Raw | ConvertFrom-Json
if ($manifest.mode -ne 'LOCAL_GUI_PREVIEW_NO_PROMOTION') { throw 'PACKAGE_MODE_INVALID' }
$files = @('server.mjs','desktop-app.mjs','local-evidence.mjs','owner-seat-evidence.mjs','workflow-view.mjs','transport-evidence.mjs','owner-diagnostic-reader.mjs','app.js','app.css','index.html','README.md')
$pins = @{}
foreach ($item in $manifest.files) {
  if ($item.path -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$' -or $pins.ContainsKey($item.path)) {
    throw 'MANIFEST_PATH_INVALID'
  }
  $pins[$item.path] = $item.sha256
  $source = Join-Path $PSScriptRoot $item.path
  if (-not(Test-Path -LiteralPath $source -PathType Leaf) -or
    (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) {
    throw ('MANIFEST_HASH_INVALID ' + $item.path)
  }
}
foreach ($name in $files) { if (-not $pins.ContainsKey($name)) { throw ('RUNTIME_FILE_MISSING '+$name) } }
$root = Join-Path $env:LOCALAPPDATA 'CommanderV2'
$dest = Join-Path $root 'WorkspacePreview'
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$link = Join-Path $menu 'Commander V2 Workspace Preview.lnk'
if (-not(Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
foreach($path in @($root,$menu)){
  $entry=Get-Item -LiteralPath $path -Force
  if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'INSTALL_ALIAS_FORBIDDEN' }
}
if (Test-Path -LiteralPath $dest) {
  $entry = Get-Item -LiteralPath $dest -Force
  if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'INSTALL_TARGET_UNTRUSTED' }
  foreach($name in $files) {
    $f=Join-Path $dest $name
    if (-not(Test-Path -LiteralPath $f -PathType Leaf) -or
      (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pins[$name]) {
      throw ('EXISTING_INSTALL_DIFFERS '+$name)
    }
  }
} else {
  $staging = Join-Path $root ('WorkspacePreview.install-'+[Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $staging -ErrorAction Stop | Out-Null
  try {
    foreach($name in $files) {
      Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $staging $name) -ErrorAction Stop
      if ((Get-FileHash -LiteralPath (Join-Path $staging $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pins[$name]) { throw 'STAGED_FILE_MISMATCH' }
    }
    Move-Item -LiteralPath $staging -Destination $dest -ErrorAction Stop
  } finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  }
}
$expectedArgs = '"' + (Join-Path $dest 'desktop-app.mjs') + '"'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $link) {
  $existing = $shell.CreateShortcut($link)
  if ($existing.TargetPath -ne $node -or $existing.Arguments -ne $expectedArgs) { throw 'UNOWNED_SHORTCUT_PRESENT' }
} else {
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $node
  $shortcut.Arguments = $expectedArgs
  $shortcut.WorkingDirectory = $dest
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Commander V2 standalone GUI (preview)'
  $shortcut.Save()
}
Write-Output ('USER_INSTALL_VERIFIED='+$dest)
Write-Output ('START_MENU_SHORTCUT='+$link)
Write-Output 'MODE=LOCAL_GUI_PREVIEW_NO_PROMOTION'
