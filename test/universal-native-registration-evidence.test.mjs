import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectNativeRegistration}
 from '../tools/universal-install/native-registration-evidence.mjs';
import {NATIVE_LINUX_PACKAGE,NATIVE_WINDOWS_UNINSTALL_KEY}
 from '../tools/universal-install/native-os-adapters.mjs';

const H='d'.repeat(64);
const validWin={present:true,version:'0.12.0-dev.9',
 uninstallerPresent:true,executablePresent:true,pathSafety:true,
 registrationFieldsMatch:true,uninstallerSha256:H};

test('Windows HKCU NSIS registration observes fixed per-user uninstaller, never treats it as full restore',()=>{
 const events=[];
 const run=(bin,args)=>{
  assert.equal(bin,'pwsh');events.push({bin,args});
  const ps=Buffer.from(args.at(-1),'base64').toString('utf16le');
  assert.match(ps,new RegExp(NATIVE_WINDOWS_UNINSTALL_KEY));
  assert.match(ps,/Uninstall Remote Commander\.exe/);
  assert.match(ps,/QuietUninstallString/);
  assert.match(ps,/Get-FileHash/);
  assert.doesNotMatch(ps,/Start-Process|Remove-Item|Set-ItemProperty|New-ItemProperty|runas/i);
  return {code:0,stdout:JSON.stringify(validWin),stderr:''};
 };
 const v=inspectNativeRegistration({platform:'windows',run});
 assert.equal(v.status,'REGISTRATION_OBSERVED');
 assert.equal(v.registeredVersion,'0.12.0-dev.9');
 assert.equal(v.uninstallerSha256,H);
 assert.equal(v.registrationStructureConsistent,true);
 assert.equal(v.fullRestoreVerified,false);
 assert.equal(v.publisherIdentityVerified,false);
 assert.equal(v.ownerRecoveryVerified,false);
 assert.equal(events.length,1);
});
test('Windows registration missing, invalid, or executable tampered cannot claim valid registration',()=>{
 for(const body of [{present:false},{...validWin,uninstallerPresent:false},
  {...validWin,registrationFieldsMatch:false},{...validWin,pathSafety:false},
  {...validWin,uninstallerSha256:null}]){
  const r=inspectNativeRegistration({platform:'windows',
   run:()=>({code:0,stdout:JSON.stringify(body),stderr:''})});
  assert.notEqual(r.status,'REGISTRATION_OBSERVED');
  assert.equal(r.fullRestoreVerified,false);
 }
 assert.throws(()=>inspectNativeRegistration({platform:'windows',
  run:()=>({code:0,stdout:'{}',stderr:''})}),
  {code:'NATIVE_REGISTRATION_OUTPUT_INVALID'});
});
test('Linux dpkg registration shows installed paths and verify result, never signer or restore',()=>{
 const events=[];
 const run=(bin,args)=>{
  events.push({bin,args});
  if(bin==='dpkg-query'&&args[0]==='-W')
   return {code:0,stdout:NATIVE_LINUX_PACKAGE+'|0.12.0~dev.1|install ok installed',stderr:''};
  if(bin==='dpkg-query'&&args[0]==='-L')
   return {code:0,stdout:'/.\n/usr\n/usr/bin/remote-commander-unified',stderr:''};
  if(bin==='dpkg')return {code:0,stdout:'',stderr:''};
  throw Error('FORBIDDEN_NATIVE_ACTION');
 };
 const evidence=inspectNativeRegistration({platform:'linux',run});
 assert.equal(evidence.status,'REGISTRATION_OBSERVED');
 assert.equal(evidence.registeredVersion,'0.12.0-dev.1');
 assert.equal(evidence.dpkgListedEntries,3);
 assert.match(evidence.dpkgPathListSha256,/^[a-f0-9]{64}$/);
 assert.equal(evidence.fullRestoreVerified,false);
 assert.deepEqual(events.map(v=>v.bin),['dpkg-query','dpkg-query','dpkg']);
});
test('Linux dpkg verify drift, absent package and malformed metadata all fail closed',()=>{
 const make=(mode)=>(bin,args)=>{
  if(bin==='dpkg-query'&&args[0]==='-W'){
   if(mode==='missing')return {code:1,stdout:'',
    stderr:'dpkg-query: no packages found matching chatgpt-remote-commander'};
   return {code:0,stdout:NATIVE_LINUX_PACKAGE+'|0.12.0~dev.1|install ok installed',stderr:''};
  }
  if(bin==='dpkg-query'&&args[0]==='-L')
   return {code:0,stdout:'/usr\n/usr/bin/app',stderr:''};
  return {code:mode==='drift'?1:0,stdout:mode==='drift'?'??5?????? /usr/bin/app':'',stderr:''};
 };
 for(const mode of ['missing','drift']){
  const r=inspectNativeRegistration({platform:'linux',run:make(mode)});
  assert.notEqual(r.status,'REGISTRATION_OBSERVED');
  assert.equal(r.fullRestoreVerified,false);
 }
 assert.throws(()=>inspectNativeRegistration({platform:'linux',
  run:()=>({code:0,stdout:'arbitrary|wrong|install ok installed',stderr:''})}),
 {code:'NATIVE_REGISTRATION_LINUX_STATUS_INVALID'});
});
