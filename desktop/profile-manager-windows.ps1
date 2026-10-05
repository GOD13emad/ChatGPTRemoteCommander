param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$StateRoot=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
$Routing=Join-Path $StateRoot 'routing'
$Instances=Join-Path $StateRoot 'instances'
$TunnelDir=Join-Path $env:APPDATA 'tunnel-client'
$CredentialDir=Join-Path $StateRoot 'credentials'

function Read-Json([string]$Path){
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
  try{return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json}catch{return $null}
}
function Get-ProjectDir {
  $state=Read-Json (Join-Path $Routing 'default.json')
  $candidate=[string]$state.active.projectDir
  if([string]::IsNullOrWhiteSpace($candidate) -or -not(Test-Path -LiteralPath $candidate -PathType Container)){
    throw 'Active Commander project directory is unavailable.'
  }
  return [IO.Path]::GetFullPath($candidate)
}
function Get-ProfileRows {
  $rows=[Collections.Generic.List[object]]::new()
  $routingMap=@{}
  if(Test-Path -LiteralPath $Routing){
    Get-ChildItem -LiteralPath $Routing -File -Filter '*.runtime.json' -ErrorAction SilentlyContinue | ForEach-Object {
      $name=$_.Name.Substring(0,$_.Name.Length-'.runtime.json'.Length)
      $state=Read-Json (Join-Path $Routing ($name+'.json'))
      $runtime=Read-Json $_.FullName
      if($state -and $runtime -and [string]$state.profile -eq $name){
        $routingMap[$name]=[pscustomobject]@{
          Version=[string]$state.active.version
          RouterPort=[int]$runtime.port
          BackendPort=[int]$state.active.port
        }
      }
    }
  }

  $tunnels=@()
  if(Test-Path -LiteralPath $TunnelDir){
    $tunnels=Get-ChildItem -LiteralPath $TunnelDir -File -Filter '*.yaml' -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty BaseName
  }

  $instanceNames=@()
  if(Test-Path -LiteralPath $Instances){
    $instanceNames=Get-ChildItem -LiteralPath $Instances -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'instance.json') } |
      Select-Object -ExpandProperty Name
  }

  $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [void]$names.Add('default')
  foreach($name in $tunnels){
    if($name -eq 'chatgpt-remote-commander'){[void]$names.Add('default')}else{[void]$names.Add($name)}
  }
  foreach($name in $instanceNames){[void]$names.Add($name)}
  foreach($name in $routingMap.Keys){[void]$names.Add($name)}

  foreach($name in ($names | Sort-Object)){
    $primary=$name -eq 'default'
    $tunnel=if($primary){'chatgpt-remote-commander'}else{$name}
    $instance=Read-Json (Join-Path (Join-Path $Instances $name) 'instance.json')
    $config=Read-Json (Join-Path (Join-Path $Instances $name) 'config.json')
    $route=$routingMap[$name]
    $hasTunnel=$tunnels -contains $tunnel
    $hasCredential=Test-Path -LiteralPath (Join-Path $CredentialDir ($tunnel+'.dpapi')) -PathType Leaf
    $role=if($primary){'Primary'}elseif($instance){'Isolated'}elseif($hasTunnel){'Available'}else{'Unknown'}
    $status=if($route){'ONLINE'}elseif($instance){'CONFIGURED'}elseif($hasTunnel){'READY TO ADD'}else{'UNAVAILABLE'}
    $power=if($primary){''}elseif($config){[bool]$config.powerMode.enabled}else{$false}
    $gui=if($primary){''}elseif($config){[bool]$config.powerMode.guiControl.enabled}else{$false}
    $rows.Add([pscustomobject]@{
      Profile=$name
      TunnelProfile=$tunnel
      Role=$role
      Status=$status
      Version=if($route){$route.Version}else{''}
      RouterPort=if($route){$route.RouterPort}else{0}
      BackendPort=if($route){$route.BackendPort}elseif($instance){[int]$instance.mcpPort}else{0}
      PowerMode=$power
      GuiControl=$gui
      Credential=if($hasCredential){'Present'}else{'Missing'}
    })
  }
  return $rows
}
function Invoke-CommanderScript([string]$Script,[string[]]$Arguments){
  $project=Get-ProjectDir
  $path=Join-Path $project $Script
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Required Commander script is missing: $Script"}
  $pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$pwsh
  $psi.WorkingDirectory=$project
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  [void]$psi.ArgumentList.Add('-NoLogo')
  [void]$psi.ArgumentList.Add('-NoProfile')
  [void]$psi.ArgumentList.Add('-File')
  [void]$psi.ArgumentList.Add($path)
  foreach($a in $Arguments){[void]$psi.ArgumentList.Add($a)}
  $p=[Diagnostics.Process]::Start($psi)
  $stdout=$p.StandardOutput.ReadToEnd()
  $stderr=$p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if($p.ExitCode -ne 0){throw (($stderr+"`n"+$stdout).Trim())}
  return $stdout.Trim()
}
function Selected-Row([Windows.Forms.DataGridView]$Grid){
  if($Grid.SelectedRows.Count -lt 1){throw 'Select one profile first.'}
  return $Grid.SelectedRows[0].DataBoundItem
}

