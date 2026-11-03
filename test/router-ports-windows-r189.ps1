#requires -Version 7.0
param([switch]$SelfTest)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# Exact Router state contract: active is mandatory; previous may be ABSENT, null
# (initial/retired route), or an old active object. StrictMode forbids missing
# PSCustomObject members. Never directly access .previous.port.
function Get-RouterPortsR189 {
  param([Parameter(Mandatory=$true)][object]$State)
  if(-not ($State -is [System.Collections.IDictionary]) -or -not $State.Contains('active')) {
    throw 'R189_MANDATORY_ROUTER_ACTIVE_MISSING'
  }
  $active=$State['active']
  if(-not ($active -is [System.Collections.IDictionary]) -or -not $active.Contains('port')){
    throw 'R189_MANDATORY_ACTIVE_PORT_MISSING'
  }
  $port=$active['port']
  if(($port -isnot [int] -and $port -isnot [long]) -or [long]$port -lt 1 -or [long]$port -gt 65535){
    throw 'R189_ACTIVE_PORT_INVALID'
  }
  Write-Output ([int]$port)
  if($State.Contains('previous') -and $null -ne $State['previous']){
    $old=$State['previous']
    if(-not ($old -is [System.Collections.IDictionary]) -or -not $old.Contains('port')){
      throw 'R189_PREVIOUS_ROUTE_SHAPE_INVALID'
    }
    $oldPort=$old['port']
    if(($oldPort -isnot [int] -and $oldPort -isnot [long]) -or [long]$oldPort -lt 1 -or [long]$oldPort -gt 65535){
      throw 'R189_PREVIOUS_PORT_INVALID'
    }
    Write-Output ([int]$oldPort)
  }
}

if($SelfTest){
  $fixtures=@(
   @{name='MISSING_PREVIOUS';json='{"schema":1,"profile":"default","generation":1,"active":{"port":48831}}';want='48831'},
   @{name='NULL_PREVIOUS';json='{"schema":1,"profile":"default","generation":3,"active":{"port":48832},"previous":null}';want='48832'},
   @{name='VALID_PREVIOUS';json='{"schema":1,"profile":"default","generation":2,"active":{"port":48832},"previous":{"port":48831}}';want='48832,48831'},
   @{name='BAD_PREVIOUS_OBJECT';json='{"active":{"port":48831},"previous":{}}';reject=$true},
   @{name='BAD_PREVIOUS_STRING';json='{"active":{"port":48831},"previous":"wrong"}';reject=$true},
   @{name='MISSING_ACTIVE';json='{"previous":null}';reject=$true},
   @{name='INVALID_ACTIVE_PORT';json='{"active":{"port":0}}';reject=$true},
   @{name='INVALID_PREVIOUS_PORT';json='{"active":{"port":48831},"previous":{"port":"48832"}}';reject=$true}
  )
  foreach($f in $fixtures){
    $state=$f['json']|ConvertFrom-Json -AsHashtable
    $actual=''
    $bad=$false
    try{$actual=(@(Get-RouterPortsR189 -State $state) -join ',')}catch{$bad=$true}
    $expectedFailure=$f.Contains('reject') -and $f['reject'] -eq $true
    if($expectedFailure){if(-not $bad){throw ('R189_NEGATIVE_FIXTURE_DID_NOT_REJECT_'+$f['name'])}}
    elseif($bad -or $actual -cne $f['want']){throw ('R189_POSITIVE_FIXTURE_DID_NOT_PASS_'+$f['name'])}
    Write-Output ('R189_SCHEMA_'+$f['name']+'_PASS')
  }
  Write-Output 'R189_ALL_8_PURE_ROUTER_SCHEMA_FIXTURES_PASS'
}
