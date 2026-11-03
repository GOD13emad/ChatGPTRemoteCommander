param(
  [switch]$Disable,
  [string]$Directory = '',
  [string[]]$ExecutionTools = @('system_status','list_directory','read_text','write_text','run_project_command')
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Join-Path $Root 'config.local.json'
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
  Copy-Item -LiteralPath (Join-Path $Root 'config.json') -Destination $Config
}
$allowed = @(
  'system_status','list_directory','read_text','write_text','run_project_command',
  'power_status','file_info','read_file','write_file','create_directory',
  'gui_status','gui_session_begin','gui_session_renew','gui_session_end',
  'gui_screenshot','gui_list_windows','gui_cursor_position','gui_mouse_move',
  'gui_mouse_delta','gui_mouse_scroll','gui_mouse_click','gui_mouse_drag',
  'gui_type_text','gui_key_press','gui_focus_window'
)
if (@($ExecutionTools | Where-Object { $_ -notin $allowed -or $_ -like 'workflow_*' }).Count) { throw 'ExecutionTools contains an unsupported or recursive workflow tool.' }
if (-not $Directory) { $Directory = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\instances\default\workflows' }
$full = [IO.Path]::GetFullPath($Directory)
if ($full -match '^(?:\\\\|//)') { throw 'Workflow directory must be a local filesystem path.' }

$raw = Get-Content -LiteralPath $Config -Raw
$cfg = $raw | ConvertFrom-Json -AsHashtable
$cfg['durableWorkflows'] = if ($Disable) {
  @{ enabled = $false; directory = $full; executionTools = @($ExecutionTools) }
} else {
  @{ enabled = $true; directory = $full; executionTools = @($ExecutionTools) }
}
$backupDir = Join-Path $Root 'var\config-backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backup = Join-Path $backupDir "config.local.workflows-$stamp.json"
Copy-Item -LiteralPath $Config -Destination $backup
if ((Get-FileHash $Config -Algorithm SHA256).Hash -ne (Get-FileHash $backup -Algorithm SHA256).Hash) { throw 'Config backup hash mismatch.' }
$json = $cfg | ConvertTo-Json -Depth 20
$tmp = "$Config.tmp-$PID"
[IO.File]::WriteAllText($tmp,$json + [Environment]::NewLine,[Text.UTF8Encoding]::new($false))
try { Get-Content -LiteralPath $tmp -Raw | ConvertFrom-Json | Out-Null }
catch { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; throw }
Move-Item -LiteralPath $tmp -Destination $Config -Force
New-Item -ItemType Directory -Force -Path $full | Out-Null
Write-Host "DURABLE_WORKFLOWS_CONFIG_PASS enabled=$(-not $Disable) directory=$full backup=$backup"
Write-Host 'Restart/recycle the MCP server deliberately, then verify workflow_status before use.'
