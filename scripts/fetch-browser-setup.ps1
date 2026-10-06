param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$Sha256,
  [string]$Destination = ''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

if($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9._-]+)?$'){ throw "Invalid Browser version: $Version" }
if($Sha256 -notmatch '^[0-9a-fA-F]{64}$'){ throw 'Browser SHA256 must be exactly 64 hex characters.' }

$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Name="Remote-Commander-Browser-Setup-v$Version.exe"
if(-not $Destination){
  $Destination=Join-Path $Root ("dist\dependencies\"+$Name)
}else{
  $Destination=[IO.Path]::GetFullPath($Destination)
}
$Parent=Split-Path -Parent $Destination
New-Item -ItemType Directory -Force -Path $Parent | Out-Null

$Url="https://github.com/Usefull-Skills/chatgpt-cef-linux/releases/download/v$Version/$Name"
$Temp=$Destination+'.download'
Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue
try{
  Invoke-WebRequest -Uri $Url -OutFile $Temp -MaximumRetryCount 3 -RetryIntervalSec 2
  if(-not(Test-Path -LiteralPath $Temp -PathType Leaf)){ throw 'Browser release download produced no file.' }
  $Actual=(Get-FileHash -LiteralPath $Temp -Algorithm SHA256).Hash.ToLowerInvariant()
  $Expected=$Sha256.ToLowerInvariant()
  if($Actual -ne $Expected){ throw "Browser SHA256 mismatch expected=$Expected actual=$Actual" }
  Move-Item -LiteralPath $Temp -Destination $Destination -Force
}finally{
  Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue
}

$Sig=Get-AuthenticodeSignature -LiteralPath $Destination
[ordered]@{
  status='REMOTE_COMMANDER_BROWSER_DEPENDENCY_PASS'
  version=$Version
  url=$Url
  path=$Destination
  sha256=$Expected
  signatureStatus=[string]$Sig.Status
}|ConvertTo-Json -Compress
