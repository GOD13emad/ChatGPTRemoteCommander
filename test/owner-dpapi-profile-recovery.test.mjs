import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const script=path.resolve(here,'../packaging/unified/owner-dpapi-profile-recovery.ps1');
const pwsh=process.platform==='win32'?(process.env.ProgramFiles
  ?path.join(process.env.ProgramFiles,'PowerShell','7','pwsh.exe'):'pwsh.exe'):'pwsh';
function execute(appData,mode){
 const result=spawnSync(pwsh,['-NoLogo','-NoProfile','-NonInteractive',
   '-File',script,'-Mode',mode],{
   encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:8192,
   env:{...process.env,APPDATA:appData}
 });
 if(result.error)throw result.error;
 return result;
}
test('Windows owner DPAPI recovery capsule stages and verifies only encrypted owner-local fixtures, detects mutations',{
  skip:process.platform!=='win32',timeout:30000
},()=>{
 const owner=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-dpapi-qa-'));
 const profile=path.join(owner,'tunnel-client','chatgpt-remote-commander.yaml');
 const certDir=path.join(owner,'ChatGPTRemoteCommander','private-pair','default');
 const recovery=path.join(owner,'ChatGPTRemoteCommander','owner-recovery','rc012-native-pair-dpapi');
 const privateMarker='NONPRODUCTION_PLAINTEXT_FIXTURE_BEARER_ABC123';
 try{
   fs.mkdirSync(path.dirname(profile),{recursive:true});
   fs.mkdirSync(certDir,{recursive:true});
   fs.writeFileSync(profile,
    'config_version: 1\ncontrol_plane:\n  api_key: '+privateMarker+'\n');
   for(const f of ['ca.crt','client.crt','client.key','server.crt','server.key'])
     fs.writeFileSync(path.join(certDir,f),'NONPRODUCTION_CERT_FIXTURE_'+f+'\n');
   const source=fs.readFileSync(profile);
   const stage=execute(owner,'Stage');
   assert.equal(stage.status,0,stage.stderr?.slice(-900));
   assert.match(stage.stdout,/RC012_WINDOWS_OWNER_DPAPI_BACKUP_STAGE_PASS files=6/);
   assert.ok(!stage.stdout.includes(privateMarker));
   const sealed=fs.readFileSync(path.join(recovery,'owner-capsule.dpapi'));
   assert.ok(!sealed.includes(Buffer.from(privateMarker)));
   const receipt=fs.readFileSync(path.join(recovery,'receipt.json'),'utf8');
   assert.ok(!receipt.includes(privateMarker));
   const verified=execute(owner,'Verify');
   assert.equal(verified.status,0,verified.stderr?.slice(-900));
   assert.match(verified.stdout,/RC012_WINDOWS_OWNER_DPAPI_BACKUP_VERIFY_PASS files=6/);
   const simulated=execute(owner,'TestRestore');
   assert.equal(simulated.status,0,simulated.stderr?.slice(-900));
   assert.match(simulated.stdout,/RC012_WINDOWS_OWNER_DPAPI_RESTORE_SIMULATION_PASS files=6/);
   assert.equal(fs.readdirSync(path.dirname(recovery)).filter(x=>x.startsWith('.restore-test-')).length,0);
   assert.deepEqual(fs.readFileSync(profile),source);
   const again=execute(owner,'Stage');
   assert.equal(again.status,0);
   assert.match(again.stdout,/RC012_WINDOWS_OWNER_DPAPI_BACKUP_REUSED/);
   assert.deepEqual(fs.readFileSync(profile),source);
   fs.writeFileSync(profile,source.toString()+'# changed baseline\n');
   const changed=execute(owner,'Stage');
   assert.notEqual(changed.status,0);
   assert.match(changed.stderr,/RC012_DPAPI_EXISTING_BASELINE_CHANGED/);
   fs.writeFileSync(profile,source);
   const blob=path.join(recovery,'owner-capsule.dpapi');
   const tampered=fs.readFileSync(blob);
   tampered[0]^=0x01;
   fs.writeFileSync(blob,tampered);
   const rejected=execute(owner,'Verify');
   assert.notEqual(rejected.status,0);
   assert.match(rejected.stderr,/RC012_DPAPI_RECEIPT_INVALID/);
 }finally{
   fs.rmSync(owner,{recursive:true,force:true});
 }
});
