import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DeliveryStore} from '../src/delivery-store.mjs';

const root=fileURLToPath(new URL('..', import.meta.url));
const linux=fs.readFileSync(path.join(root,'auto-update-linux.sh'),'utf8');
const windows=fs.readFileSync(path.join(root,'auto-update-windows.ps1'),'utf8');

// A no-promotion canary may read a protected source backup, but it must never
// start a candidate using the live WorkflowStore, deliveries, root leases or
// user browser profile. Structural assertions guard both native updaters.
test('Linux no-promote uses only shadow state for both candidate starts',()=>{
 assert.match(linux,/if \[\[ "\$NO_PROMOTE" == 1 \]\]; then FINAL_WF="\$SHADOW_WF"; FINAL_DELIVERY_MODE=shadow; fi/);
 assert.match(linux,/build_cfg "\$FINAL_CFG" "\$FINAL_WF" "\$FINAL_DELIVERY_MODE"/);
 assert.match(linux,/provider_root="\$BACKUP_ROOT\/\$COMMIT\/default\/provider-shadow"/);
 assert.match(linux,/--async-operations-dir "\$BACKUP_ROOT\/\$COMMIT\/default\/async-operations-shadow-\$PORT"/);
 assert.match(linux,/--delivery-directory "\$BACKUP_ROOT\/\$COMMIT\/default\/delivery-shadow-\$PORT"/);
 assert.match(linux,/--backup-root "\$BACKUP_ROOT\/\$COMMIT\/default\/power-backups-shadow"/);
 assert.match(linux,/--browser-profile-root "\$BACKUP_ROOT\/\$COMMIT\/default\/browser-profile-shadow"/);
 assert.match(linux,/if \[\[ "\$NO_PROMOTE" == 1 \]\]; then log "AUTO_UPDATE_NO_PROMOTE_ALREADY_ROUTED_NO_CHANGE"; exit 0; fi/);
});
test('Windows no-promote has shadow workflow, lease, delivery, async and browser roots',()=>{
 assert.match(windows,/if\(\$NoPromote\)\{\$finalWorkflowDir=\$shadowWorkflowDir;\$finalProviderRoot=\$shadowProviderRoot\}/);
 assert.match(windows,/if\(\$finalWorkflowDir\)\{\$finalArgs\+=@\('--workflow-dir',\$finalWorkflowDir\)\}/);
 assert.match(windows,/if\(\$NoPromote\)\{\s*\$finalArgs\+=@\('--async-operations-dir',\$shadowAsyncOperationsDir,'--delivery-directory',\$shadowDeliveryRoot/);
 assert.match(windows,/\$finalArgs\+=@\('--backup-root',\$shadowBackupRoot,'--browser-profile-root',\$shadowBrowserRoot\)/);
 assert.match(windows,/\$buildArgs\+=@\('--delivery-directory',\$shadowDeliveryRoot/);
 assert.match(windows,/NOT_TESTED_SHADOW_ONLY/);
});
test('candidate config generator isolates all requested mutable runtime locations',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-no-promote-shadow-'));
 try {
  const f=n=>path.join(dir,n);
  const cfg=f('diagnostic.json');
  const existing=f('existing-config.json');
  const prior=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  prior.durableWorkflows={...(prior.durableWorkflows??{}),enabled:true,directory:f('live-original')};
  fs.writeFileSync(existing,JSON.stringify(prior));
  const names=['shadow-workflow','shadow-async','shadow-delivery','shadow-provider','shadow-backup','shadow-browser'];
  const args=[
   path.join(root,'tools/build-candidate-config.mjs'),'--default',path.join(root,'config.json'),
   '--existing',existing,
   '--output',cfg,'--profile-id','default','--port','51091','--state-dir',f('shadow-state'),
   '--workflow-dir',f(names[0]),'--async-operations-dir',f(names[1]),
   '--delivery-directory',f(names[2]),'--delivery-scope','diagnostic-no-promote-qa',
   '--provider-root',f(names[3]),'--backup-root',f(names[4]),
   '--browser-profile-root',f(names[5])
  ];
  const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);
  const c=JSON.parse(fs.readFileSync(cfg,'utf8'));
  assert.equal(c.durableWorkflows.directory,f(names[0]));
  assert.equal(c.asyncOperations.stateDir,f(names[1]));
  assert.equal(c.durableDelivery.directory,f(names[2]));
  assert.equal(c.durableWorkflows.rootLeaseDirectory,path.join(f(names[3]),'shared','root-leases'));
  assert.equal(c.powerMode.backupRoot,f(names[4]));
  assert.equal(c.powerMode.browserControl.profileRoot,f(names[5]));
  assert.equal(c.host,'127.0.0.1');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('R157 hosted Windows fixture keeps private delivery outside its project root',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/windows-updater-e2e-r157.yml'),'utf8');
 assert.match(workflow,/foreach\(\$area in @\('INSTALL','STATE','ROAMING','PROJECT_ONLY'\)\)/);
 assert.match(workflow,/\$project=Join-Path \$root 'PROJECT_ONLY'/);
 assert.match(workflow,/\$c\.allowedRoots=@\(\$project\)/);
 assert.match(workflow,/\$r\.allowedRoots\[0\] -ne \$project/);
 assert.doesNotMatch(workflow,/\$c\.allowedRoots=@\(\$root\)/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r157-private-store-'));
 const project=path.join(dir,'PROJECT_ONLY');
 const privateState=path.join(dir,'STATE','ChatGPTRemoteCommander','delivery-shadow');
 let store;
 try{
  fs.mkdirSync(project,{recursive:true});
  fs.mkdirSync(privateState,{recursive:true});
  assert.throws(()=>new DeliveryStore({directory:privateState,scope:'r157-qa',forbiddenRoots:[dir]}),/DELIVERY_STORE_INSIDE_PROJECT/);
  store=new DeliveryStore({directory:privateState,scope:'r157-qa',forbiddenRoots:[project]});
  assert.equal(store.directory,fs.realpathSync.native(privateState));
 }finally{store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('R157 NoPromote verification accepts shadow-only evidence without claiming live-store PASS',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/windows-updater-e2e-r157.yml'),'utf8');
 assert.match(windows,/if\(\$NoPromote\)\{\$liveStoreCompatibility='NOT_TESTED_SHADOW_ONLY'\}/);
 assert.match(workflow,/\$profiles\[0\]\.liveStoreCompatibility -ne 'NOT_TESTED_SHADOW_ONLY'/);
 assert.match(workflow,/liveStoreCompatibility='NOT_TESTED_SHADOW_ONLY';ownedChildren=0;promoted=\$false/);
 assert.doesNotMatch(workflow,/\$profiles\[0\]\.liveStoreCompatibility -ne 'PASS'/);
 assert.doesNotMatch(workflow,/liveStoreCompatibility='PASS';ownedChildren=0/);
});
