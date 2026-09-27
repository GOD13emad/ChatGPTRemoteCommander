function Initialize-WindowsSupervisorRuntime(
  [string]$Root,
  [string]$OwnerUserProfile,
  [bool]$BootCore
) {
  if ([string]::IsNullOrWhiteSpace($OwnerUserProfile)) { $OwnerUserProfile = $env:USERPROFILE }
  $OwnerUserProfile = [IO.Path]::GetFullPath($OwnerUserProfile)
  $local = Join-Path $OwnerUserProfile 'AppData\Local'
  $roaming = Join-Path $OwnerUserProfile 'AppData\Roaming'
  if ($BootCore) {
    $env:USERPROFILE = $OwnerUserProfile
    $env:LOCALAPPDATA = $local
    $env:APPDATA = $roaming
    $env:HOME = $OwnerUserProfile
  }
  return [pscustomobject]@{
    OwnerUserProfile=$OwnerUserProfile
    CredDir=(Join-Path $local 'ChatGPTRemoteCommander\credentials')
    ProfileDir=(Join-Path $roaming 'tunnel-client')
    InstanceRoot=(Join-Path $local 'ChatGPTRemoteCommander\instances')
  }
}

function Test-RcProfileName([string]$Name) {
  return ($Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -and $Name -notmatch '\.\.' -and $Name -notin @('.','..'))
}

function Get-RcProfileHealthPort([string]$ProfileFile) {
  $text=Get-Content -LiteralPath $ProfileFile -Raw
  $m=[regex]::Match($text,'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
  if($m.Success){return [int]$m.Groups[1].Value}
  return 0
}

function Get-RcProfileMcpPort([string]$ProfileFile) {
  $text=Get-Content -LiteralPath $ProfileFile -Raw
  $m=[regex]::Match($text,'url:\s*["'']?http://127\.0\.0\.1:(\d+)/mcp')
  if($m.Success){return [int]$m.Groups[1].Value}
  return 0
}

function Get-RcCredentialPath([string]$CredDir,[string]$Profile,[string]$CredentialScope) {
  $suffix=if($CredentialScope -eq 'LocalMachine'){'.machine.dpapi'}else{'.dpapi'}
  return Join-Path $CredDir ($Profile+$suffix)
}

function Read-RcCredentialPlainText([string]$Path,[string]$CredentialScope) {
  $raw=(Get-Content -LiteralPath $Path -Raw).Trim()
  if($CredentialScope -eq 'CurrentUser'){
    $secure=ConvertTo-SecureString $raw
    try{return [System.Net.NetworkCredential]::new('',$secure).Password}
    finally{$secure=$null}
  }
  $cipher=[Convert]::FromBase64String($raw)
  $clear=[Security.Cryptography.ProtectedData]::Unprotect(
    $cipher,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  try{return [Text.Encoding]::UTF8.GetString($clear)}
  finally{
    if($cipher){[Array]::Clear($cipher,0,$cipher.Length)}
    if($clear){[Array]::Clear($clear,0,$clear.Length)}
  }
}

function Test-RcCredential([string]$Path,[string]$CredentialScope) {
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $false}
  $plain=$null
  try{
    $plain=Read-RcCredentialPlainText $Path $CredentialScope
    return -not [string]::IsNullOrWhiteSpace($plain)
  }catch{return $false}
  finally{$plain=$null}
}
