import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const code=fs.readFileSync('tools/owner-gui-native-readiness.ps1','utf8');
const start=code.indexOf('function Test-OwnerWorkerIdentity {');
const end=code.indexOf('$workerCount=0',start);
assert.ok(start>=0&&end>start);
const fn=code.slice(start,end);

test('SID identity must be verified before native readiness',()=>{
 for(const v of ['ownerWorkerIdentityVerified=$workerSidVerified','GetOwnerSid',
  'OWNER_WORKER_IDENTITY_UNVERIFIED','-ceq $ExpectedSid','-ne 1']){
   assert.ok(code.includes(v),v);
 }
 for(const bad of ['Start-Process','SendInput','SendKeys','Remove-Item','Set-Content']){
   assert.ok(!code.includes(bad),bad);
 }
});

test('native Windows rejects wrong SID, session, duplicate process and lookup failure',t=>{
 if(process.platform!=='win32'){t.skip('native Windows only');return}
 const p=[
   "$ErrorActionPreference='Stop'",
   fn,
   "$me='S-1-5-21-111-222-333-1001'",
   "$p=[pscustomobject]@{SessionId=1;Name='node.exe';CommandLine='node.exe src/server-v0.3.mjs'}",
   "$good={param($worker) $me}",
   "$bad={param($worker) 'S-1-5-21-111-222-333-1002'}",
   "$no={param($worker) $null}",
   "if(-not(Test-OwnerWorkerIdentity -Processes @($p) -ExpectedSession 1 -ExpectedSid $me -OwnerSidLookup $good)){throw 'VALID_MATCH_REJECTED'}",
   "if(Test-OwnerWorkerIdentity -Processes @($p) -ExpectedSession 1 -ExpectedSid $me -OwnerSidLookup $bad){throw 'FOREIGN_SID_GRANTED'}",
   "if(Test-OwnerWorkerIdentity -Processes @($p) -ExpectedSession 1 -ExpectedSid $me -OwnerSidLookup $no){throw 'UNRESOLVED_SID_GRANTED'}",
   "if(Test-OwnerWorkerIdentity -Processes @($p) -ExpectedSession 0 -ExpectedSid $me -OwnerSidLookup $good){throw 'SESSION0_GRANTED'}",
   "if(Test-OwnerWorkerIdentity -Processes @($p) -ExpectedSession 2 -ExpectedSid $me -OwnerSidLookup $good){throw 'OTHER_SESSION_GRANTED'}",
   "if(Test-OwnerWorkerIdentity -Processes @($p,$p) -ExpectedSession 1 -ExpectedSid $me -OwnerSidLookup $good){throw 'AMBIGUOUS_WORKERS_GRANTED'}",
   "if(Test-OwnerWorkerIdentity -Processes @() -ExpectedSession 1 -ExpectedSid $me -OwnerSidLookup $good){throw 'MISSING_WORKER_GRANTED'}",
   "$wrong=[pscustomobject]@{SessionId=1;Name='pwsh.exe';CommandLine='node.exe src/server-v0.3.mjs'}",
   "if(Test-OwnerWorkerIdentity -Processes @($wrong) -ExpectedSession 1 -ExpectedSid $me -OwnerSidLookup $good){throw 'OTHER_PROCESS_GRANTED'}",
   "$throws={param($worker) throw 'synthetic owner SID query error'}",
   "if(Test-OwnerWorkerIdentity -Processes @($p) -ExpectedSession 1 -ExpectedSid $me -OwnerSidLookup $throws){throw 'SID_LOOKUP_ERROR_GRANTED'}",
   "'NATIVE_OWNER_SID_SCOPING_FAIL_CLOSED_PASS'"
 ].join('\n');
 const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',p],{
   encoding:'utf8',windowsHide:true,timeout:18000});
 assert.equal(r.status,0,(r.stdout??'')+(r.stderr??''));
 assert.match(r.stdout,/NATIVE_OWNER_SID_SCOPING_FAIL_CLOSED_PASS/);
});

test('Control Center displays an unverified owner worker as a blocked diagnostic',()=>{
 const c=fs.readFileSync('desktop/RemoteCommanderDashboard/Program.cs','utf8');
 assert.ok(c.includes('"OWNER_WORKER_IDENTITY_UNVERIFIED"'));
 assert.ok(c.includes('does not match'));
 assert.ok(c.includes('takeoverAuthorized'));
 assert.ok(c.includes('NOT_AUTHORIZED'));
});
