param([Parameter(Mandatory=$true)][string]$SpecPath)
$ErrorActionPreference='Stop'
try{
  $spec=Get-Content -LiteralPath $SpecPath -Raw|ConvertFrom-Json
  $program=[string]$spec.program
  $cwd=[string]$spec.workingDirectory
  $args=@($spec.arguments|ForEach-Object{[string]$_})
  if(-not $program){throw 'OWNED_COMMAND_PROGRAM_MISSING'}
  if(-not(Test-Path -LiteralPath $cwd -PathType Container)){throw 'OWNED_COMMAND_CWD_MISSING'}
  Push-Location -LiteralPath $cwd
  try{
    & $program @args
    $code=$LASTEXITCODE
    if($null-eq$code){$code=0}
  }finally{
    Pop-Location
  }
  exit ([int]$code)
}catch{
  Write-Error ("OWNED_COMMAND_CHILD_ERROR "+$_.Exception.Message)
  exit 127
}
