param(
  [ValidateSet('UI','InstallElevated','RemoveElevated','StatusJson','ActivateNow')][string]$Mode='UI'
)
$ErrorActionPreference='Stop'
$TaskName='ChatGPTRemoteCommander-ElevatedRuntime'
$RunName='ChatGPTRemoteCommander'
$RunKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$StateRoot=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
$CoreRoot=Join-Path $StateRoot 'app'
$AdminDir=Join-Path $StateRoot 'admin-runtime'
$StateFile=Join-Path $AdminDir 'state.json'
$ProbeFile=Join-Path $AdminDir 'last-entry.json'
$Entry=Join-Path $CoreRoot 'elevated-runtime-entry-windows.ps1'

function Test-Elevated {
  $id=[Security.Principal.WindowsIdentity]::GetCurrent()
  $p=[Security.Principal.WindowsPrincipal]::new($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Write-JsonAtomic([string]$Path,[object]$Value){
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $tmp="$Path.tmp-$PID"
  [IO.File]::WriteAllText($tmp,($Value|ConvertTo-Json -Depth 12)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Read-Json([string]$Path){
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
  try{return Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json}catch{return $null}
}
function Get-RunState {
  $item=Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
  $present=$null-ne$item -and $item.PSObject.Properties.Name -contains $RunName
  return [pscustomobject]@{present=$present;value=if($present){[string]$item.$RunName}else{$null}}
}
function Get-TaskState {
  $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if(-not $task){return [pscustomobject]@{installed=$false;valid=$false;taskName=$TaskName}}
  $action=@($task.Actions|Select-Object -First 1)[0]
  $trigger=@($task.Triggers|Select-Object -First 1)[0]
  $info=$task|Get-ScheduledTaskInfo
  $valid=(
    [string]$task.Principal.RunLevel -eq 'Highest' -and
    [string]$task.Principal.LogonType -match 'Interactive' -and
    [string]$action.Execute -match 'pwsh\.exe$' -and
    [string]$action.Arguments -like "*elevated-runtime-entry-windows.ps1*"
  )
  return [pscustomobject]@{
    installed=$true;valid=[bool]$valid;taskName=$TaskName
    user=[string]$task.Principal.UserId;runLevel=[string]$task.Principal.RunLevel
    logonType=[string]$task.Principal.LogonType;execute=[string]$action.Execute
    arguments=[string]$action.Arguments;lastRun=$info.LastRunTime;lastResult=$info.LastTaskResult
    triggerType=$trigger.CimClass.CimClassName
  }
}
function Get-Status {
  $task=Get-TaskState
  $probe=Read-Json $ProbeFile
  $run=Get-RunState
  return [pscustomobject]@{
    task=$task
    lastEntry=$probe
    legacyRun=$run
    stableEntryExists=(Test-Path -LiteralPath $Entry -PathType Leaf)
    managerElevated=(Test-Elevated)
    state=(Read-Json $StateFile)
  }
}
function Get-PwshPath {
  return (Get-Command pwsh.exe -ErrorAction Stop).Source
}
function Install-ElevatedRuntime {
  if(-not(Test-Elevated)){throw 'ADMIN_RUNTIME_ELEVATION_REQUIRED'}
  if(-not(Test-Path -LiteralPath $Entry -PathType Leaf)){throw "ADMIN_RUNTIME_ENTRY_MISSING $Entry"}
  New-Item -ItemType Directory -Force -Path $AdminDir | Out-Null

  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $before=Get-RunState
  $pre=[ordered]@{
    schema=1;capturedAt=(Get-Date).ToUniversalTime().ToString('o')
    runPresent=[bool]$before.present;runValue=$before.value
    taskBefore=(Get-TaskState);user=$identity
  }
  Write-JsonAtomic (Join-Path $AdminDir 'prestate.json') $pre

  $pwsh=Get-PwshPath
  $args='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$Entry+'"'
  $action=New-ScheduledTaskAction -Execute $pwsh -Argument $args -WorkingDirectory $CoreRoot
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

  try{
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    $readback=Get-TaskState
    if(-not $readback.valid){throw 'ADMIN_RUNTIME_TASK_READBACK_FAILED'}

    $started=Get-Date
    Remove-Item -LiteralPath $ProbeFile -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $TaskName
    $probe=$null
    foreach($i in 1..40){
      Start-Sleep -Milliseconds 250
      $probe=Read-Json $ProbeFile
      if($probe -and $probe.elevated -eq $true -and [DateTimeOffset]::Parse([string]$probe.at) -ge [DateTimeOffset]$started.ToUniversalTime()){break}
    }
    if(-not $probe -or $probe.elevated -ne $true){throw 'ADMIN_RUNTIME_ELEVATED_PROBE_FAILED'}

    if($before.present){Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop}
    $after=Get-RunState
    if($after.present){throw 'ADMIN_RUNTIME_LEGACY_RUN_DISABLE_FAILED'}

    $state=[ordered]@{
      schema=1;installedAt=(Get-Date).ToUniversalTime().ToString('o');taskName=$TaskName
      user=$identity;previousRunPresent=[bool]$before.present;previousRunValue=$before.value
      elevatedProbe=$probe;taskReadback=$readback
      plaintextCredentialPersisted=$false;s4uUsed=$false;passwordStored=$false
    }
    Write-JsonAtomic $StateFile $state
    Write-Output "ADMIN_RUNTIME_INSTALL_PASS task=$TaskName user=$identity runLevel=Highest logon=Interactive"
  }catch{
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if($before.present){
      New-Item -Path $RunKey -Force | Out-Null
      New-ItemProperty -Path $RunKey -Name $RunName -Value $before.value -PropertyType String -Force | Out-Null
    }
    throw
  }
}
function Remove-ElevatedRuntime {
  if(-not(Test-Elevated)){throw 'ADMIN_RUNTIME_ELEVATION_REQUIRED'}
  $state=Read-Json $StateFile
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  $current=Get-RunState
  if($state -and $state.previousRunPresent -eq $true -and -not $current.present){
    New-Item -Path $RunKey -Force | Out-Null
    New-ItemProperty -Path $RunKey -Name $RunName -Value ([string]$state.previousRunValue) -PropertyType String -Force | Out-Null
  }
  $record=[ordered]@{schema=1;removedAt=(Get-Date).ToUniversalTime().ToString('o');restoredLegacyRun=[bool]($state -and $state.previousRunPresent -eq $true -and -not $current.present)}
  Write-JsonAtomic (Join-Path $AdminDir 'removed.json') $record
  Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
  Write-Output "ADMIN_RUNTIME_REMOVE_PASS task=$TaskName"
}
function Start-NonElevatedFallback {
  $pwsh=Get-PwshPath
  $supervisor=Join-Path $CoreRoot 'autostart-windows.ps1'
  if(Test-Path -LiteralPath $supervisor -PathType Leaf){
    Start-Process -FilePath $pwsh -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$supervisor) -WindowStyle Hidden | Out-Null
  }
}
function Activate-ElevatedRuntime {
  $task=Get-TaskState
  if(-not $task.valid){throw 'ADMIN_RUNTIME_TASK_NOT_READY'}
  $rootPattern=[regex]::Escape($CoreRoot)
  $supervisors=@(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'autostart-windows\.ps1' -and $_.CommandLine -match $rootPattern })
  foreach($p in $supervisors){Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction Stop}
  Start-Sleep -Milliseconds 500
  $started=[DateTimeOffset]::UtcNow
  Remove-Item -LiteralPath $ProbeFile -Force -ErrorAction SilentlyContinue
  try{
    Start-ScheduledTask -TaskName $TaskName
    $probe=$null
    foreach($i in 1..40){
      Start-Sleep -Milliseconds 250
      $probe=Read-Json $ProbeFile
      if($probe -and $probe.elevated -eq $true -and [DateTimeOffset]::Parse([string]$probe.at) -ge $started){break}
    }
    if(-not $probe -or $probe.elevated -ne $true){throw 'ADMIN_RUNTIME_ACTIVATION_PROBE_FAILED'}
    Write-Output "ADMIN_RUNTIME_ACTIVATE_PASS pid=$($probe.processId)"
  }catch{
    Start-NonElevatedFallback
    throw
  }
}
function Relaunch-Elevated([string]$NextMode){
  $pwsh=Get-PwshPath
  $self=$MyInvocation.MyCommand.Path
  $p=Start-Process -FilePath $pwsh -Verb RunAs -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$self,'-Mode',$NextMode) -Wait -PassThru
  return $p.ExitCode
}

if($Mode -eq 'StatusJson'){Get-Status|ConvertTo-Json -Depth 12;exit 0}
if($Mode -eq 'InstallElevated'){Install-ElevatedRuntime;exit 0}
if($Mode -eq 'RemoveElevated'){Remove-ElevatedRuntime;exit 0}
if($Mode -eq 'ActivateNow'){Activate-ElevatedRuntime;exit 0}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form=New-Object Windows.Forms.Form
$form.Text='Remote Commander — Admin Runtime'
$form.StartPosition='CenterScreen';$form.Size=New-Object Drawing.Size(720,470)
$form.BackColor=[Drawing.Color]::FromArgb(16,23,34);$form.ForeColor=[Drawing.Color]::Gainsboro;$form.Font=New-Object Drawing.Font('Segoe UI',10)
$title=New-Object Windows.Forms.Label;$title.Text='Admin runtime';$title.Font=New-Object Drawing.Font('Segoe UI Semibold',18);$title.AutoSize=$true;$title.Location=New-Object Drawing.Point(24,20);$form.Controls.Add($title)
$desc=New-Object Windows.Forms.Label;$desc.Text='One-time UAC installs a current-user Interactive / Highest scheduled runtime. No password is stored.';$desc.AutoSize=$false;$desc.Size=New-Object Drawing.Size(660,50);$desc.Location=New-Object Drawing.Point(26,62);$desc.ForeColor=[Drawing.Color]::FromArgb(160,180,205);$form.Controls.Add($desc)
$details=New-Object Windows.Forms.TextBox;$details.Multiline=$true;$details.ReadOnly=$true;$details.ScrollBars='Vertical';$details.Location=New-Object Drawing.Point(24,120);$details.Size=New-Object Drawing.Size(660,190);$details.BackColor=[Drawing.Color]::FromArgb(20,29,43);$details.ForeColor=[Drawing.Color]::Gainsboro;$form.Controls.Add($details)
function Btn([string]$Text,[int]$X){$b=New-Object Windows.Forms.Button;$b.Text=$Text;$b.Location=New-Object Drawing.Point($X,330);$b.Size=New-Object Drawing.Size(150,38);$b.FlatStyle='Flat';$b.BackColor=[Drawing.Color]::FromArgb(34,48,70);$b.ForeColor=[Drawing.Color]::White;$form.Controls.Add($b);return $b}
$install=Btn 'Enable Admin' 24
$activate=Btn 'Activate now' 190
$remove=Btn 'Disable Admin' 356
$refresh=Btn 'Refresh' 522
$status=New-Object Windows.Forms.Label;$status.AutoSize=$false;$status.Location=New-Object Drawing.Point(24,386);$status.Size=New-Object Drawing.Size(660,45);$status.ForeColor=[Drawing.Color]::FromArgb(120,195,245);$form.Controls.Add($status)
function Refresh-View {
  $s=Get-Status
  $details.Text=($s|ConvertTo-Json -Depth 8)
  $status.Text=if($s.task.valid){"Admin task installed and verified. Last elevated probe: $($s.lastEntry.at)"}else{'Admin task is not enabled.'}
  $activate.Enabled=[bool]$s.task.valid
}
$install.Add_Click({try{$rc=Relaunch-Elevated 'InstallElevated';if($rc -ne 0){throw "Installer exited $rc"};Refresh-View}catch{$status.Text="Enable failed: $($_.Exception.Message)"}})
$remove.Add_Click({try{$rc=Relaunch-Elevated 'RemoveElevated';if($rc -ne 0){throw "Removal exited $rc"};Refresh-View}catch{$status.Text="Disable failed: $($_.Exception.Message)"}})
$activate.Add_Click({try{Activate-ElevatedRuntime;Refresh-View}catch{$status.Text="Activation failed; fallback supervisor started. $($_.Exception.Message)"}})
$refresh.Add_Click({Refresh-View})
Refresh-View
[void]$form.ShowDialog()
