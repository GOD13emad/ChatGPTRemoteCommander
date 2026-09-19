param(
  [Parameter(Mandatory=$true)][string]$Profile,
  [ValidateRange(0,65535)][int]$McpPort = 0,
  [string[]]$AllowedRoot = @(),
  [switch]$PowerMode,
  [switch]$GuiControl,
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
if ($GuiControl -and -not $PowerMode) { throw '-GuiControl requires -PowerMode.' }
if ($Profile -eq 'chatgpt-remote-commander') { throw 'The primary profile stays on the primary MCP. Use an additional profile for isolation.' }
if ($Profile -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or $Profile -match '\.\.' -or $Profile -in @('.','..')) { throw 'Invalid profile name.' }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
$ProfileFile = Join-Path $ProfileDir "$Profile.yaml"
$CredFile = Join-Path $env:LOCALAPPDATA "ChatGPTRemoteCommander\credentials\$Profile.dpapi"
$StateDir = Join-Path $env:LOCALAPPDATA "ChatGPTRemoteCommander\instances\$Profile"
$ConfigFile = Join-Path $StateDir 'config.json'
$CandidateRecord = Join-Path $StateDir 'instance.candidate.json'
$RecordFile = Join-Path $StateDir 'instance.json'
$Generator = Join-Path $Root 'tools\profile-instance-config.mjs'
$BaseConfig = if (Test-Path (Join-Path $Root 'config.local.json')) { Join-Path $Root 'config.local.json' } else { Join-Path $Root 'config.json' }

if (-not (Test-Path -LiteralPath $ProfileFile -PathType Leaf)) { throw 'Existing tunnel profile is required. Enroll the account first.' }
if (-not (Test-Path -LiteralPath $CredFile -PathType Leaf)) { throw 'Existing DPAPI Runtime API credential is required. Enroll the account first.' }
if (-not (Test-Path -LiteralPath $Generator -PathType Leaf)) { throw 'profile-instance-config.mjs is missing.' }
if (Test-Path -LiteralPath $RecordFile) { throw 'Profile is already isolated; inspect the existing instance instead of overwriting it.' }

$raw = Get-Content -LiteralPath $ProfileFile -Raw
$urlMatch = [regex]::Match($raw, 'url:\s*["'']?http://127\.0\.0\.1:(\d+)/mcp')
$healthMatch = [regex]::Match($raw, 'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
if (-not $urlMatch.Success -or -not $healthMatch.Success) { throw 'Profile must use a loopback HTTP MCP URL and loopback health port.' }
$OldMcpPort = [int]$urlMatch.Groups[1].Value
$HealthPort = [int]$healthMatch.Groups[1].Value
if ($OldMcpPort -ne 47831) { throw "Profile already targets non-primary MCP port $OldMcpPort; refusing implicit migration." }

if ($McpPort -eq 0) {
  foreach ($candidate in 47834..47931) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue)) { $McpPort = $candidate; break }
  }
  if ($McpPort -eq 0) { throw 'No free isolated MCP port found in 47834..47931.' }
}
if ($McpPort -eq 47831 -or $McpPort -eq $HealthPort) { throw 'Isolated MCP port conflicts with primary/health port.' }
if (Get-NetTCPConnection -State Listen -LocalPort $McpPort -ErrorAction SilentlyContinue) { throw "Requested MCP port $McpPort is already in use." }