$form=New-Object Windows.Forms.Form
$form.Text='Remote Commander — Profile Manager'
$form.Width=980
$form.Height=610
$form.MinimumSize=New-Object Drawing.Size 820,520
$form.StartPosition='CenterParent'
$form.BackColor=[Drawing.Color]::FromArgb(7,22,47)
$form.ForeColor=[Drawing.Color]::White
$form.Font=New-Object Drawing.Font 'Segoe UI',10
$exe=Join-Path $PSScriptRoot 'RemoteCommander.exe'
if(Test-Path -LiteralPath $exe){try{$form.Icon=[Drawing.Icon]::ExtractAssociatedIcon($exe)}catch{}}

$title=New-Object Windows.Forms.Label
$title.Text='Manage Commander Profiles'
$title.AutoSize=$true
$title.Font=[Drawing.Font]::new('Segoe UI Semibold',20,[Drawing.FontStyle]::Bold)
$title.Location=New-Object Drawing.Point 20,18
$form.Controls.Add($title)

$hint=New-Object Windows.Forms.Label
$hint.Text='Profiles are created or changed only through Commander''s guarded profile scripts. The primary profile is never modified here.'
$hint.AutoSize=$true
$hint.ForeColor=[Drawing.Color]::FromArgb(185,199,221)
$hint.Location=New-Object Drawing.Point 23,60
$form.Controls.Add($hint)

$grid=New-Object Windows.Forms.DataGridView
$grid.Location=New-Object Drawing.Point 20,95
$grid.Size=New-Object Drawing.Size 925,330
$grid.Anchor='Top,Bottom,Left,Right'
$grid.ReadOnly=$true
$grid.AllowUserToAddRows=$false
$grid.AllowUserToDeleteRows=$false
$grid.MultiSelect=$false
$grid.SelectionMode='FullRowSelect'
$grid.AutoGenerateColumns=$true
$grid.AutoSizeColumnsMode='Fill'
$grid.BackgroundColor=[Drawing.Color]::FromArgb(12,34,65)
$grid.GridColor=[Drawing.Color]::FromArgb(45,76,113)
$grid.DefaultCellStyle.BackColor=[Drawing.Color]::FromArgb(12,34,65)
$grid.DefaultCellStyle.ForeColor=[Drawing.Color]::White
$grid.DefaultCellStyle.SelectionBackColor=[Drawing.Color]::FromArgb(18,82,135)
$grid.DefaultCellStyle.SelectionForeColor=[Drawing.Color]::White
$grid.ColumnHeadersDefaultCellStyle.BackColor=[Drawing.Color]::FromArgb(18,52,91)
$grid.ColumnHeadersDefaultCellStyle.ForeColor=[Drawing.Color]::White
$grid.EnableHeadersVisualStyles=$false
$form.Controls.Add($grid)

$power=New-Object Windows.Forms.CheckBox
$power.Text='Power Mode'
$power.AutoSize=$true
$power.Location=New-Object Drawing.Point 24,440
$power.Anchor='Bottom,Left'
$form.Controls.Add($power)

$gui=New-Object Windows.Forms.CheckBox
$gui.Text='GUI Control'
$gui.AutoSize=$true
$gui.Location=New-Object Drawing.Point 145,440
$gui.Anchor='Bottom,Left'
$form.Controls.Add($gui)

$gui.Add_CheckedChanged({
  if($gui.Checked -and -not $power.Checked){$power.Checked=$true}
})
$power.Add_CheckedChanged({
  if(-not $power.Checked -and $gui.Checked){$gui.Checked=$false}
})

