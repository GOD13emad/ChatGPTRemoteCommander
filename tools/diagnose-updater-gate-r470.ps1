param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$ExpectedCommit
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($ExpectedCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'R470_EXPECTED_COMMIT_INVALID'}
$canonical=[IO.Path]::GetFullPath($Root)
if(!(Test-Path -LiteralPath $canonical -PathType Container)){throw 'R470_ROOT_MISSING'}
$out=Join-Path $canonical 'DIAGNOSTIC_R470.json'
if(Test-Path -LiteralPath $out){throw 'UNSAFE_RERUN_DIAGNOSTIC_ALREADY_EXISTS'}
$logRoot=Join-Path $canonical 'STATE\ChatGPTRemoteCommander\update-logs'
$failures=@()
$totals=@{}
$types=@()
$sourceSha=$null
$sourceBytes=0
$status='LOG_MISSING'
$count=0
$format='UNKNOWN'
$specSeen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
function Public-TestLabel([string]$Label){
  # Both Node TAP and spec reporters can include user-supplied test names.
  # Do not leak credentials or absolute file paths into an uploaded diagnostic.
  if($Label -match '(?i)bearer|password|secret|cookie|token|private.?key|authorization|api.?key|[A-Z]:[\\/]|(?:^|\s)/(?:home|Users|var|tmp|mnt|root)/'){
    return 'REDACTED_TEST_NAME'
  }
  $s=[regex]::Replace($Label,'[^A-Za-z0-9 _().:+\-]','?')
  if($s.Length -gt 112){return $s.Substring(0,112)}
  return $s
}
if(Test-Path -LiteralPath $logRoot -PathType Container){
  $rootAttributes=(Get-Item -LiteralPath $logRoot -Force).Attributes
  if(($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'R470_LOG_ROOT_REPARSE_REFUSED'}
  $prefix=$ExpectedCommit.Substring(0,12)
  $sources=@(Get-ChildItem -LiteralPath $logRoot -File -Filter "qualification-output-qualification-test-$prefix-*.stdout.log" -ErrorAction Stop)
  $count=$sources.Count
  if($count -eq 1){
    $source=$sources[0]
    if(($source.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'R470_LOG_REPARSE_REFUSED'}
    $sourceBytes=$source.Length
    if($sourceBytes -gt 8388608){$status='LOG_TOO_LARGE'}
    else {
      $sourceSha=(Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      # Node 24+ may emit the Unicode spec reporter by default, not '# pass'
      # and 'not ok' TAP records. Recognize BOTH, never infer an empty
      # failure list means a passing qualification.
      foreach($line in [IO.File]::ReadLines($source.FullName)){
        if($line -match '^\s*not ok\s+([0-9]+)\s+-\s+([^\r\n]+)$'){
          $format='TAP'
          $number=[int]$Matches[1]
          $label=Public-TestLabel ([string]$Matches[2])
          if($failures.Count -lt 24){$failures+=([pscustomobject]@{index=$number;publicTestName=$label})}
        } elseif($line -match '^\s*\u2716\s+(.+?)\s+\([0-9]+(?:\.[0-9]+)?ms\)\s*$'){
          $format='NODE_SPEC'
          $label=Public-TestLabel ([string]$Matches[1])
          # The spec reporter repeats the failing case after 'failing tests:'.
          if($specSeen.Add($label) -and $failures.Count -lt 24){
            $failures+=([pscustomobject]@{index=($failures.Count+1);publicTestName=$label})
          }
        } elseif($line -match '^\s*#\s*(tests|pass|fail|cancelled|skipped|todo|duration_ms)\s+([0-9]+(?:\.[0-9]+)?)\s*$') {
          $format='TAP'
          $totals[[string]$Matches[1]]=[string]$Matches[2]
        } elseif($line -match '^\s*\u2139\s+(tests|pass|fail|cancelled|skipped|todo|duration_ms)\s+([0-9]+(?:\.[0-9]+)?)\s*$'){
          $format='NODE_SPEC'
          $totals[[string]$Matches[1]]=[string]$Matches[2]
        } elseif($line -match 'failureType:.*?(testTimeoutFailure|assertionFailure|uncaughtException|testCodeFailure|hookFailed|subtestsFailed)'){
          if($types.Count -lt 20){$types+=([string]$Matches[1])}
        }
      }
      if($format -eq 'NODE_SPEC'){$status='NODE_SPEC_SUMMARY_EXTRACTED'}
      elseif($format -eq 'TAP'){$status='TAP_SUMMARY_EXTRACTED'}
      else{$status='FORMAT_UNRECOGNIZED'}
    }
  } elseif($count -gt 1) {$status='AMBIGUOUS_MULTIPLE_MATCHING_LOGS'}
}
$report=[ordered]@{
  schema=1;revision='R470';status=$status;commit=$ExpectedCommit
  scope='READ_ONLY_HOSTED_NOPROMOTE_QUALIFICATION_FAILURE'
  matchingLogCount=$count;sourceBytes=$sourceBytes;sourceSha256=$sourceSha
  failureTests=$failures;failureTypes=$types;tapCounts=$totals;reporterFormat=$format
  rawLogIncluded=$false;secretsIncluded=$false;absolutePathsIncluded=$false
  stablePromoted=$false;historicalFailureJob=115292112191
}
[IO.File]::WriteAllText($out,($report|ConvertTo-Json -Depth 9),[Text.UTF8Encoding]::new($false))
Write-Output ('R470_DIAG_RESULT='+$status+' failureTests='+$failures.Count+' sourceBytes='+$sourceBytes)
Write-Output ('R470_DIAG_SHA256='+(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash)
