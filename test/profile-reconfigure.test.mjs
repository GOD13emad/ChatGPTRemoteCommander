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