function New-Button([string]$Text,[int]$X,[int]$Width){
  $b=New-Object Windows.Forms.Button
  $b.Text=$Text
  $b.Location=New-Object Drawing.Point $X,475
  $b.Size=New-Object Drawing.Size $Width,36
  $b.Anchor='Bottom,Left'
  $b.FlatStyle='Flat'
  $b.BackColor=[Drawing.Color]::FromArgb(18,52,91)
  $b.ForeColor=[Drawing.Color]::White
  $b.FlatAppearance.BorderColor=[Drawing.Color]::FromArgb(55,205,255)
  $form.Controls.Add($b)
  return $b
}
$refresh=New-Button 'Refresh' 20 100
$add=New-Button 'Add / Isolate' 130 135
$reconfigure=New-Button 'Reconfigure' 275 130
$open=New-Button 'Open Profile Data' 415 150
$close=New-Button 'Close' 575 100

$status=New-Object Windows.Forms.Label
$status.Text='Ready'
$status.AutoSize=$true
$status.ForeColor=[Drawing.Color]::FromArgb(139,166,200)
$status.Location=New-Object Drawing.Point 23,525
$status.Anchor='Bottom,Left'
$form.Controls.Add($status)

function Refresh-Grid {
  $grid.DataSource=$null
  $rows=Get-ProfileRows
  $grid.DataSource=[Collections.ArrayList]@($rows)
  if($grid.Columns['TunnelProfile']){$grid.Columns['TunnelProfile'].Visible=$false}
  $status.Text="$($rows.Count) profile record(s)"
}
$refresh.Add_Click({try{Refresh-Grid}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Remote Commander',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Error)|Out-Null}})
$add.Add_Click({
  try{
    $row=Selected-Row $grid
    if($row.Role -eq 'Primary'){throw 'The primary profile cannot be isolated or recreated here.'}
    if($row.Role -eq 'Isolated'){throw 'This profile is already isolated. Use Reconfigure.'}
    if($row.Credential -ne 'Present'){throw 'The selected tunnel profile has no local DPAPI credential. Enroll it before adding it to Commander.'}
    $msg="Add '$($row.Profile)' as an isolated Commander profile?`n`nThis uses the existing enrolled tunnel profile. It does not log out of ChatGPT or change browser cookies."
    if([Windows.Forms.MessageBox]::Show($msg,'Remote Commander',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question) -ne [Windows.Forms.DialogResult]::Yes){return}
    $args=@('-Profile',[string]$row.TunnelProfile)
    if($power.Checked){$args+='-PowerMode'}
    if($gui.Checked){$args+='-GuiControl'}
    $status.Text='Creating guarded isolated profile...'
    $out=Invoke-CommanderScript 'configure-profile-instance.ps1' $args
    $status.Text=($out -split "`r?`n" | Select-Object -Last 1)
    Refresh-Grid
  }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Remote Commander',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Error)|Out-Null;$status.Text='Operation failed safely.'}
})
$reconfigure.Add_Click({
  try{
    $row=Selected-Row $grid
    if($row.Role -ne 'Isolated'){throw 'Only an isolated secondary profile can be reconfigured here.'}
    $msg="Reconfigure '$($row.Profile)'?`n`nThat profile may recycle briefly. Commander will use its existing backup/rollback guard if the new instance does not become healthy."
    if([Windows.Forms.MessageBox]::Show($msg,'Remote Commander',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Warning) -ne [Windows.Forms.DialogResult]::Yes){return}
    $args=@('-Profile',[string]$row.Profile)
    if($power.Checked){$args+='-PowerMode'}else{$args+='-StandardMode'}
    if($gui.Checked){$args+='-GuiControl'}else{$args+='-DisableGuiControl'}
    $status.Text='Reconfiguring with rollback protection...'
    $out=Invoke-CommanderScript 'reconfigure-profile-instance.ps1' $args
    $status.Text=($out -split "`r?`n" | Select-Object -Last 1)
    Refresh-Grid
  }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Remote Commander',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Error)|Out-Null;$status.Text='Operation failed safely.'}
})
$open.Add_Click({
  try{
    $row=Selected-Row $grid
    $path=Join-Path $Instances ([string]$row.Profile)
    if(-not(Test-Path -LiteralPath $path)){New-Item -ItemType Directory -Force $path|Out-Null}
    Start-Process explorer.exe -ArgumentList @($path)
  }catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message,'Remote Commander',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Error)|Out-Null}
})
$close.Add_Click({$form.Close()})

Refresh-Grid
[void]$form.ShowDialog()