function Find-TunnelExe {
  $stateFile = Join-Path $Root 'var\tunnel-client.json'
  if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) { throw 'Pinned tunnel-client state is missing.' }
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $exe = [IO.Path]::GetFullPath([string]$state.path)
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Pinned tunnel-client executable is missing.' }
  $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$state.sha256).ToLowerInvariant()) { throw 'Pinned tunnel-client SHA256 mismatch.' }
  return $exe
}
function Get-ProfileTunnelProcess([string]$Exe) {
  $expected=[IO.Path]::GetFullPath($Exe);$escaped=[regex]::Escape($Profile);$rx='--profile(?:=|\s+)["'']?'+$escaped+'["'']?(?:\s|$)'
  return Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $expected -and $_.CommandLine -match $rx } |
    Select-Object -First 1
}
function Test-Mcp([int]$Port,[string]$Sha) {
  try { $h=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2; return ($h.ok -and $h.configSha256 -eq $Sha -and [string]$h.instance.profile -eq $Profile) } catch { return $false }
}
function Test-Tunnel {
  try { $r=Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$HealthPort/readyz" -TimeoutSec 2; return ($r.StatusCode -eq 200 -and $r.Content.Trim() -eq 'ready') } catch { return $false }
}
function Start-CandidateMcp([string]$Config,[string]$Sha) {
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $server=Join-Path $Root 'src\server-v0.3.mjs'
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$node;$psi.WorkingDirectory=$Root;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  [void]$psi.ArgumentList.Add($server);$psi.Environment['REMOTE_COMMANDER_CONFIG']=$Config
  $p=[Diagnostics.Process]::Start($psi)
  foreach($i in 1..40){Start-Sleep -Milliseconds 500;if(Test-Mcp $McpPort $Sha){return $p};if($p.HasExited){break}}
  if(-not $p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
  throw 'Isolated MCP did not become healthy.'
}
function Stop-IsolatedMcp([string]$Sha) {
  try {
    $marker=Get-Content -LiteralPath (Join-Path $StateDir 'mcp-runtime.json') -Raw | ConvertFrom-Json
    if([string]$marker.configSha256 -eq $Sha -and [int]$marker.port -eq $McpPort){
      $listener=Get-NetTCPConnection -State Listen -LocalPort $McpPort -ErrorAction SilentlyContinue|Select-Object -First 1
      if($listener -and [int]$listener.OwningProcess -eq [int]$marker.pid){Stop-Process -Id $marker.pid -Force -ErrorAction SilentlyContinue}
    }
  } catch {}
}

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$node=(Get-Command node.exe -ErrorAction Stop).Source
$args=@($Generator,'--profile',$Profile,'--port',[string]$McpPort,'--state-dir',$StateDir,'--base-config',$BaseConfig,'--out-config',$ConfigFile,'--out-record',$CandidateRecord)
foreach($r in $AllowedRoot){$args+=@('--root',$r)}
if($PowerMode){$args+='--power'};if($GuiControl){$args+='--gui'}
& $node @args
if($LASTEXITCODE -ne 0){throw 'Profile instance config generation failed.'}
$record=Get-Content -LiteralPath $CandidateRecord -Raw|ConvertFrom-Json
$ConfigSha=[string]$record.configSha256
if((Get-FileHash -LiteralPath $ConfigFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ConfigSha){throw 'Generated config hash mismatch.'}

$candidateProcess=$null;$committed=$false;$profileChanged=$false;$backup=$null
$TunnelExe=Find-TunnelExe
try {
  $candidateProcess=Start-CandidateMcp $ConfigFile $ConfigSha

  $doctorDir=Join-Path $StateDir 'doctor-profile'
  if(Test-Path $doctorDir){Remove-Item $doctorDir -Recurse -Force}
  New-Item -ItemType Directory -Path $doctorDir|Out-Null
  $doctorText=$raw
  $doctorText=[regex]::Replace($doctorText,'url:\s*["'']?http://127\.0\.0\.1:\d+/mcp["'']?',"url: `"http://127.0.0.1:$McpPort/mcp`"",1)
  $doctorText=[regex]::Replace($doctorText,'listen_addr:\s*["'']?127\.0\.0\.1:\d+["'']?','listen_addr: "127.0.0.1:0"',1)
  [IO.File]::WriteAllText((Join-Path $doctorDir "$Profile.yaml"),$doctorText,[Text.UTF8Encoding]::new($false))

  $encrypted=Get-Content -LiteralPath $CredFile -Raw;$secure=ConvertTo-SecureString $encrypted;$plain=[System.Net.NetworkCredential]::new('', $secure).Password
  try {
    if([string]::IsNullOrWhiteSpace($plain)){throw 'Decrypted credential is empty.'}
    $env:CONTROL_PLANE_API_KEY=$plain
    & $TunnelExe doctor --profile $Profile --profile-dir $doctorDir --explain
    if($LASTEXITCODE -ne 0){throw "tunnel-client doctor failed: $LASTEXITCODE"}
  } finally {Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue;$plain=$null;$secure=$null}
  if($PrepareOnly){ Write-Host "PROFILE_INSTANCE_PREPARE_PASS profile=$Profile mcpPort=$McpPort configSha256=$ConfigSha"; return }

  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $backup=Join-Path $StateDir "profile-before-$stamp.yaml"
  Copy-Item -LiteralPath $ProfileFile -Destination $backup
  if((Get-FileHash $ProfileFile -Algorithm SHA256).Hash -ne (Get-FileHash $backup -Algorithm SHA256).Hash){throw 'Profile backup hash mismatch.'}

  Move-Item -LiteralPath $CandidateRecord -Destination $RecordFile -Force
  $newText=[regex]::Replace($raw,'url:\s*["'']?http://127\.0\.0\.1:\d+/mcp["'']?',"url: `"http://127.0.0.1:$McpPort/mcp`"",1)
  $tmp="$ProfileFile.tmp-$PID";[IO.File]::WriteAllText($tmp,$newText,[Text.UTF8Encoding]::new($false));Move-Item $tmp $ProfileFile -Force;$profileChanged=$true

  $old=Get-ProfileTunnelProcess $TunnelExe
  if($old){Stop-Process -Id $old.ProcessId -Force -ErrorAction Stop}
  $ready=$false
  foreach($i in 1..60){Start-Sleep -Seconds 1;if(Test-Tunnel){$ready=$true;break}}
  if(-not $ready){throw 'Isolated tunnel did not return ready.'}
  if(-not(Test-Mcp $McpPort $ConfigSha)){throw 'Isolated MCP lost health after tunnel migration.'}
  $committed=$true
  Write-Host "PROFILE_INSTANCE_MIGRATION_PASS profile=$Profile mcpPort=$McpPort healthPort=$HealthPort configSha256=$ConfigSha"
} finally {
  Remove-Item (Join-Path $StateDir 'doctor-profile') -Recurse -Force -ErrorAction SilentlyContinue
  if(-not $committed){
    if($profileChanged -and $backup -and (Test-Path $backup)){Copy-Item -LiteralPath $backup -Destination $ProfileFile -Force}
    Remove-Item -LiteralPath $RecordFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $CandidateRecord -Force -ErrorAction SilentlyContinue
    Stop-IsolatedMcp $ConfigSha
  }
  if($PrepareOnly){Remove-Item -LiteralPath $CandidateRecord -Force -ErrorAction SilentlyContinue;Stop-IsolatedMcp $ConfigSha}
}
