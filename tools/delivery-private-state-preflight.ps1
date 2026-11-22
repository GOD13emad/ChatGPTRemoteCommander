# Read-only, scoped Windows owner-private delivery admission preflight.
# Never repairs ACLs, follows symlinks, or reads delivery payloads.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $Directory,
  [Parameter(Mandatory = $true)][string] $Scope,
  [ValidateRange(1,10000)][int] $MaxArtifactFiles = 2000
)
$ErrorActionPreference = 'Stop'
$summary = [ordered]@{
  schema = 1
  kind = 'delivery-private-state-preflight'
  platform = 'windows'
  complete = $false
  eligible = $false
  checked = 0
  artifactFilesChecked = 0
  artifactScanLimit = $MaxArtifactFiles
  limitReached = $false
  missingRequired = 0
  reparsePoints = 0
  ownerMismatch = 0
  inheritedDirectoryAcl = 0
  broadAllow = 0
  inspectionErrors = 0
}
try {
  if ($Scope -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') { throw 'INVALID_SCOPE' }
  $root = [IO.Path]::GetFullPath($Directory)
  if (-not [IO.Path]::IsPathRooted($Directory) -or $root -ne $Directory -or $root.StartsWith('\\')) { throw 'INVALID_DIRECTORY' }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed = @($user, 'S-1-5-18', 'S-1-5-32-544')
  function Test-Item([string]$Item, [bool]$IsDirectory, [bool]$Required) {
    $isPresent = if ($IsDirectory) { [IO.Directory]::Exists($Item) } else { [IO.File]::Exists($Item) }
    if (-not $isPresent) {
      if ($Required) { $summary.missingRequired++ }
      return $false
    }
    try {
      $attr = [IO.File]::GetAttributes($Item)
      if (($attr -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $summary.reparsePoints++; return $false }
            # PowerShell 5.1 (.NET Framework) and PowerShell 7+ (.NET) expose
      # native ACL APIs through different types. Avoid cmdlet/module autoload.
      if ($PSVersionTable.PSEdition -eq 'Core') {
        $acl = if ($IsDirectory) {
          [System.IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]::new($Item))
        } else {
          [System.IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($Item))
        }
      } else {
        $acl = if ($IsDirectory) { [IO.Directory]::GetAccessControl($Item) } else { [IO.File]::GetAccessControl($Item) }
      }
      $summary.checked++
      if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $user) { $summary.ownerMismatch++ }
      if ($IsDirectory -and !$acl.AreAccessRulesProtected) { $summary.inheritedDirectoryAcl++ }
      foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $allowed -notcontains $rule.IdentityReference.Value) {
          $summary.broadAllow++
          break
        }
      }
    } catch { $summary.inspectionErrors++ }
    return $true
  }
  # Observation only; not authority for a cutover. Never list adjacent profiles.
  $cursor = $root
  while ($cursor -and $cursor -ne [IO.Path]::GetPathRoot($cursor)) {
    try {
      $attributes = [IO.File]::GetAttributes($cursor)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $summary.reparsePoints++; break }
    } catch { $summary.inspectionErrors++; break }
    $next = [IO.Directory]::GetParent($cursor)
    $cursor = if ($null -eq $next) { $null } else { $next.FullName }
  }
  [void](Test-Item $root $true $true)
  $db = [IO.Path]::Combine($root,'delivery.sqlite')
  [void](Test-Item $db $false $true)
  foreach ($suffix in @('-journal','-wal','-shm')) { [void](Test-Item ($db+$suffix) $false $false) }
  $artifacts = [IO.Path]::Combine($root,'artifacts')
  if (Test-Path -LiteralPath $artifacts) {
    [void](Test-Item $artifacts $true $true)
    $scoped = [IO.Path]::Combine($artifacts,$Scope)
    if (Test-Path -LiteralPath $scoped) {
      [void](Test-Item $scoped $true $true)
      try {
        $items = @(Get-ChildItem -LiteralPath $scoped -Force | Select-Object -First ($MaxArtifactFiles+1))
        if ($items.Count -gt $MaxArtifactFiles) { $summary.limitReached = $true }
        foreach ($entry in ($items | Select-Object -First $MaxArtifactFiles)) {
          if ($entry.PSIsContainer) { $summary.inspectionErrors++; continue }
          $summary.artifactFilesChecked++
          [void](Test-Item $entry.FullName $false $true)
        }
      } catch { $summary.inspectionErrors++ }
    }
  }
  $summary.complete = -not $summary.limitReached -and $summary.inspectionErrors -eq 0
  $summary.eligible = $summary.complete -and $summary.missingRequired -eq 0 -and $summary.reparsePoints -eq 0 -and
    $summary.ownerMismatch -eq 0 -and $summary.inheritedDirectoryAcl -eq 0 -and $summary.broadAllow -eq 0
} catch {
  $summary.inspectionErrors++
}
# Never emit file names, ACL entries, SIDs, credentials, or contents.
$summary | ConvertTo-Json -Compress
