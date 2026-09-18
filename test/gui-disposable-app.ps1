param(
  [Parameter(Mandatory=$true)][string]$StateFile,
  [Parameter(Mandatory=$true)][string]$Title
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form=[Windows.Forms.Form]::new()
$form.Text=$Title
$form.StartPosition='CenterScreen'
$form.ClientSize=[Drawing.Size]::new(760,520)
$form.KeyPreview=$true

$heading=[Windows.Forms.Label]::new()
$heading.Text='ChatGPT Remote Commander GUI Acceptance'
$heading.AutoSize=$true
$heading.Location=[Drawing.Point]::new(40,25)
$heading.Font=[Drawing.Font]::new('Segoe UI',14,[Drawing.FontStyle]::Bold)
$form.Controls.Add($heading)

$button=[Windows.Forms.Button]::new()
$button.Text='CLICK TEST'
$button.Location=[Drawing.Point]::new(50,90)
$button.Size=[Drawing.Size]::new(180,70)
$form.Controls.Add($button)

$box=[Windows.Forms.TextBox]::new()
$box.Location=[Drawing.Point]::new(50,205)
$box.Size=[Drawing.Size]::new(600,35)
$box.Font=[Drawing.Font]::new('Segoe UI',12)
$form.Controls.Add($box)

$panel=[Windows.Forms.Panel]::new()
$panel.Location=[Drawing.Point]::new(50,310)
$panel.Size=[Drawing.Size]::new(600,120)
$panel.BorderStyle='FixedSingle'
$panel.BackColor=[Drawing.Color]::AliceBlue
$form.Controls.Add($panel)

$dragLabel=[Windows.Forms.Label]::new()
$dragLabel.Text='DRAG TEST AREA'
$dragLabel.AutoSize=$true
$dragLabel.Location=[Drawing.Point]::new(220,45)
$panel.Controls.Add($dragLabel)

$script:state=[ordered]@{
  title=$Title; processId=$PID; handle=$null; ready=$false; closed=$false;
  buttonClicks=0; text=''; mouseDowns=0; mouseUps=0; mouseMoves=0; wheelTotal=0;
  buttonX=$null; buttonY=$null; textX=$null; textY=$null;
  dragFromX=$null; dragFromY=$null; dragToX=$null; dragToY=$null
}

function Write-State {
  $dir=Split-Path -Parent $StateFile
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $tmp="$StateFile.tmp-$PID"
  [IO.File]::WriteAllText($tmp,($script:state|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $StateFile -Force
}

$button.Add_Click({$script:state.buttonClicks++;Write-State})
$box.Add_TextChanged({$script:state.text=$box.Text;Write-State})
$panel.Add_MouseDown({$script:state.mouseDowns++;Write-State})
$panel.Add_MouseUp({$script:state.mouseUps++;Write-State})
$panel.Add_MouseMove({$script:state.mouseMoves++;if(($script:state.mouseMoves%5)-eq 0){Write-State}})
$wheel={param($sender,$e)$script:state.wheelTotal+=$e.Delta;Write-State}
$form.Add_MouseWheel($wheel)
$panel.Add_MouseWheel($wheel)
$box.Add_MouseWheel($wheel)
$button.Add_MouseWheel($wheel)

$form.Add_Shown({
  $script:state.handle=$form.Handle.ToInt64().ToString()
  $bp=$button.PointToScreen([Drawing.Point]::new([int]($button.Width/2),[int]($button.Height/2)))
  $tp=$box.PointToScreen([Drawing.Point]::new([int]($box.Width/2),[int]($box.Height/2)))
  $df=$panel.PointToScreen([Drawing.Point]::new(120,60))
  $dt=$panel.PointToScreen([Drawing.Point]::new(480,60))
  $script:state.buttonX=$bp.X;$script:state.buttonY=$bp.Y
  $script:state.textX=$tp.X;$script:state.textY=$tp.Y
  $script:state.dragFromX=$df.X;$script:state.dragFromY=$df.Y
  $script:state.dragToX=$dt.X;$script:state.dragToY=$dt.Y
  $script:state.ready=$true
  Write-State
})
$form.Add_FormClosed({$script:state.closed=$true;Write-State})
[void]$form.ShowDialog()
