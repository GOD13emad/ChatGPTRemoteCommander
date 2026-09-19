param(
  [switch]$IncludeHistory = $true
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$patterns = [ordered]@{
  'OpenAI-style secret key' = ('s' + 'k-' + '[A-Za-z0-9_-]{20,}')
  'Tunnel identifier' = ('tunnel' + '_' + '[A-Za-z0-9_-]{16,}')
  'Private key block' = ('-----BEGIN ' + '(?:RSA |EC |OPENSSH )?' + 'PRIVATE KEY-----')
  'Bearer token literal' = ('Bearer\s+' + '[A-Za-z0-9._-]{20,}')
  'GitHub token' = ('gh' + '[opsu]_' + '[A-Za-z0-9]{20,}')
}
$findings = @()
$tracked = @(git ls-files)

foreach ($file in $tracked) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
  try { $text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $file)) } catch { continue }
  foreach ($entry in $patterns.GetEnumerator()) {
    $options = if ($entry.Key -eq 'Tunnel identifier') { [Text.RegularExpressions.RegexOptions]::None } else { [Text.RegularExpressions.RegexOptions]::IgnoreCase }
    if ([regex]::IsMatch($text, $entry.Value, $options)) {
      $findings += [pscustomobject]@{ Scope='CURRENT'; Type=$entry.Key; Location=$file }
    }
  }
}
$forbiddenTracked = @('config.local.json', '.env')
foreach ($file in $forbiddenTracked) {
  git ls-files --error-unmatch $file *> $null
  if ($LASTEXITCODE -eq 0) {
    $findings += [pscustomobject]@{ Scope='CURRENT'; Type='Forbidden tracked file'; Location=$file }
  }
}

$localUser = [regex]::Escape($env:USERNAME)
$personalPathPattern = 'C:\\Users\\' + $localUser + '\\'
foreach ($file in $tracked) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
  try { $text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $file)) } catch { continue }
  if ([regex]::IsMatch($text, $personalPathPattern, 'IgnoreCase')) {
    $findings += [pscustomobject]@{ Scope='CURRENT'; Type='Personal absolute path'; Location=$file }
  }
}

if ($IncludeHistory) {
  foreach ($entry in $patterns.GetEnumerator()) {
    $hits = @(git grep -I -l -E $entry.Value $(git rev-list --all) 2>$null)
    foreach ($hit in $hits) {
      $location = ($hit -split ':', 2)[1]
      $findings += [pscustomobject]@{ Scope='HISTORY'; Type=$entry.Key; Location=$location }
    }
  }
}
$ignoredChecks = @(
  'config.local.json',
  'var/audit.jsonl',
  'test/.tmp-audit.jsonl'
)
$ignoreFailures = @()
foreach ($file in $ignoredChecks) {
  git check-ignore -q -- $file
  if ($LASTEXITCODE -ne 0) { $ignoreFailures += $file }
}
foreach ($file in $ignoreFailures) {
  $findings += [pscustomobject]@{ Scope='CURRENT'; Type='Expected ignore missing'; Location=$file }
}

$emails = @(git log --all --format='%ae%n%ce' | Where-Object { $_ } | Sort-Object -Unique)
if ($emails.Count -gt 0) {
  'COMMIT_EMAILS (public metadata, not credentials):'
  $emails | ForEach-Object { "  $_" }
}

if ($findings.Count -gt 0) {
  'SECURITY_AUDIT_FAIL'
  $findings | Sort-Object Scope,Type,Location -Unique | Format-Table -AutoSize
  exit 1
}

'SECURITY_AUDIT_PASS'
'No secret-key, tunnel-id, private-key, bearer-token, tracked local-config, or personal-path finding detected.'
