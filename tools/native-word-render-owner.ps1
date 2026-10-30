param(
 [Parameter(Mandatory=$true)][string]$SourcePath,
 [Parameter(Mandatory=$true)][string]$OutputPdfPath,
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$')][string]$RequestId
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# This worker must run inside the authenticated desktop owner's interactive logon,
# never from a service/SYSTEM account. It never attaches to an existing Word process.
if([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem -or
   (Get-Process -Id $PID).SessionId -le 0){throw 'WORKSPACE_OWNER_SESSION_REQUIRED'}
function AssertLocalFile([string]$p,[bool]$source){
 if(-not [IO.Path]::IsPathFullyQualified($p) -or $p.StartsWith('\\') -or
    $p.StartsWith('//') -or $p.StartsWith('\\?') -or $p.StartsWith('\\.')){
  throw 'WORKSPACE_WORD_LOCAL_PATH_REQUIRED'
 }
 $f=[IO.Path]::GetFullPath($p)
 if($source){
  $item=Get-Item -LiteralPath $f -ErrorAction Stop
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
     $item.Length -gt 104857600){throw 'WORKSPACE_WORD_SOURCE_REJECTED'}
  if([IO.Path]::GetExtension($f).ToLowerInvariant() -ne '.docx'){throw 'WORKSPACE_WORD_DOCX_ONLY'}
 }else{
  if([IO.Path]::GetExtension($f).ToLowerInvariant() -ne '.pdf'){throw 'WORKSPACE_WORD_PDF_ONLY'}
  if(Test-Path -LiteralPath $f){throw 'WORKSPACE_WORD_DESTINATION_EXISTS'}
  $parent=Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($f)) -ErrorAction Stop
  if(!$parent.PSIsContainer -or ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint)){
   throw 'WORKSPACE_WORD_DESTINATION_PARENT_REJECTED'
  }
 }
 return $f
}
$source=AssertLocalFile $SourcePath $true
$destination=AssertLocalFile $OutputPdfPath $false
# Neither caller nor server may ask us to modify an already-open Word document.
if(@(Get-CimInstance Win32_Process -Filter "name='WINWORD.EXE'" -ErrorAction SilentlyContinue).Count){
 throw 'WORKSPACE_WORD_EXISTING_INSTANCE_KEEP'
}
$part=Join-Path ([IO.Path]::GetDirectoryName($destination)) ('.rc-word-'+
  ([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($RequestId)) |
    ForEach-Object ToString x2 |Join-String).Substring(0,24)+'.tmp.pdf')
if(Test-Path -LiteralPath $part){throw 'WORKSPACE_WORD_EFFECT_RECONCILIATION_REQUIRED'}
$word=$null;$doc=$null;$started=Get-Date
$primaryError=$null
try{
 $word=New-Object -ComObject Word.Application
 $word.Visible=$false
 $word.DisplayAlerts=0
 # Force-disable VBA for programmatic opening, irrespective of document state.
 $word.AutomationSecurity=3
 $doc=$word.Documents.Open($source,$false,$true,$false)
 $doc.ExportAsFixedFormat($part,17)
}catch{$primaryError=$_}
finally{
 if($doc){try{$doc.Close(0)}catch{}}
 if($word){try{$word.Quit(0)}catch{}}
 if($doc){try{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}catch{}}
 if($word){try{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)}catch{}}
}
if($primaryError){throw 'WORKSPACE_WORD_RENDER_FAILED_EFFECT_UNKNOWN'}
# Verify only after Word has fully released the file; never re-render on uncertainty.
$item=Get-Item -LiteralPath $part -ErrorAction Stop
if($item.Length -lt 1000){throw 'WORKSPACE_WORD_OUTPUT_UNVERIFIED'}
$stream=[IO.File]::Open($part,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
try{
 $bytes=New-Object byte[] 5
 if($stream.Read($bytes,0,5) -ne 5 -or [Text.Encoding]::ASCII.GetString($bytes) -ne '%PDF-'){
  throw 'WORKSPACE_WORD_OUTPUT_UNVERIFIED'
 }
}finally{$stream.Dispose()}
if(Test-Path -LiteralPath $destination){throw 'WORKSPACE_WORD_DESTINATION_EXISTS'}
[IO.File]::Move($part,$destination)
$final=Get-Item -LiteralPath $destination -ErrorAction Stop
if($final.Length -ne $item.Length){throw 'WORKSPACE_WORD_OUTPUT_UNVERIFIED'}
[pscustomobject]@{
 ok=$true
 mode='OWNER_INTERACTIVE_NATIVE_WORD'
 effect='RENDER_VERIFIED'
 bytes=$final.Length
 sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
 elapsedSeconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2)
}|ConvertTo-Json -Compress
