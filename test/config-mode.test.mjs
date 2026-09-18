import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(),'rc-config-mode-'));
  const pub = path.join(root,'config.json');
  const cfg = path.join(root,'config.local.json');
  const workspace = path.join(root,'workspace');
  await mkdir(workspace,{recursive:true});
  await writeFile(pub, JSON.stringify({host:'127.0.0.1',port:47831,customPublic:'keep',allowedRoots:[workspace],allowedPrograms:['git'],powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,customPower:'keep',guiControl:{enabled:false,customGui:'keep'}}},null,2));
  return {root,pub,cfg,workspace};
}

function merge(x, mode, platform='linux', gui='preserve', expectStatus=0) {
  const r=spawnSync(process.execPath,['tools/merge-config.mjs','--config',x.cfg,'--public',x.pub,'--mode',mode,'--workspace',x.workspace,'--platform',platform,'--gui',gui],{encoding:'utf8'});
  assert.equal(r.status,expectStatus,r.stderr);
  return expectStatus === 0 ? JSON.parse(r.stdout) : r;
}

test('fresh standard policy is created with GUI disabled', async (t)=>{
  const x=await setup(); t.after(()=>rm(x.root,{recursive:true,force:true}));
  const result=merge(x,'standard');
  const data=JSON.parse(await readFile(x.cfg,'utf8'));
  assert.equal(result.changed,true);
  assert.equal(data.powerMode.enabled,false);
  assert.equal(data.powerMode.guiControl.enabled,false);
  assert.equal(data.customPublic,'keep');
});

test('power transition preserves unrelated local fields', async (t)=>{
  const x=await setup(); t.after(()=>rm(x.root,{recursive:true,force:true}));
  await writeFile(x.cfg,JSON.stringify({host:'127.0.0.1',port:47831,userCustom:{x:7},allowedRoots:[x.workspace],allowedPrograms:['git'],powerMode:{enabled:false,customPower:'stay',guiControl:{enabled:false,customGui:'stay'}}},null,2));
  merge(x,'power');
  const data=JSON.parse(await readFile(x.cfg,'utf8'));
  assert.equal(data.userCustom.x,7);
  assert.equal(data.powerMode.customPower,'stay');
  assert.equal(data.powerMode.guiControl.customGui,'stay');
  assert.equal(data.powerMode.enabled,true);
  assert.equal(data.powerMode.fullFilesystem,true);
  assert.equal(data.powerMode.guiControl.enabled,false);
});

test('preserve mode does not rewrite existing local config', async (t)=>{
  const x=await setup(); t.after(()=>rm(x.root,{recursive:true,force:true}));
  const original='{\n  "sentinel": "exact",\n  "powerMode": {"enabled": true, "guiControl": {"enabled": false}}\n}\n';
  await writeFile(x.cfg,original);
  const result=merge(x,'preserve');
  assert.equal(result.changed,false);
  assert.equal(await readFile(x.cfg,'utf8'),original);
});

test('explicit standard disables Power without deleting unrelated fields', async (t)=>{
  const x=await setup(); t.after(()=>rm(x.root,{recursive:true,force:true}));
  await writeFile(x.cfg,JSON.stringify({custom:'yes',powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,guiControl:{enabled:false}}},null,2));
  merge(x,'standard');
  const data=JSON.parse(await readFile(x.cfg,'utf8'));
  assert.equal(data.custom,'yes');
  assert.equal(data.powerMode.enabled,false);
});


test('Windows Power+GUI transition preserves custom fields and enables all GUI gates', async (t)=>{
  const x=await setup(); t.after(()=>rm(x.root,{recursive:true,force:true}));
  await writeFile(x.cfg,JSON.stringify({custom:'keep',allowedRoots:[x.workspace],allowedPrograms:['git'],powerMode:{enabled:false,customPower:'stay',guiControl:{enabled:false,customGui:'stay'}}},null,2));
  const result=merge(x,'power','windows','enable');
  const data=JSON.parse(await readFile(x.cfg,'utf8'));
  assert.equal(result.powerMode,true);
  assert.equal(result.guiControl,true);
  assert.equal(data.custom,'keep');
  assert.equal(data.powerMode.customPower,'stay');
  assert.equal(data.powerMode.guiControl.customGui,'stay');
  for (const key of ['allowScreenshot','allowMouse','allowKeyboard','allowWindowFocus']) assert.equal(data.powerMode.guiControl[key],true);
});

test('Windows GUI enable without Power fails closed and leaves existing config unchanged', async (t)=>{
  const x=await setup(); t.after(()=>rm(x.root,{recursive:true,force:true}));
  const original=JSON.stringify({sentinel:'unchanged',powerMode:{enabled:false,guiControl:{enabled:false}}},null,2)+'\n';
  await writeFile(x.cfg,original);
  const result=merge(x,'standard','windows','enable',1);
  assert.match(result.stderr,/GUI control requires Power Mode/);
  assert.equal(await readFile(x.cfg,'utf8'),original);
});
