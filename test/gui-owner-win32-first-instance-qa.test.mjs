import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./gui-owner-win32-first-instance-qa.ps1',import.meta.url));
const run=(args=[])=>spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-File',script,...args],{
  encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:32768
});
const win={skip:process.platform!=='win32'};
test('actual kernel: native first-instance gate + OS DACL applied, still denies native GUI', {...win,timeout:18000},()=>{
 const p=run();assert.equal(p.status,0,p.stderr);
 const x=JSON.parse(p.stdout.trim());
 assert.equal(x.status,'PASS');
 assert.equal(x.appliedAceCount,2);
 assert.equal(x.configuredSidsDistinct,true);
 assert.equal(x.clientConnected,false);
 assert.equal(x.clientInstanceRightsDenied,true);
 assert.equal(x.clientAdminRightsDenied,true);
 assert.equal(x.firstInstanceDuplicateError,5);
 assert.equal(x.firstInstanceFlagAppliedAtCreation,true);
 assert.equal(x.remoteRejectRequestedAtCreation,true);
 assert.equal(x.remoteRejectionBehaviorUntested,true);
 assert.equal(x.ownerAuthenticated,false);
 assert.equal(x.releaseAuthorized,false);
 assert.equal(x.nativeOutcome,'UNKNOWN');
});
for(const [name,args,expected] of [
 ['Everyone', ['-ClientSid','S-1-1-0'], 'BROAD_OR_ANONYMOUS_CLIENT_REJECTED'],
 ['Authenticated Users', ['-ClientSid','S-1-5-11'], 'BROAD_OR_ANONYMOUS_CLIENT_REJECTED'],
 ['Builtin Users', ['-ClientSid','S-1-5-32-545'], 'BROAD_OR_ANONYMOUS_CLIENT_REJECTED'],
 ['Anonymous', ['-ClientSid','S-1-5-7'], 'BROAD_OR_ANONYMOUS_CLIENT_REJECTED'],
 ['invalid SID', ['-ClientSid','imposter-SYSTEM'], 'INVALID_CLIENT_SID'],
 ['client full control', ['-UnsafeClientRights'], 'CLIENT_INSTANCE_OR_ADMIN_RIGHTS_REJECTED']
]){
 test('native DACL policy rejects '+name,{...win,timeout:15000},()=>{
  const p=run(args);
  assert.notEqual(p.status,0,'insecure candidate accepted');
  assert.match(p.stderr,new RegExp(expected));
  assert.equal(p.stdout.includes('"releaseAuthorized":true'),false);
 });
}
test('current OS principal cannot also be client principal',{...win,timeout:15000},()=>{
 const who=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{
   encoding:'utf8',windowsHide:true,timeout:6000});
 assert.equal(who.status,0,who.stderr);
 const p=run(['-ClientSid',who.stdout.trim()]);
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/SAME_OS_PRINCIPAL_REJECTED/);
});
