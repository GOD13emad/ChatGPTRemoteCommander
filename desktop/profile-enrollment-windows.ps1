param(
  [string]$QueueFile = ''
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$CoreRoot=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\app'
if(-not(Test-Path -LiteralPath $CoreRoot -PathType Container)){throw 'Remote Commander core is not installed.'}
$Enroll=Join-Path $CoreRoot 'enable-autostart.ps1'
$Isolate=Join-Path $CoreRoot 'configure-profile-instance.ps1'
if(-not(Test-Path -LiteralPath $Enroll -PathType Leaf)){throw 'Profile enrollment backend is missing.'}
if(-not $QueueFile){$QueueFile=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\onboarding\requested-profiles.txt'}

function Valid-Profile([string]$Name){
  return ($Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -and $Name -notmatch '\.\.' -and $Name -notin @('.','..'))
}
function Load-Queue{
  $names=@()
  if(Test-Path -LiteralPath $QueueFile -PathType Leaf){
    $names=@(Get-Content -LiteralPath $QueueFile | ForEach-Object{$_.Trim()} | Where-Object{$_} | Select-Object -Unique)
  }
  if($names.Count -eq 0){$names=@('chatgpt-remote-commander')}
  return $names
}
function Save-Queue([string[]]$Names){
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $QueueFile)|Out-Null
  if($Names.Count -eq 0){Remove-Item -LiteralPath $QueueFile -Force -ErrorAction SilentlyContinue;return}
  [IO.File]::WriteAllLines($QueueFile,$Names,[Text.UTF8Encoding]::new($false))
}

$form=New-Object Windows.Forms.Form
$form.Text='Remote Commander — Profile Setup'
$form.StartPosition='CenterScreen'
$form.Size=New-Object Drawing.Size(780,610)
$form.MinimumSize=New-Object Drawing.Size(700,560)
$form.BackColor=[Drawing.Color]::FromArgb(16,23,34)
$form.ForeColor=[Drawing.Color]::Gainsboro
$form.Font=New-Object Drawing.Font('Segoe UI',10)
try{$form.Icon=[Drawing.Icon]::ExtractAssociatedIcon((Join-Path $PSScriptRoot 'RemoteCommander.exe'))}catch{}

$title=New-Object Windows.Forms.Label
$title.Text='Connect profiles'
$title.Font=New-Object Drawing.Font('Segoe UI Semibold',18)
$title.AutoSize=$true;$title.Location=New-Object Drawing.Point(24,20);$form.Controls.Add($title)
$hint=New-Object Windows.Forms.Label
$hint.Text='Add one or more ChatGPT tunnel profiles. Runtime API keys stay in memory and are persisted only through Windows DPAPI after tunnel validation.'
$hint.AutoSize=$false;$hint.Size=New-Object Drawing.Size(720,55);$hint.Location=New-Object Drawing.Point(26,58);$hint.ForeColor=[Drawing.Color]::FromArgb(155,180,210);$form.Controls.Add($hint)

$list=New-Object Windows.Forms.ListBox
$list.Location=New-Object Drawing.Point(24,120);$list.Size=New-Object Drawing.Size(280,300);$form.Controls.Add($list)

$profileLabel=New-Object Windows.Forms.Label;$profileLabel.Text='Profile name';$profileLabel.AutoSize=$true;$profileLabel.Location=New-Object Drawing.Point(330,125);$form.Controls.Add($profileLabel)
$profile=New-Object Windows.Forms.TextBox;$profile.Location=New-Object Drawing.Point(330,150);$profile.Size=New-Object Drawing.Size(410,30);$form.Controls.Add($profile)

$tunnelLabel=New-Object Windows.Forms.Label;$tunnelLabel.Text='OpenAI tunnel_id';$tunnelLabel.AutoSize=$true;$tunnelLabel.Location=New-Object Drawing.Point(330,200);$form.Controls.Add($tunnelLabel)
$tunnel=New-Object Windows.Forms.TextBox;$tunnel.Location=New-Object Drawing.Point(330,225);$tunnel.Size=New-Object Drawing.Size(410,30);$form.Controls.Add($tunnel)

$keyLabel=New-Object Windows.Forms.Label;$keyLabel.Text='Runtime API key';$keyLabel.AutoSize=$true;$keyLabel.Location=New-Object Drawing.Point(330,275);$form.Controls.Add($keyLabel)
$key=New-Object Windows.Forms.TextBox;$key.Location=New-Object Drawing.Point(330,300);$key.Size=New-Object Drawing.Size(410,30);$key.UseSystemPasswordChar=$true;$form.Controls.Add($key)

$power=New-Object Windows.Forms.CheckBox;$power.Text='Full Power for isolated secondary profile';$power.AutoSize=$true;$power.Location=New-Object Drawing.Point(330,350);$form.Controls.Add($power)
$gui=New-Object Windows.Forms.CheckBox;$gui.Text='GUI control';$gui.AutoSize=$true;$gui.Location=New-Object Drawing.Point(330,382);$gui.Enabled=$false;$form.Controls.Add($gui)
$power.Add_CheckedChanged({$gui.Enabled=$power.Checked;if(-not $power.Checked){$gui.Checked=$false}})

function Button([string]$Text,[int]$X,[int]$Y,[int]$W=130){
  $b=New-Object Windows.Forms.Button;$b.Text=$Text;$b.Location=New-Object Drawing.Point($X,$Y);$b.Size=New-Object Drawing.Size($W,36);$b.FlatStyle='Flat';$b.BackColor=[Drawing.Color]::FromArgb(34,48,70);$b.ForeColor=[Drawing.Color]::White;$form.Controls.Add($b);return $b
}
$add=Button 'Add profile' 24 438 130
$remove=Button 'Remove' 164 438 120
$provision=Button 'Connect selected' 330 438 180
$done=Button 'Finish' 520 438 110
$status=New-Object Windows.Forms.Label;$status.AutoSize=$false;$status.Location=New-Object Drawing.Point(24,500);$status.Size=New-Object Drawing.Size(716,58);$status.ForeColor=[Drawing.Color]::FromArgb(120,195,245);$form.Controls.Add($status)

function Refresh-List([string[]]$Names){
  $list.Items.Clear();foreach($n in $Names){[void]$list.Items.Add($n)}
  if($list.Items.Count -gt 0){$list.SelectedIndex=0}
}
$script:names=@(Load-Queue)
Refresh-List $script:names
$list.Add_SelectedIndexChanged({if($list.SelectedItem){$profile.Text=[string]$list.SelectedItem}})
$add.Add_Click({
  $n=$profile.Text.Trim()
  if(-not(Valid-Profile $n)){$status.Text='Invalid profile name.';return}
  if($script:names -notcontains $n){$script:names+=@($n);Save-Queue $script:names;Refresh-List $script:names;$list.SelectedItem=$n}
})
$remove.Add_Click({
  if(-not $list.SelectedItem){return}
  $n=[string]$list.SelectedItem;$script:names=@($script:names|Where-Object{$_ -ne $n});Save-Queue $script:names;Refresh-List $script:names
})
$provision.Add_Click({
  $n=$profile.Text.Trim();$tid=$tunnel.Text.Trim()
  if(-not(Valid-Profile $n)){$status.Text='Invalid profile name.';return}
  if($tid -notmatch '^tunnel_[0-9a-f]{32}$'){$status.Text='Invalid tunnel_id format.';return}
  if([string]::IsNullOrWhiteSpace($key.Text)){$status.Text='Runtime API key is required.';return}
  $provision.Enabled=$false;$status.Text="Connecting $n ...";$form.Refresh()
  try{
    $secure=ConvertTo-SecureString $key.Text -AsPlainText -Force
    & $Enroll -Profile $n -TunnelId $tid -RuntimeApiKey $secure
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw "Enrollment failed: $LASTEXITCODE"}
    if($n -ne 'chatgpt-remote-commander'){
      $args=@{Profile=$n}
      if($power.Checked){$args.PowerMode=$true}
      if($gui.Checked){$args.GuiControl=$true}
      & $Isolate @args
      if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw "Profile isolation failed: $LASTEXITCODE"}
    }
    $key.Clear();$secure=$null
    $script:names=@($script:names|Where-Object{$_ -ne $n});Save-Queue $script:names;Refresh-List $script:names
    $status.Text="PROFILE_SETUP_PASS profile=$n"
  }catch{
    $key.Clear();$secure=$null
    $status.Text="Profile setup failed: $($_.Exception.Message)"
  }finally{$provision.Enabled=$true}
})
$done.Add_Click({
  Save-Queue $script:names
  if($script:names.Count -gt 0){
    $r=[Windows.Forms.MessageBox]::Show($form,'Some requested profiles are not connected yet. Finish anyway?','Remote Commander',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question)
    if($r -ne [Windows.Forms.DialogResult]::Yes){return}
  }
  $form.Close()
})

[void]$form.ShowDialog()
