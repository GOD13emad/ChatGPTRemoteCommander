import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeOsAdapter,cleanFreshLinuxOwnerState}
  from '../tools/universal-install/native-os-adapters.mjs';
import {executeNativeTransaction}
  from '../tools/universal-install/native-transaction.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const spec=(platform,dir)=>{
  const newFile=path.join(dir,'Remote-Commander-Unified-0.12.0-dev.9-'+
    (platform==='linux'?'Linux-amd64.deb':'Windows-x64.exe'));
  const oldFile=path.join(dir,'Remote-Commander-Unified-0.12.0-dev.8-'+
    (platform==='linux'?'Linux-amd64.deb':'Windows-x64.exe'));
  const b1=Buffer.alloc(2048,12),b2=Buffer.alloc(2048,34);
  fs.writeFileSync(newFile,b2);
  fs.writeFileSync(oldFile,b1);
  return {product:'ChatGPTRemoteCommander',platform,architecture:'x64',
    expectedCommit:'d'.repeat(40),
    candidate:{path:newFile,sha256:sha(b2),version:'0.12.0-dev.9'},
    previous:{path:oldFile,sha256:sha(b1),version:'0.12.0-dev.8'}
  };
};
function mockedAdapter(platform,events){
  let installed='0.12.0-dev.8';
  const run=(bin,args)=>{
    events.push({bin,args});
    if(platform==='linux'){
      if(bin==='dpkg-deb'){
        const field=args[2];
        return {code:0,stdout:field==='Package'?'chatgpt-remote-commander':
          field==='Architecture'?'amd64':args[1].includes('dev.9')?
            '0.12.0~dev.9':'0.12.0~dev.8',stderr:''};
      }
      if(bin==='dpkg-query')return {code:0,
        stdout:installed.replace('-dev.','~dev.')+'|install ok installed',stderr:''};
      if(bin==='dpkg')return {code:0,stdout:'',stderr:''};
      if(bin==='systemctl')return {code:0,
        stdout:'ActiveState=active\nMainPID=111\nExecStart=/unchanged/old-core',stderr:''};
      if(bin==='pkexec'){installed=args[2].includes('dev.9')
        ?'0.12.0-dev.9':'0.12.0-dev.8';
        return {code:0,stdout:'',stderr:''};}
    }else if(bin==='pwsh'){
      const src=Buffer.from(args.at(-1),'base64').toString('utf16le');
      if(src.includes('Get-NetTCPConnection'))
        return {code:0,stdout:'f'.repeat(64),stderr:''};
      if(src.includes('Get-ChildItem'))
        return {code:0,stdout:installed,stderr:''};
      if(src.includes('Start-Process')){
        assert.match(src,/ELEVATED_OWNER_REFUSED/u);
        installed=src.includes('dev.9')?'0.12.0-dev.9':'0.12.0-dev.8';
        return {code:0,stdout:'NATIVE_NSIS_EXIT_ZERO',stderr:''};
      }
      if(src.includes('VersionInfo.FileVersion'))
        return {code:0,stdout:src.includes('dev.9')?
          '0.12.0-dev.9':'0.12.0-dev.8',stderr:''};
    }
    throw Error('UNEXPECTED_OS_EXEC_'+bin);
  };
  return {adapter:createNativeOsAdapter({
    platform,architecture:'x64',run
  }),get installed(){return installed;}};
}
const approval=async plan=>({
  kind:'native-owner-install-approval',transactionId:plan.transactionId,approved:true
});
const journal=()=>({
  claim:async()=>{},write:async()=>{},close:async()=>{}
});
test('the one native transaction exercises both real OS command interfaces',async()=>{
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-adapter-qa-'));
  try{
    for(const platform of ['windows','linux']){
      const dir=path.join(root,platform);fs.mkdirSync(dir);
      const input=spec(platform,dir),events=[];
      const native=mockedAdapter(platform,events);
      const plan=await executeNativeTransaction({
        action:'plan',input,adapter:native.adapter
      });
      assert.equal(plan.status,'READY_TO_APPLY');
      assert.equal(events.some(x=>x.bin==='pkexec'||(
        x.bin==='pwsh'&&Buffer.from(x.args.at(-1),'base64')
          .toString('utf16le').includes('Start-Process'))),false);
      const applied=await executeNativeTransaction({
        action:'apply',input,adapter:native.adapter,
        approve:approval,journal:journal()
      });
      assert.equal(applied.status,'NATIVE_PACKAGE_UPGRADED');
      assert.equal(native.installed,'0.12.0-dev.9');
      const rollback=await executeNativeTransaction({
        action:'rollback',input,adapter:native.adapter,
        approve:approval,journal:journal()
      });
      assert.equal(rollback.status,'NATIVE_PACKAGE_ROLLED_BACK');
      assert.equal(native.installed,'0.12.0-dev.8');
      assert.equal(events.filter(x=>x.bin==='pkexec'
        ||x.bin==='pwsh'&&Buffer.from(x.args.at(-1),'base64')
        .toString('utf16le').includes('Start-Process')).length,2);
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('both native adapters reject changed package hashes before invoking OS package manager',async()=>{
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-adapter-qa-'));
  try{
    for(const platform of ['windows','linux']){
      const dir=path.join(root,platform);fs.mkdirSync(dir);
      const input=spec(platform,dir),events=[];
      const native=mockedAdapter(platform,events);
      input.candidate.sha256='0'.repeat(64);
      await assert.rejects(executeNativeTransaction({
        action:'plan',input,adapter:native.adapter
      }),{code:'UNIVERSAL_NATIVE_ARTIFACT_SHA256_MISMATCH'});
      assert.equal(events.filter(x=>x.bin==='pkexec').length,0);
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('both adapters reject malformed versions and incomplete native snapshots',async()=>{
  assert.throws(()=>createNativeOsAdapter({platform:'solaris'}),
    {code:'UNIVERSAL_NATIVE_PLATFORM_UNSUPPORTED'});
  const root=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-adapter-qa-'));
  try{
    const input=spec('linux',root),native=mockedAdapter('linux',[]);
    input.previous.version='0.12.0-dev.10';
    await assert.rejects(executeNativeTransaction({
      action:'plan',input,adapter:native.adapter
    }),{code:'UNIVERSAL_NATIVE_VERSION_ORDER_INVALID'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('fresh rollback uses OS-native dpkg remove and fixed user-local NSIS uninstaller, never arbitrary commands',async()=>{
  const linux=[];
  const l=createNativeOsAdapter({
    platform:'linux',architecture:'x64',run:(cmd,args,options)=>{
      linux.push({cmd,args,options});return {code:0,stdout:'',stderr:''};
    }
  });
  await assert.rejects(l.uninstall(null,{installationKind:'upgrade'}),
    {code:'UNIVERSAL_NATIVE_FRESH_UNINSTALL_NOT_APPROVED'});
  assert.equal(linux.length,0);
  await l.uninstall(null,{installationKind:'fresh'});
  assert.equal(linux.length,1);
  assert.equal(linux[0].cmd,'pkexec');
  assert.deepEqual(linux[0].args,
    ['/usr/bin/dpkg','--remove','chatgpt-remote-commander']);

  const temp=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-uninstall-qa-'));
  const old=process.env.LOCALAPPDATA;
  try{
    process.env.LOCALAPPDATA=temp;
    const app=path.join(temp,'Programs','remote-commander-unified');
    fs.mkdirSync(app,{recursive:true});
    fs.writeFileSync(path.join(app,'Uninstall Remote Commander.exe'),
      Buffer.alloc(2048));
    const actions=[];
    const w=createNativeOsAdapter({
      platform:'windows',architecture:'x64',run:(binary,args,options)=>{
        actions.push({binary,args,options});
        return {code:0,stdout:'NATIVE_NSIS_UNINSTALL_EXIT_ZERO',stderr:''};
      }
    });
    await w.uninstall(null,{installationKind:'fresh'});
    assert.equal(actions.length,1);
    const script=Buffer.from(actions[0].args.at(-1),'base64')
      .toString('utf16le');
    assert.match(script,/Uninstall Remote Commander\.exe/);
    assert.match(script,/ELEVATED_OWNER_REFUSED/);
    assert.match(script,/ArgumentList '\/S'/);
    assert.doesNotMatch(script,/Remove-Item|Set-Acl/);
  }finally{
    if(old===undefined)delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA=old;
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('fresh Linux state permits ONLY its own journal but rejects profiles and orphaned state',()=>{
  const home=fs.mkdtempSync(path.join(os.homedir(),'rc-universal-blank-home-'));
  const root=path.join(home,'.local','state','chatgpt-remote-commander');
  const journal=path.join(root,'rc-universal-native-journal');
  try{
    assert.equal(cleanFreshLinuxOwnerState(home),true);
    fs.mkdirSync(journal,{recursive:true});
    fs.writeFileSync(path.join(journal,'install.lock'),'mock lock');
    fs.writeFileSync(path.join(journal,'events.jsonl'),'mock events');
    assert.equal(cleanFreshLinuxOwnerState(home),true);
    fs.writeFileSync(path.join(root,'profile.json'),'profile');
    assert.equal(cleanFreshLinuxOwnerState(home),false);
    fs.unlinkSync(path.join(root,'profile.json'));
    fs.mkdirSync(path.join(home,'.local','share','ChatGPTRemoteCommander'),
      {recursive:true});
    assert.equal(cleanFreshLinuxOwnerState(home),false);
    fs.rmSync(path.join(home,'.local','share','ChatGPTRemoteCommander'),
      {recursive:true});
    fs.mkdirSync(path.join(home,'.config','chatgpt-remote-commander'),
      {recursive:true});
    assert.equal(cleanFreshLinuxOwnerState(home),false);
    fs.rmSync(path.join(home,'.config','chatgpt-remote-commander'),
      {recursive:true});
    assert.equal(cleanFreshLinuxOwnerState(home),true);
    fs.rmSync(journal,{recursive:true});
    try{
      fs.symlinkSync(home,journal);
      assert.equal(cleanFreshLinuxOwnerState(home),false);
    }catch(error){
      // Windows without Developer Mode cannot create this QA symlink;
      // all positive/negative non-symlink state tests still run there.
      if(!['EPERM','EACCES','ENOTSUP'].includes(error?.code))
        throw error;
    }
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
