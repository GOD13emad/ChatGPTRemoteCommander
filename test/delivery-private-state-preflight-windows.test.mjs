import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {DeliveryStore} from '../src/delivery-store.mjs';

const onWindows=process.platform==='win32';
const script=path.resolve('tools/delivery-private-state-preflight.ps1');
const ps=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
function fixture(t,prefix='rc-private-preflight-'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function audit(dir,scope='qa',max=10,executable=ps){
  const p=spawnSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',script,
    '-Directory',dir,'-Scope',scope,'-MaxArtifactFiles',String(max)],{
      encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8192});
  assert.equal(p.status,0,'preflight script failed (no raw output exposed)');
  const result=JSON.parse(p.stdout.trim());
  assert.equal(result.schema,1);
  assert.equal(result.kind,'delivery-private-state-preflight');
  assert.equal(result.platform,'windows');
  assert.deepEqual(Object.keys(result).sort(),[
    'schema','kind','platform','complete','eligible','checked','artifactFilesChecked',
    'artifactScanLimit','limitReached','missingRequired','reparsePoints',
    'ownerMismatch','inheritedDirectoryAcl','broadAllow','inspectionErrors','hardlinkAliases'
  ].sort());
  return result;
}
test('private Windows delivery fixture passes read-only ACL preflight',{skip:!onWindows},t=>{
  const dir=path.join(fixture(t),'store');
  const s=new DeliveryStore({directory:dir,scope:'qa'});
  s.writeArtifact({status:'COMPLETED',index:0});s.close();
  const result=audit(dir);
  assert.equal(result.complete,true,'redacted preflight summary: '+JSON.stringify(result));assert.equal(result.eligible,true);
  assert.equal(result.artifactFilesChecked,1);
  assert.equal(result.ownerMismatch,0);assert.equal(result.broadAllow,0);
});
test('inherited Windows ACL fails closed without rewriting files',{skip:!onWindows},t=>{
  const dir=path.join(fixture(t),'inherited');fs.mkdirSync(dir);
  const report=audit(dir);
  assert.equal(report.eligible,false);
  assert.ok(report.inheritedDirectoryAcl>0||report.broadAllow>0,'redacted preflight summary: '+JSON.stringify(report));
  assert.ok(fs.statSync(dir).isDirectory());
  assert.equal(fs.existsSync(path.join(dir,'delivery.sqlite')),false);
});
test('bounded scan never labels partial Windows artifact audit eligible',{skip:!onWindows},t=>{
  const dir=path.join(fixture(t),'many');
  const s=new DeliveryStore({directory:dir,scope:'qa'});
  try {for(let i=0;i<3;i++)s.writeArtifact({status:'COMPLETED',index:i});}
  finally{s.close();}
  const report=audit(dir,'qa',2);
  assert.equal(report.limitReached,true,'redacted preflight summary: '+JSON.stringify(report));assert.equal(report.complete,false);
  assert.equal(report.eligible,false);assert.equal(report.artifactFilesChecked,2);
});

test('PowerShell 7 native ACL path agrees with Windows PowerShell 5.1', {skip:!onWindows}, t=>{
  const probe=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSEdition'],{
    encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:512
  });
  if(probe.status!==0||probe.stdout.trim()!=='Core')return t.skip('pwsh 7 unavailable');
  const root=fixture(t);
  const dir=path.join(root,'private');
  const s=new DeliveryStore({directory:dir,scope:'qa'});
  try{s.writeArtifact({status:'COMPLETED',value:'ps7'});}finally{s.close();}
  const v5=audit(dir,'qa',10);
  const v7=audit(dir,'qa',10,'pwsh.exe');
  assert.equal(v5.eligible,true,'redacted Windows PowerShell preflight summary: '+JSON.stringify(v5));
  assert.deepEqual(v7,v5);
});

test('Windows 8.3 local short path is admitted after secure canonicalization',{skip:!onWindows},t=>{
  const root=fixture(t,'rc-short-root-');
  if(!/~[0-9]/.test(root))return t.skip('short-path alias not present on this runner');
  const dir=path.join(root,'state');
  const s=new DeliveryStore({directory:dir,scope:'qa'});s.close();
  const report=audit(dir);
  assert.equal(report.complete,true,'redacted short-path report: '+JSON.stringify(report));
  assert.equal(report.eligible,true);
});
test('relative, UNC and explicit parent traversal fail closed',{skip:!onWindows},t=>{
  const dir=path.join(fixture(t),'state');
  const attempts=[
    'relative\\state',
    'C:relative',
    '\\\\example.invalid\\share\\state',
    dir+'\\..\\state'
  ];
  for(const candidate of attempts){
    const result=audit(candidate);
    assert.equal(result.eligible,false);
    assert.equal(result.checked,0);
    assert.ok(result.inspectionErrors>0,'redacted invalid-path report: '+JSON.stringify(result));
  }
});

test('Windows hardlinked delivery SQLite is ineligible without touching link targets', {skip:!onWindows},t=>{
 const dir=path.join(fixture(t),'database-links');const s=new DeliveryStore({directory:dir,scope:'qa'});
 s.close();const database=path.join(dir,'delivery.sqlite');
 fs.linkSync(database,path.join(dir,'database-link-alias'));
 assert.equal(fs.statSync(database).nlink,2);
 const result=audit(dir);
 assert.equal(result.complete,true,'redacted SQLite hardlink report: '+JSON.stringify(result));
 assert.equal(result.eligible,false);
 assert.equal(result.hardlinkAliases,1);
 assert.equal(fs.statSync(database).nlink,2);
});
test('Windows hardlinked content-addressed artifact is ineligible', {skip:!onWindows},t=>{
 const dir=path.join(fixture(t),'artifact-links');const s=new DeliveryStore({directory:dir,scope:'qa'});
 const ref=s.writeArtifact({status:'COMPLETED',value:'hardlink'});const artifact=s.artifactPath(ref.id);s.close();
 fs.linkSync(artifact,path.join(dir,'artifact-link-alias'));
 assert.equal(fs.statSync(artifact).nlink,2);
 const result=audit(dir);
 assert.equal(result.complete,true,'redacted artifact hardlink report: '+JSON.stringify(result));
 assert.equal(result.eligible,false);
 assert.equal(result.hardlinkAliases,1);
 assert.equal(fs.statSync(artifact).nlink,2);
});
