import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const script=path.join(root,'tools','backup-retention-windows.ps1');
const pwsh=process.platform==='win32'?'pwsh.exe':'pwsh';

function run(base,args=[]){
 const r=spawnSync(pwsh,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Base',base,...args],{encoding:'utf8',timeout:30000,windowsHide:true});
 if(r.error)throw r.error;
 assert.equal(r.status,0,r.stderr||r.stdout);
 const lines=String(r.stdout).trim().split(/\r?\n/).filter(Boolean);
 return JSON.parse(lines.at(-1));
}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

test('Windows backup retention archives old open snapshots only after verified archive creation',{skip:process.platform!=='win32'},()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc-backup-maint-'));
 try{
  const backups=path.join(base,'backups');fs.mkdirSync(backups,{recursive:true});
  for(const name of ['old-a','old-b']){
   const dir=path.join(backups,name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'evidence.txt'),name);
   const old=new Date(Date.now()-4*3600_000);fs.utimesSync(dir,old,old);
  }
  const result=run(base,['-OpenCutoffHours','1']);
  assert.equal(result.status,'PASS');
  assert.equal(result.archived.length,1);
  assert.equal(result.archived[0].sourceCount,2);
  assert.equal(fs.readdirSync(backups).length,0);
  const archives=fs.readdirSync(path.join(base,'backup-archives')).filter(x=>x.endsWith('.tar.gz'));
  assert.equal(archives.length,1);
  const archive=path.join(base,'backup-archives',archives[0]);
  assert.equal(sha(archive),String(result.archived[0].sha256));
  assert.ok(fs.existsSync(archive+'.sha256'));
  assert.ok(fs.existsSync(archive+'.json'));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('Windows archive GC is count bounded and deletes only verified archive sets',{skip:process.platform!=='win32'},()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc-backup-gc-'));
 try{
  const archives=path.join(base,'backup-archives');fs.mkdirSync(archives,{recursive:true});fs.mkdirSync(path.join(base,'backups'),{recursive:true});
  for(let i=0;i<16;i++){
   const file=path.join(archives,'fixture-'+String(i).padStart(2,'0')+'.tar.gz');
   fs.writeFileSync(file,Buffer.from('archive-'+i));
   const digest=sha(file);fs.writeFileSync(file+'.sha256',digest+'  '+path.basename(file)+'\n');
   fs.writeFileSync(file+'.json',JSON.stringify({schema:2,archive:file,sha256:digest})+'\n');
   const at=new Date(Date.now()-(20-i)*60_000);fs.utimesSync(file,at,at);
  }
  const result=run(base,['-OpenCutoffHours','720','-MaxArchives','14','-MinArchives','2','-MaxArchiveAgeDays','3650']);
  assert.equal(result.status,'PASS');
  assert.equal(result.after.archiveCount,14);
  assert.equal(result.archiveGc.length,2);
  assert.ok(result.archiveGc.every(x=>x.reason==='COUNT'));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
