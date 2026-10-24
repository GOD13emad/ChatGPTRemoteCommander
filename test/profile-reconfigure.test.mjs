import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { buildProfileInstance } from '../src/profile-instances.mjs';
import { reconfigureProfileInstance } from '../src/profile-reconfigure.mjs';

const fixture=()=>{
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-profile-recfg-')));
  const state=path.join(root,'state');fs.mkdirSync(state);
  const base={host:'127.0.0.1',port:47831,allowedRoots:[root],allowedPrograms:['git','node'],auditLog:'var/audit.jsonl',powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:false,guiControl:{enabled:true}}};
  const baseFile=path.join(root,'base.json');fs.writeFileSync(baseFile,JSON.stringify(base));
  const initial=buildProfileInstance({baseConfig:base,profile:'secondary',port:47834,stateDirectory:state});
  const record={...initial.record,configPath:path.join(state,'config.json')};
  fs.writeFileSync(path.join(state,'config.json'),initial.json);fs.writeFileSync(path.join(state,'instance.json'),JSON.stringify(record,null,2));
  return {root,state,baseFile,initial,dispose(){fs.rmSync(root,{recursive:true,force:true});}};
};

test('reconfigure preserves port/store/runtime paths and enables power+GUI with backup',()=>{
 const f=fixture();try{
  const old=JSON.parse(fs.readFileSync(path.join(f.state,'config.json'),'utf8'));
  const r=reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,baseConfigPath:f.baseFile,powerMode:true,guiControl:true});
  const n=JSON.parse(fs.readFileSync(path.join(f.state,'config.json'),'utf8'));
  assert.equal(n.port,47834);assert.equal(n.powerMode.enabled,true);assert.equal(n.powerMode.fullFilesystem,true);assert.equal(n.powerMode.guiControl.enabled,true);
  assert.equal(n.durableWorkflows.directory,old.durableWorkflows.directory);assert.equal(n.runtimeState,old.runtimeState);
  assert.ok(fs.existsSync(path.join(r.backupDir,'config.json')));assert.ok(fs.existsSync(path.join(r.backupDir,'instance.json')));
 }finally{f.dispose();}
});

test('reconfigure with omitted mode preserves explicit full-power authority',()=>{
 const f=fixture();try{
  reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,baseConfigPath:f.baseFile,powerMode:true,guiControl:true});
  const before=JSON.parse(fs.readFileSync(path.join(f.state,'config.json'),'utf8'));
  before.powerMode.allowPermanentDelete=true;before.powerMode.blockedShellPatterns=[];before.capabilityProfile.explicitlyAuthorized=true;
  fs.writeFileSync(path.join(f.state,'config.json'),JSON.stringify(before,null,2)+'\n');
  const rec=JSON.parse(fs.readFileSync(path.join(f.state,'instance.json'),'utf8'));
  rec.configSha256=createHash('sha256').update(fs.readFileSync(path.join(f.state,'config.json'))).digest('hex');
  fs.writeFileSync(path.join(f.state,'instance.json'),JSON.stringify(rec,null,2)+'\n');
  reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,baseConfigPath:f.baseFile});
  const n=JSON.parse(fs.readFileSync(path.join(f.state,'config.json'),'utf8'));
  assert.equal(n.powerMode.enabled,true);assert.equal(n.powerMode.allowPermanentDelete,true);assert.deepEqual(n.powerMode.blockedShellPatterns,[]);
 }finally{f.dispose();}
});

test('reconfigure can return to conservative Standard without changing identity',()=>{
 const f=fixture();try{
  reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,baseConfigPath:f.baseFile,powerMode:true,guiControl:true});
  const r=reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,baseConfigPath:f.baseFile,powerMode:false,guiControl:false});
  const n=JSON.parse(fs.readFileSync(path.join(f.state,'config.json'),'utf8'));
  assert.equal(r.profile,'secondary');assert.equal(n.powerMode.enabled,false);assert.deepEqual(n.allowedPrograms,[]);assert.equal(n.instance.profile,'secondary');
 }finally{f.dispose();}
});


