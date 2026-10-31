#requires -Version 7.0
[CmdletBinding()]
param(
 [ValidateSet('Plan','Install','Status')][string]$Mode='Plan',
 [ValidateSet('Chrome','Brave')][string]$Browser='Brave',
 [string]$ExtensionId='',
 [string]$LauncherBuildDir='',
 [string]$NodePath='',
 [string]$HostScriptPath='',
 [string]$ExpectedLauncherSha256='',
 [string]$ExpectedHostScriptSha256=''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $IsWindows){throw 'V2_NATIVE_WINDOWS_ONLY'}
$hostName='com.chatgpt_remote_commander.v2'
$browserRegistry=if($Browser -eq 'Brave'){'BraveSoftware\Brave-Browser'}else{'Google\Chrome'}
$key='HKCU:\SOFTWARE\'+$browserRegistry+'\NativeMessagingHosts\'+$hostName
$target=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommanderV2\NativeMessaging'
$manifestPath=Join-Path $target ($hostName+'.json')
$configPath=Join-Path $target 'native-host-config.json'
$installedExe=Join-Path $target 'RCV2.NativeHost.exe'
function BoundedPath([string]$p,[string]$extension){
 if([string]::IsNullOrWhiteSpace($p) -or $p.Length -gt 2048 -or -not[IO.Path]::IsPathFullyQualified($p)){
  throw 'V2_NATIVE_INSTALL_PATH_INVALID'
 }
 $full=[IO.Path]::GetFullPath($p)
 if(-not $full.EndsWith($extension,[StringComparison]::OrdinalIgnoreCase) -or
    -not(Test-Path -LiteralPath $full -PathType Leaf) -or
    ((Get-Item -LiteralPath $full -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){
  throw 'V2_NATIVE_INSTALL_INPUT_INVALID'
 }
 return $full
}
if($Mode -eq 'Status'){
 $registered=if(Test-Path -LiteralPath $key){(Get-Item -LiteralPath $key).GetValue('')}else{$null}
 [pscustomobject]@{schema=1;browser=$Browser;registered=($registered -ceq $manifestPath);
  exactManifest=($registered -ceq $manifestPath);ownerUser=[Security.Principal.WindowsIdentity]::GetCurrent().Name;
  liveChatAuthorized=$false;nativeBrowserPromptVerified=$false;toolDispatchEnabled=$false}|
  ConvertTo-Json -Compress
 exit 0
}
if($ExtensionId -cnotmatch '^[a-p]{32}$'){throw 'V2_NATIVE_EXACT_EXTENSION_ID_REQUIRED'}
$origin='chrome-extension://'+$ExtensionId+'/'
if(-not $LauncherBuildDir){throw 'V2_NATIVE_LAUNCHER_BUILD_REQUIRED'}
$sourceDir=[IO.Path]::GetFullPath($LauncherBuildDir)
if(-not[IO.Path]::IsPathFullyQualified($LauncherBuildDir)){throw 'V2_NATIVE_LAUNCHER_PATH_REQUIRED'}
$files=@('RCV2.NativeHost.exe') # publish -r win-x64 --self-contained false -p:PublishSingleFile=true
foreach($file in $files){$null=BoundedPath (Join-Path $sourceDir $file) ([IO.Path]::GetExtension($file))}
$node=BoundedPath $NodePath '.exe'
$hostScript=BoundedPath $HostScriptPath '.mjs'
$canonicalHost=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'v2-native-messaging-host.mjs'))
if($hostScript -cne $canonicalHost){throw 'V2_NATIVE_CANONICAL_HOST_REQUIRED'}
if($Mode -eq 'Install'){
 if($ExpectedLauncherSha256 -cnotmatch '^[A-Fa-f0-9]{64}$' -or
    $ExpectedHostScriptSha256 -cnotmatch '^[A-Fa-f0-9]{64}$'){
  throw 'V2_NATIVE_PINNED_ARTIFACT_HASH_REQUIRED'
 }
 $exeSha=(Get-FileHash -LiteralPath (Join-Path $sourceDir 'RCV2.NativeHost.exe') -Algorithm SHA256).Hash
 $hostSha=(Get-FileHash -LiteralPath $hostScript -Algorithm SHA256).Hash
 if($exeSha -cne $ExpectedLauncherSha256.ToUpperInvariant() -or
    $hostSha -cne $ExpectedHostScriptSha256.ToUpperInvariant()){
  throw 'V2_NATIVE_INSTALL_ARTIFACT_HASH_MISMATCH'
 }
}
$layout=@{
 schema=1;origin=$origin;nodePath=$node;hostScriptPath=$hostScript
}
$manifest=@{
 name=$hostName;description='Commander V2 owner preflight';
 path=$installedExe;type='stdio';allowed_origins=@($origin)
}
if($Mode -eq 'Plan'){
 [pscustomobject]@{
  schema=1;mode='Plan';browser=$Browser;origin=$origin;
  destination=$target;registryKey=$key;files=$files;privilege='OWNER_HKCU_ONLY';
  nativeOwnerConsentRequired=$true;oauthChatGrantRequired=$true;
  mutationPerformed=$false;liveBrowserConnected=$false
 }|ConvertTo-Json -Compress
 exit 0
}
# Only an interactive owner-local process may register this host under HKCU.
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.IsSystem -or $identity.Name -match '^NT AUTHORITY\\'){
 throw 'V2_NATIVE_OWNER_CONTEXT_REQUIRED'
}
if($env:USERNAME -and ($identity.Name.Split('\\')[-1] -ine $env:USERNAME)){
 throw 'V2_NATIVE_OWNER_CONTEXT_MISMATCH'
}
# This installer will never replace a pre-existing registration or files.
if(Test-Path -LiteralPath $key){throw 'V2_NATIVE_HOST_REGISTRY_ALREADY_REGISTERED'}
if(Test-Path -LiteralPath $target){
 if(@(Get-ChildItem -LiteralPath $target -Force).Count -gt 0){
  throw 'V2_NATIVE_EXISTING_INSTALL_RECONCILIATION_REQUIRED'
 }
}
# Stage exact bytes under a V2-only owner-local root and atomically rename.
$parent=Split-Path -Parent $target
New-Item -ItemType Directory -Path $parent -Force|Out-Null
$stage=Join-Path $parent ('NativeMessaging.stage-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -ErrorAction Stop|Out-Null
try{
 foreach($file in $files){
  Copy-Item -LiteralPath (Join-Path $sourceDir $file) -Destination (Join-Path $stage $file) -ErrorAction Stop
 }
 [IO.File]::WriteAllText((Join-Path $stage 'native-host-config.json'),
  (ConvertTo-Json $layout -Depth 4 -Compress)+'\n',[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText((Join-Path $stage ($hostName+'.json')),
  (ConvertTo-Json $manifest -Depth 4 -Compress)+'\n',[Text.UTF8Encoding]::new($false))
 if(Test-Path -LiteralPath $target){throw 'V2_NATIVE_INSTALL_RACE'}
 Move-Item -LiteralPath $stage -Destination $target -ErrorAction Stop
 $stage=$null
}catch{
 if($stage -and (Test-Path -LiteralPath $stage)){
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
 }
 throw
}
if(Test-Path -LiteralPath $key){throw 'V2_NATIVE_REGISTRY_RACE'}
New-Item -Path $key -ErrorAction Stop|Out-Null
Set-Item -Path $key -Value $manifestPath
$readback=(Get-Item -LiteralPath $key).GetValue('')
if($readback -cne $manifestPath){throw 'V2_NATIVE_REGISTRY_READBACK_FAILED'}
$check=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
if($check.allowed_origins.Count -ne 1 -or $check.allowed_origins[0] -cne $origin -or
   $check.path -cne $installedExe){throw 'V2_NATIVE_MANIFEST_READBACK_FAILED'}
[pscustomobject]@{
 schema=1;mode='Install';browser=$Browser;registered=$true;exactOriginOnly=$true;
 nativeHostTransportInstalled=$true;browserExtensionInstalled=$false;
 nativeBrowserPromptVerified=$false;oauthChatGrantVerified=$false;toolDispatchEnabled=$false
}|ConvertTo-Json -Compress
