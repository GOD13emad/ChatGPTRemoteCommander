param(
    [string]$OutputPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..\var')).Path 'CommanderV2-Workspace-MMZ-20261031.zip')
)
$ErrorActionPreference = 'Stop'
$names = @(
    'index.html','app.css','app.js','server.mjs','workflow-view.mjs','workflow-view.test.mjs','local-evidence.mjs',
    'server.test.mjs','transport-evidence.mjs','transport-evidence.test.mjs','owner-diagnostic-reader.mjs','owner-diagnostic-reader.test.mjs','local-evidence.test.mjs','visual-qa.mjs',
    'desktop-app.mjs','desktop-app.test.mjs',
    'owner-seat-evidence.mjs','owner-seat-evidence.test.mjs',
    'upgrade-user.mjs','upgrade-user.test.mjs','PREVIOUS_RELEASE.json',
    'start-windows.cmd','start-linux.sh',
    'start-desktop-windows.cmd','start-desktop-linux.sh',
    'install-user-windows.ps1','install-user-linux.sh','README.md'
)
if(Test-Path -LiteralPath $OutputPath){throw "Archive exists. Refuse overwrite: $OutputPath"}
$destDir=Split-Path $OutputPath -Parent
if(-not (Test-Path $destDir -PathType Container)){throw "Output directory missing: $destDir"}
$items=@()
foreach($name in $names){
  $file=Join-Path $PSScriptRoot $name
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw "Missing file: $name"}
  $items+=@{
    path=$name
    bytes=(Get-Item -LiteralPath $file).Length
    sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$manifest = @{
  product='Commander V2 Workspace GUI'
  mode='LOCAL_GUI_PREVIEW_NO_PROMOTION'
  design='Owner approved dark layout'
  mmzSource='RC_CONTROL_CENTER_PRODUCT_R1 / RC_UI_MONITOR_R1 read-only contracts'
  schema=1
  date='2026-10-31'
  files=$items
} | ConvertTo-Json -Depth 10
Add-Type -AssemblyName System.IO.Compression
$stream=[IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
try {
 $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
 try {
  foreach($name in $names){
   $entry=$zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)
   $entry.LastWriteTime=[DateTimeOffset]::new(2026,10,31,0,0,0,[TimeSpan]::Zero)
   $sink=$entry.Open()
   try{
     $input=[IO.File]::OpenRead((Join-Path $PSScriptRoot $name))
     try{$input.CopyTo($sink)}finally{$input.Dispose()}
   }finally{$sink.Dispose()}
  }
  $entry=$zip.CreateEntry('MANIFEST.json',[IO.Compression.CompressionLevel]::Optimal)
  $entry.LastWriteTime=[DateTimeOffset]::new(2026,10,31,0,0,0,[TimeSpan]::Zero)
  $writer=[IO.StreamWriter]::new($entry.Open(),(New-Object Text.UTF8Encoding($false)))
  try{$writer.Write($manifest)}finally{$writer.Dispose()}
 }finally{$zip.Dispose()}
}finally{$stream.Dispose()}
$verify=[IO.Compression.ZipFile]::OpenRead($OutputPath)
try {
 if($verify.Entries.Count -ne ($names.Count+1)){throw 'Wrong ZIP entry count'}
 foreach($item in $items){
   $entry=$verify.GetEntry($item.path)
   if(-not $entry){throw "Missing archive entry: $($item.path)"}
   $reader=$entry.Open()
   try{
      $sha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($reader)).ToLowerInvariant()
      if($sha -ne $item.sha256){throw "ZIP hash mismatch: $($item.path)"}
   }finally{$reader.Dispose()}
 }
}finally{$verify.Dispose()}
Write-Output ('PACKAGE=' + $OutputPath)
Write-Output ('SHA256=' + (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Output ('BYTES=' + (Get-Item -LiteralPath $OutputPath).Length)
Write-Output ('FILES=' + $names.Count)
