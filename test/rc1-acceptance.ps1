param(
  [string]$ProjectRoot = '',
  [string]$CandidateRef = 'release/v0.5.0-rc1',
  [string]$ExpectedCandidateCommit = '',
  [switch]$Interactive,
  [switch]$AuthorizeGuiInput
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True([bool]$Value,[string]$Message){ if(-not $Value){ throw $Message } }
function Sha256([string]$Path){ (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function PsQuote([string]$Value){ "'" + $Value.Replace("'","''") + "'" }
function New-FreePort {
  foreach($p in 48031..48080){
    if(-not (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)){ return $p }
  }
  throw 'RC1_NO_FREE_TEST_PORT'
}
function Run-Logged([string]$Name,[scriptblock]$Action,[string]$LogPath){
  $output = & $Action 2>&1 | ForEach-Object { $_.ToString() }
  $code = if($null -eq $LASTEXITCODE){0}else{[int]$LASTEXITCODE}
  [IO.File]::WriteAllLines($LogPath,@($output),[Text.UTF8Encoding]::new($false))
  if($code -ne 0){ throw "$Name failed with exit code $code; see $LogPath" }
}
function Wait-JsonFile([string]$Path,[scriptblock]$Predicate,[int]$TimeoutMs=10000){
  $deadline=[DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while([DateTime]::UtcNow -lt $deadline){
    if(Test-Path -LiteralPath $Path){
      try {
        $data=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        if(& $Predicate $data){ return $data }
      } catch {}
    }
    Start-Sleep -Milliseconds 100
  }
  throw "RC1_STATE_TIMEOUT path=$Path"
}

if([string]::IsNullOrWhiteSpace($ProjectRoot)){ $ProjectRoot=Split-Path -Parent $PSScriptRoot }
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
Assert-True (Test-Path -LiteralPath (Join-Path $ProjectRoot '.git')) 'RC1_PROJECT_ROOT_NOT_GIT'
if($ExpectedCandidateCommit){ Assert-True ($ExpectedCandidateCommit -match '^[0-9a-fA-F]{40}$') 'RC1_BAD_EXPECTED_SHA'; $ExpectedCandidateCommit=$ExpectedCandidateCommit.ToLowerInvariant() }

$git=(Get-Command git.exe -ErrorAction Stop).Source
$node=(Get-Command node.exe -ErrorAction Stop).Source
$npm=(Get-Command npm.cmd -ErrorAction Stop).Source
$pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$evidence=Join-Path $ProjectRoot "var\RC1_ACCEPTANCE\$stamp"
$worktree=Join-Path $env:TEMP "ChatGPTRemoteCommander-RC1-$stamp-$PID"
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$summary=[ordered]@{startedAt=(Get-Date).ToString('o');projectRoot=$ProjectRoot;candidateRef=$CandidateRef;expectedCandidateCommit=$ExpectedCandidateCommit;interactive=[bool]$Interactive;steps=@();screenshots=@();pass=$false}
$server=$null;$app=$null;$worktreeAdded=$false;$isolatedPort=$null;$stopPath=$null;$lease=$null

function Save-Summary {
  $summary.completedAt=(Get-Date).ToString('o')
  $path=Join-Path $evidence 'summary.json'
  [IO.File]::WriteAllText($path,($summary|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}

function Invoke-Mcp([string]$Name,[hashtable]$Arguments=@{}){
  $script:rpcId++
  $body=[ordered]@{jsonrpc='2.0';id=$script:rpcId;method='tools/call';params=[ordered]@{name=$Name;arguments=$Arguments}} | ConvertTo-Json -Depth 20 -Compress
  $response=Invoke-RestMethod -Uri "http://127.0.0.1:$isolatedPort/mcp" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 35
  if($response.error){ throw "RC1_MCP_ERROR tool=$Name code=$($response.error.code) message=$($response.error.message)" }
  return $response.result
}
function Invoke-McpExpectError([string]$Name,[hashtable]$Arguments,[string]$Pattern){
  $script:rpcId++
  $body=[ordered]@{jsonrpc='2.0';id=$script:rpcId;method='tools/call';params=[ordered]@{name=$Name;arguments=$Arguments}} | ConvertTo-Json -Depth 20 -Compress
  $response=Invoke-RestMethod -Uri "http://127.0.0.1:$isolatedPort/mcp" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 35
  Assert-True ($null -ne $response.error) "RC1_EXPECTED_ERROR_MISSING tool=$Name"
  Assert-True ([string]$response.error.message -match $Pattern) "RC1_EXPECTED_ERROR_MISMATCH tool=$Name got=$($response.error.message)"
}
function Get-Structured($Result){
  Assert-True ($null -ne $Result.structuredContent) 'RC1_STRUCTURED_CONTENT_MISSING'
  return $Result.structuredContent
}
function Save-Screenshot($Result,[string]$Name){
  $image=@($Result.content | Where-Object { $_.type -eq 'image' }) | Select-Object -First 1
  Assert-True ($null -ne $image) 'RC1_SCREENSHOT_IMAGE_MISSING'
  $ext=if($image.mimeType -eq 'image/png'){'png'}else{'jpg'}
  $file=Join-Path $evidence "$Name.$ext"
  [IO.File]::WriteAllBytes($file,[Convert]::FromBase64String([string]$image.data))
  $summary.screenshots+=@([ordered]@{name=$Name;path=$file;sha256=Sha256 $file;bytes=(Get-Item -LiteralPath $file).Length;mimeType=$image.mimeType})
  return Get-Structured $Result
}

try {
  $fetchSpec="+refs/heads/$CandidateRef`:refs/remotes/origin/$CandidateRef"
  Run-Logged 'git-fetch' { & $git -C $ProjectRoot fetch --force origin $fetchSpec '+refs/heads/main:refs/remotes/origin/main' } (Join-Path $evidence '00-fetch.log')
  $candidate=(& $git -C $ProjectRoot rev-parse "refs/remotes/origin/$CandidateRef^{commit}").Trim().ToLowerInvariant()
  Assert-True ($candidate -match '^[0-9a-f]{40}$') 'RC1_BAD_CANDIDATE_SHA'
  if($ExpectedCandidateCommit){ Assert-True ($candidate -eq $ExpectedCandidateCommit) "RC1_CANDIDATE_DRIFT expected=$ExpectedCandidateCommit actual=$candidate" }
  $mergeBase=(& $git -C $ProjectRoot merge-base refs/remotes/origin/main $candidate).Trim().ToLowerInvariant()
  Assert-True ($mergeBase -match '^[0-9a-f]{40}$') 'RC1_BAD_MERGE_BASE'
  $summary.candidateCommit=$candidate;$summary.mergeBase=$mergeBase

  Run-Logged 'git-worktree-add' { & $git -C $ProjectRoot worktree add --detach $worktree $candidate } (Join-Path $evidence '01-worktree.log')
  $worktreeAdded=$true
  Assert-True ((& $git -C $worktree rev-parse HEAD).Trim().ToLowerInvariant() -eq $candidate) 'RC1_WORKTREE_SHA_MISMATCH'
  $summary.packageVersion=(Get-Content -LiteralPath (Join-Path $worktree 'package.json') -Raw | ConvertFrom-Json).version
  Assert-True ($summary.packageVersion -eq '0.5.0') 'RC1_PACKAGE_VERSION_MISMATCH'

  Run-Logged 'git-diff-check' { & $git -C $worktree diff --check $mergeBase $candidate } (Join-Path $evidence '02-diff-check.log')
  $wtq=PsQuote $worktree;$npmq=PsQuote $npm
  foreach($item in @(@('npm-check','run check','03-npm-check.log'),@('npm-test','test','04-npm-test.log'),@('npm-audit','run audit','05-npm-audit.log'))){
    $name=$item[0];$args=$item[1];$log=Join-Path $evidence $item[2]
    $command="Set-Location $wtq; & $npmq $args; exit `$LASTEXITCODE"
    Run-Logged $name { & $pwsh -NoLogo -NoProfile -NonInteractive -Command $command } $log
  }
  Write-Host 'RC1_NO_INPUT_PASS'

  if($Interactive){
    if(-not $AuthorizeGuiInput){ throw 'RC1_INTERACTIVE_REQUIRES_-AuthorizeGuiInput' }
    $isolatedPort=New-FreePort
    $testRoot=Join-Path $evidence 'test-root';New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    $configPath=Join-Path $evidence 'isolated-config.json'
    $auditPath=Join-Path $evidence 'isolated-audit.jsonl'
    $cfg=[ordered]@{host='127.0.0.1';port=$isolatedPort;allowedRoots=@($testRoot);allowedPrograms=@();maxReadBytes=524288;maxWriteBytes=524288;maxCommandMs=120000;auditLog=$auditPath;powerMode=[ordered]@{enabled=$true;fullFilesystem=$false;allowShell=$false;allowProcessControl=$false;allowPermanentDelete=$false;backupRoot=(Join-Path $testRoot 'backups');maxFileBytes=1048576;guiControl=[ordered]@{enabled=$true;allowScreenshot=$true;allowMouse=$true;allowKeyboard=$true;allowWindowFocus=$true;maxScreenshotWidth=1600;maxScreenshotBytes=2097152}}}
    [IO.File]::WriteAllText($configPath,($cfg|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))

    $serverOut=Join-Path $evidence '10-server.out.log';$serverErr=Join-Path $evidence '10-server.err.log'
    $server=Start-Process -FilePath $node -ArgumentList @('src/server-v0.3.mjs') -WorkingDirectory $worktree -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -Environment @{REMOTE_COMMANDER_CONFIG=$configPath}
    $health=$null
    foreach($i in 1..80){ Start-Sleep -Milliseconds 125; try{$health=Invoke-RestMethod -Uri "http://127.0.0.1:$isolatedPort/health" -TimeoutSec 1;if($health.ok){break}}catch{} }
    Assert-True ($health.ok -and $health.version -eq '0.5.0') 'RC1_ISOLATED_SERVER_HEALTH_FAILED'
    $summary.isolatedPort=$isolatedPort;$summary.isolatedInstanceId=$health.instanceId;$summary.isolatedConfigSha256=$health.configSha256

    $title="RC1 GUI Acceptance $stamp $PID";$stateFile=Join-Path $evidence 'gui-app-state.json'
    $appScript=Join-Path $worktree 'test\gui-disposable-app.ps1'
    $appArgs=@('-NoLogo','-NoProfile','-File',('"{0}"' -f $appScript),'-StateFile',('"{0}"' -f $stateFile),'-Title',('"{0}"' -f $title))
    $app=Start-Process -FilePath $pwsh -ArgumentList $appArgs -PassThru
    $state=Wait-JsonFile $stateFile {param($x)$x.ready -eq $true}
    $summary.disposableApp=[ordered]@{title=$title;pid=$state.processId;handle=$state.handle}

    $script:rpcId=0
    $status=Get-Structured (Invoke-Mcp 'gui_status')
    Assert-True ($status.available -eq $true) "RC1_GUI_STATUS_UNAVAILABLE reason=$($status.reason)"
    $screenMatches=@($status.screens | Where-Object { $state.buttonX -ge $_.left -and $state.buttonX -lt ($_.left+$_.width) -and $state.buttonY -ge $_.top -and $state.buttonY -lt ($_.top+$_.height) })
    Assert-True ($screenMatches.Count -eq 1) 'RC1_DISPOSABLE_APP_MONITOR_NOT_IDENTIFIED'
    $screenIndex=[int]$screenMatches[0].index
    $summary.guiScreen=[ordered]@{index=$screenIndex;left=$screenMatches[0].left;top=$screenMatches[0].top;width=$screenMatches[0].width;height=$screenMatches[0].height}

    $session=Get-Structured (Invoke-Mcp 'gui_session_begin' @{ttlSeconds=120})
    $lease=[string]$session.lease;Assert-True ($lease.Length -ge 32) 'RC1_GUI_LEASE_INVALID'
    Invoke-McpExpectError 'gui_session_begin' @{} 'GUI_LEASE_BUSY'

    $windows=Get-Structured (Invoke-Mcp 'gui_list_windows' @{lease=$lease})
    $matches=@($windows.windows | Where-Object { $_.Title -eq $title })
    Assert-True ($matches.Count -eq 1) 'RC1_DISPOSABLE_WINDOW_NOT_UNIQUE'
    $handle=[string]$matches[0].Handle

    $meta=Save-Screenshot (Invoke-Mcp 'gui_screenshot' @{lease=$lease;screenIndex=$screenIndex;format='png';maxWidth=1600}) '20-before-focus'
    [void](Invoke-Mcp 'gui_focus_window' @{lease=$lease;frame=[string]$meta.frame;handle=$handle})
    $meta=Save-Screenshot (Invoke-Mcp 'gui_screenshot' @{lease=$lease;screenIndex=$screenIndex;format='png';maxWidth=1600}) '21-focused'

    $state=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $clickFrame=[string]$meta.frame
    [void](Invoke-Mcp 'gui_mouse_click' @{lease=$lease;frame=$clickFrame;x=[int]$state.buttonX;y=[int]$state.buttonY;button='left';clicks=1;intervalMs=80})
    [void](Wait-JsonFile $stateFile {param($x)$x.buttonClicks -ge 1})
    Invoke-McpExpectError 'gui_mouse_click' @{lease=$lease;frame=$clickFrame;x=[int]$state.buttonX;y=[int]$state.buttonY} 'GUI_FRESH_FRAME'

    $meta=Save-Screenshot (Invoke-Mcp 'gui_screenshot' @{lease=$lease;screenIndex=$screenIndex;format='png';maxWidth=1600}) '22-after-click'
    $state=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    [void](Invoke-Mcp 'gui_mouse_click' @{lease=$lease;frame=[string]$meta.frame;x=[int]$state.textX;y=[int]$state.textY;button='left';clicks=1;intervalMs=80})
    $meta=Save-Screenshot (Invoke-Mcp 'gui_screenshot' @{lease=$lease;screenIndex=$screenIndex;format='png';maxWidth=1600}) '23-textbox-focused'

    $unicode='سلام Remote Commander 日本語 😀 123'
    [void](Invoke-Mcp 'gui_type_text' @{lease=$lease;frame=[string]$meta.frame;text=$unicode;intervalMs=2})
    $state=Wait-JsonFile $stateFile {param($x)$x.text -eq $unicode}
    $meta=Save-Screenshot (Invoke-Mcp 'gui_screenshot' @{lease=$lease;screenIndex=$screenIndex;format='png';maxWidth=1600}) '24-unicode-text'

    [void](Invoke-Mcp 'gui_key_press' @{lease=$lease;frame=[string]$meta.frame;keys=@('CTRL','A');holdMs=40})
    $meta=Save-Screenshot (Invoke-Mcp 'gui_screenshot' @{lease=$lease;screenIndex=$screenIndex;format='png';maxWidth=1600}) '25-selected-all'
    $replacement='RC1_REPLACED_OK'
    [void](Invoke-Mcp 'gui_type_text' @{lease=$lease;frame=[string]$meta.frame;text=$replacement;intervalMs=1})
    $state=Wait-JsonFile $stateFile {param($x)$x.text -eq $replacement}

    $meta=Save-Screenshot (Invoke-Mcp 'gui_screenshot' @{lease=$lease;screenIndex=$screenIndex;format='png';maxWidth=1600}) '26-before-drag'
    $state=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    [void](Invoke-Mcp 'gui_mouse_drag' @{lease=$lease;frame=[string]$meta.frame;from=@{x=[int]$state.dragFromX;y=[int]$state.dragFromY};to=@{x=[int]$state.dragToX;y=[int]$state.dragToY};button='left';durationMs=400;steps=20})
    $state=Wait-JsonFile $stateFile {param($x)$x.mouseDowns -ge 1 -and $x.mouseUps -ge 1}
    [void](Save-Screenshot (Invoke-Mcp 'gui_screenshot' @{lease=$lease;screenIndex=$screenIndex;format='png';maxWidth=1600}) '27-after-drag')

    $stopPath=Join-Path $worktree 'var\GUI_STOP';New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stopPath) | Out-Null
    [IO.File]::WriteAllText($stopPath,'owner acceptance stop',[Text.UTF8Encoding]::new($false))
    $blocked=Get-Structured (Invoke-Mcp 'gui_status');Assert-True ($blocked.blocked -eq $true -and $blocked.available -eq $false) 'RC1_GUI_STOP_NOT_ENFORCED'
    Remove-Item -LiteralPath $stopPath -Force;$stopPath=$null
    $resumed=Get-Structured (Invoke-Mcp 'gui_status');Assert-True ($resumed.available -eq $true) 'RC1_GUI_STOP_RECOVERY_FAILED'

    [void](Invoke-Mcp 'gui_session_end' @{lease=$lease});$lease=$null
    $summary.guiState=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $summary.pass=$true;Save-Summary;Write-Host 'RC1_INTERACTIVE_GUI_PASS'
  } else {
    $summary.pass=$true;Save-Summary
  }
} catch {
  $summary.error=$_.Exception.Message
  try{Save-Summary}catch{}
  Write-Error $_
  throw
} finally {
  if($stopPath -and (Test-Path -LiteralPath $stopPath)){Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue}
  if($app -and -not $app.HasExited){Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue}
  if($server -and -not $server.HasExited){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
  if($worktreeAdded){ try{& $git -C $ProjectRoot worktree remove --force $worktree | Out-Null}catch{};try{& $git -C $ProjectRoot worktree prune | Out-Null}catch{} }
  Write-Host "RC1_EVIDENCE_DIR=$evidence"
}