test('reconfigure persists explicit per-capability opt-outs and can re-enable them',()=>{
 const f=fixture();try{
  reconfigureProfileInstance({
    profile:'secondary',stateDirectory:f.state,baseConfigPath:f.baseFile,powerMode:true,guiControl:true,
    disableCapabilities:['browser.input','filesystem.permanent_delete','workflow.scheduler']
  });
  let n=JSON.parse(fs.readFileSync(path.join(f.state,'config.json'),'utf8'));
  assert.equal(n.powerMode.browserControl.allowInput,false);
  assert.equal(n.powerMode.allowPermanentDelete,false);
  assert.equal(n.durableWorkflows.scheduler.enabled,false);
  assert.ok(n.capabilityProfile.disabledCapabilities.includes('browser.input'));
  assert.ok(n.capabilityProfile.disabledCapabilities.includes('filesystem.permanent_delete'));
  assert.ok(n.capabilityProfile.disabledCapabilities.includes('workflow.scheduler'));

  reconfigureProfileInstance({
    profile:'secondary',stateDirectory:f.state,baseConfigPath:f.baseFile,
    enableCapabilities:['browser.input','filesystem.permanent_delete','workflow.scheduler']
  });
  n=JSON.parse(fs.readFileSync(path.join(f.state,'config.json'),'utf8'));
  assert.equal(n.powerMode.browserControl.allowInput,true);
  assert.equal(n.powerMode.allowPermanentDelete,true);
  assert.equal(n.durableWorkflows.scheduler.enabled,true);
  assert.equal(n.capabilityProfile.disabledCapabilities.includes('browser.input'),false);
  assert.equal(n.capabilityProfile.disabledCapabilities.includes('filesystem.permanent_delete'),false);
  assert.equal(n.capabilityProfile.disabledCapabilities.includes('workflow.scheduler'),false);
 }finally{f.dispose();}
});


test('backend expected policy digest accepts unchanged isolated profile only',()=>{
 const f=fixture();try{
   const cfgFile=path.join(f.state,'config.json');
   const old=fs.readFileSync(cfgFile);
   const hash=createHash('sha256').update(old).digest('hex');
   const r=reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,baseConfigPath:f.baseFile,
     powerMode:true,expectedConfigSha256:hash});
   assert.equal(r.oldConfigSha256,hash);
   assert.notEqual(r.newConfigSha256,hash);
   assert.throws(()=>reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,
     baseConfigPath:f.baseFile,powerMode:false,expectedConfigSha256:hash}),/PROFILE_RECONFIGURE_STALE_POLICY/);
   assert.equal(fs.readFileSync(cfgFile,'utf8').includes('"instance"'),true);
   assert.equal(fs.existsSync(path.join(f.state,'.profile-reconfigure.lock')),false);
 } finally{f.dispose();}
});

test('backend refuses tampered config-record pair before creating a backup',()=>{
 const f=fixture();try{
   const cfgFile=path.join(f.state,'config.json');
   fs.appendFileSync(cfgFile,' ');
   const backups=path.join(f.state,'backups');
   assert.throws(()=>reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,
     baseConfigPath:f.baseFile}),/PROFILE_RECONFIGURE_RECORD_CONFIG_MISMATCH/);
   assert.equal(fs.existsSync(backups),false);
   assert.equal(fs.existsSync(path.join(f.state,'.profile-reconfigure.lock')),false);
 }finally{f.dispose();}
});

test('backend concurrent profile edit lock fails closed and leaves all files unchanged',()=>{
 const f=fixture();try{
  const configFile=path.join(f.state,'config.json');
  const recordFile=path.join(f.state,'instance.json');
  const config=fs.readFileSync(configFile),record=fs.readFileSync(recordFile);
  fs.writeFileSync(path.join(f.state,'.profile-reconfigure.lock'),'editor already active');
  assert.throws(()=>reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,
    baseConfigPath:f.baseFile,powerMode:true}),/PROFILE_RECONFIGURE_BUSY/);
  assert.deepEqual(fs.readFileSync(configFile),config);
  assert.deepEqual(fs.readFileSync(recordFile),record);
  assert.equal(fs.existsSync(path.join(f.state,'backups')),false);
 }finally{f.dispose();}
});

test('invalid expected digest fails closed without any access or file changes',()=>{
 const f=fixture();try{
   const cfg=path.join(f.state,'config.json');
   const bytes=fs.readFileSync(cfg);
   assert.throws(()=>reconfigureProfileInstance({profile:'secondary',stateDirectory:f.state,
     baseConfigPath:f.baseFile,powerMode:true,expectedConfigSha256:'invalid'}),
       /PROFILE_RECONFIGURE_EXPECTED_CONFIG_SHA_INVALID/);
   assert.deepEqual(fs.readFileSync(cfg),bytes);
   assert.equal(fs.existsSync(path.join(f.state,'.profile-reconfigure.lock')),false);
 }finally{f.dispose();}
});
