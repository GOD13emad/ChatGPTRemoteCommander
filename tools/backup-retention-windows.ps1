param(
  [string]$Base = (Join-Path $env:USERPROFILE '.chatgpt-remote-commander'),
  [ValidateRange(1,720)][int]$OpenCutoffHours = 48,
  [ValidateRange(16,10000)][int]$MaxOpenSnapshots = 512,
  [ValidateRange(1,1000)][int]$MinOpenSnapshots = 16,
  [ValidateRange(1048576,1099511627776)][long]$MaxOpenBytes = 8589934592,
  [ValidateRange(2,10000)][int]$MinArchives = 14,
  [ValidateRange(14,10000)][int]$MaxArchives = 180,
  [ValidateRange(1048576,1099511627776)][long]$MaxArchiveBytes = 8589934592,
  [ValidateRange(7,3650)][int]$MaxArchiveAgeDays = 120,
  [switch]$ReportOnly
)
$ErrorActionPreference='Stop'
$Base=[IO.Path]::GetFullPath($Base)
$backup=Join-Path $Base 'backups'
$archive=Join-Path $Base 'backup-archives'
$maint=Join-Path $Base 'maintenance'
New-Item -ItemType Directory -Force -Path $backup,$archive,$maint|Out-Null
$lock=Join-Path $maint 'backup-retention.lock'
$lockHandle=$null
function Dir-Bytes([IO.DirectoryInfo]$Dir){
  [long]$sum=0
  Get-ChildItem -LiteralPath $Dir.FullName -File -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {$sum += [long]$_.Length}
  return $sum
}
function Verified-Archive([IO.FileInfo]$File){
  $shaFile=$File.FullName+'.sha256'
  $jsonFile=$File.FullName+'.json'
  if(!(Test-Path -LiteralPath $shaFile -PathType Leaf) -or !(Test-Path -LiteralPath $jsonFile -PathType Leaf)){
    return [pscustomobject]@{ok=$false;reason='SIDECAR_MISSING'}
  }
  try{
    $expected=((Get-Content -LiteralPath $shaFile -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    if($expected -notmatch '^[a-f0-9]{64}$'){return [pscustomobject]@{ok=$false;reason='SHA_FORMAT'}}
    $actual=(Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if($actual-ne$expected){return [pscustomobject]@{ok=$false;reason='SHA_MISMATCH'}}
    $manifest=Get-Content -LiteralPath $jsonFile -Raw|ConvertFrom-Json
    if([string]$manifest.sha256-ne$expected){return [pscustomobject]@{ok=$false;reason='MANIFEST_SHA_MISMATCH'}}
    if([IO.Path]::GetFileName([string]$manifest.archive)-ne$File.Name){return [pscustomobject]@{ok=$false;reason='MANIFEST_ARCHIVE_MISMATCH'}}
    return [pscustomobject]@{ok=$true;reason='VERIFIED';sha256=$expected}
  }catch{return [pscustomobject]@{ok=$false;reason=('VERIFY_ERROR:'+($_.Exception.Message))}}
}
try {
  try {$lockHandle=[IO.File]::Open($lock,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)}catch{
    [pscustomobject]@{schema=2;at=(Get-Date).ToUniversalTime().ToString('o');status='LOCKED'}|ConvertTo-Json -Compress
    exit 0
  }
  $now=(Get-Date).ToUniversalTime()
  $cut=$now.AddHours(-$OpenCutoffHours)
  $dirs=@(Get-ChildItem -LiteralPath $backup -Directory -Force -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc)
  $meta=@($dirs|ForEach-Object{[pscustomobject]@{dir=$_;bytes=(Dir-Bytes $_);old=($_.LastWriteTimeUtc-lt$cut)}})
  [long]$openBytes=($meta|Measure-Object -Property bytes -Sum).Sum
  $selected=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($m in $meta){if($m.old){[void]$selected.Add($m.dir.FullName)}}
  [long]$remainingBytes=$openBytes-([long](($meta|Where-Object{$selected.Contains($_.dir.FullName)}|Measure-Object -Property bytes -Sum).Sum))
  $remainingCount=$meta.Count-$selected.Count
  foreach($m in $meta){
    if($selected.Contains($m.dir.FullName)){continue}
    if($remainingCount-le$MaxOpenSnapshots -and $remainingBytes-le$MaxOpenBytes){break}
    if($remainingCount-le$MinOpenSnapshots){break}
    [void]$selected.Add($m.dir.FullName)
    $remainingCount--; $remainingBytes-=[long]$m.bytes
  }
  $candidates=@($meta|Where-Object{$selected.Contains($_.dir.FullName)})
  $archived=@();$archiveErrors=@()
  if(-not $ReportOnly){
    $groups=@($candidates|Group-Object{$_.dir.LastWriteTimeUtc.ToString('yyyy-MM-dd')})
    $runStamp=$now.ToString('yyyyMMddTHHmmssZ')
    foreach($g in $groups){
      $day=$g.Name
      $final=Join-Path $archive "$day-part-$runStamp.tar.gz"
      $tmp="$final.tmp";$list="$final.list.txt"
      @($g.Group|ForEach-Object{$_.dir.Name})|Set-Content -Encoding utf8 $list
      try{
        Push-Location $backup
        try{
          & tar.exe -czf $tmp -T $list
          if($LASTEXITCODE-ne0 -or !(Test-Path -LiteralPath $tmp) -or (Get-Item -LiteralPath $tmp).Length-le0){throw "ARCHIVE_CREATE_FAILED:$day"}
          & tar.exe -tzf $tmp *> $null
          if($LASTEXITCODE-ne0){throw "ARCHIVE_VERIFY_FAILED:$day"}
        }finally{Pop-Location}
        Move-Item -LiteralPath $tmp -Destination $final -Force
        $hash=(Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $([IO.Path]::GetFileName($final))"|Set-Content -Encoding ascii "$final.sha256"
        [long]$sourceBytes=($g.Group|Measure-Object -Property bytes -Sum).Sum
        $manifest=[ordered]@{schema=2;createdAt=$now.ToString('o');day=$day;sourceCount=$g.Count;sourceBytes=$sourceBytes;archive=$final;sha256=$hash;sourceNames=@($g.Group|ForEach-Object{$_.dir.Name})}
        $manifest|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8 "$final.json"
        $verified=Verified-Archive (Get-Item -LiteralPath $final)
        if(-not $verified.ok){throw "ARCHIVE_POSTVERIFY_FAILED:$($verified.reason)"}
        foreach($m in $g.Group){Remove-Item -LiteralPath $m.dir.FullName -Recurse -Force}
        Remove-Item -LiteralPath $list -Force -ErrorAction SilentlyContinue
        $archived += [pscustomobject]@{day=$day;sourceCount=$g.Count;sourceBytes=$sourceBytes;archiveBytes=(Get-Item -LiteralPath $final).Length;sha256=$hash}
      }catch{
        $archiveErrors += [pscustomobject]@{day=$day;error=$_.Exception.Message}
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      }
    }
  }
  $archives=@(Get-ChildItem -LiteralPath $archive -Filter '*.tar.gz' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc)
  [long]$archiveBytes=($archives|Measure-Object -Property Length -Sum).Sum
  $deleted=@();$gcDeferred=@();$ageCut=$now.AddDays(-$MaxArchiveAgeDays)
  foreach($file in @($archives)){
    $currentCount=$archives.Count-$deleted.Count
    if($currentCount-le$MinArchives){break}
    $needAge=$file.LastWriteTimeUtc-lt$ageCut
    $needCount=$currentCount-gt$MaxArchives
    $needBytes=$archiveBytes-gt$MaxArchiveBytes
    if(-not($needAge-or$needCount-or$needBytes)){continue}
    $verify=Verified-Archive $file
    if(-not $verify.ok){$gcDeferred += [pscustomobject]@{archive=$file.Name;reason=$verify.reason};continue}
    if($ReportOnly){$deleted += [pscustomobject]@{archive=$file.Name;bytes=$file.Length;reason='REPORT_ONLY_CANDIDATE'};$archiveBytes-=$file.Length;continue}
    foreach($sidecar in @($file.FullName,$file.FullName+'.sha256',$file.FullName+'.json',$file.FullName+'.list.txt')){
      Remove-Item -LiteralPath $sidecar -Force -ErrorAction SilentlyContinue
    }
    $deleted += [pscustomobject]@{archive=$file.Name;bytes=$file.Length;reason=if($needAge){'AGE'}elseif($needCount){'COUNT'}else{'BYTES'}}
    $archiveBytes-=$file.Length
  }
  $remainingDirs=@(Get-ChildItem -LiteralPath $backup -Directory -Force -ErrorAction SilentlyContinue)
  [long]$remainingOpenBytes=0
  foreach($d in $remainingDirs){$remainingOpenBytes += Dir-Bytes $d}
  $finalArchives=@(Get-ChildItem -LiteralPath $archive -Filter '*.tar.gz' -File -ErrorAction SilentlyContinue)
  [long]$finalArchiveBytes=($finalArchives|Measure-Object -Property Length -Sum).Sum
  $entry=[ordered]@{
    schema=2;at=$now.ToString('o');status=if($archiveErrors.Count){'PARTIAL'}else{'PASS'};reportOnly=[bool]$ReportOnly;
    policy=[ordered]@{openCutoffHours=$OpenCutoffHours;maxOpenSnapshots=$MaxOpenSnapshots;minOpenSnapshots=$MinOpenSnapshots;maxOpenBytes=$MaxOpenBytes;minArchives=$MinArchives;maxArchives=$MaxArchives;maxArchiveBytes=$MaxArchiveBytes;maxArchiveAgeDays=$MaxArchiveAgeDays};
    before=[ordered]@{openCount=$meta.Count;openBytes=$openBytes};
    selectedOpenCount=$candidates.Count;archived=$archived;archiveErrors=$archiveErrors;
    archiveGc=$deleted;archiveGcDeferred=$gcDeferred;
    after=[ordered]@{openCount=$remainingDirs.Count;openBytes=$remainingOpenBytes;archiveCount=$finalArchives.Count;archiveBytes=$finalArchiveBytes}
  }
  $line=$entry|ConvertTo-Json -Depth 8 -Compress
  if(-not $ReportOnly){$line|Add-Content -Encoding utf8 (Join-Path $maint 'backup-retention.jsonl')}
  $line
} finally {
  if($lockHandle){$lockHandle.Dispose()}
  Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
}
