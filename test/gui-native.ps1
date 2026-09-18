$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$helper=Join-Path $root 'tools\gui-control.ps1'
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile($helper,[ref]$null,[ref]$errors) | Out-Null
if($errors.Count) { throw 'GUI_HELPER_PARSE_FAILED' }
# Only compiles the helper and checks marshalling/key map. NO capture or input.
$raw=& pwsh.exe -NoLogo -NoProfile -NonInteractive -File $helper -SelfTest
if($LASTEXITCODE -ne 0) { throw 'GUI_NATIVE_SELFTEST_FAILED' }
$result=$raw | ConvertFrom-Json
if(-not $result.ok -or -not $result.nativeLayoutOnly -or $result.inputSize -notin @(28,40)) { throw 'GUI_NATIVE_LAYOUT_FAILED' }
Write-Output ('GUI_NATIVE_LAYOUT_PASS architecture={0} inputSize={1}' -f $result.architecture,$result.inputSize)
Write-Output 'GUI_INTERACTIVE_VALIDATION=NOT_RUN'
