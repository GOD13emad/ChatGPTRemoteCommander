import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const dir=fileURLToPath(new URL('..',import.meta.url));
const script=path.join(dir,'tools','windows-system-task-trust-audit.ps1');
test('task trust audit never modifies tasks, ACLs or processes',()=>{
 const s=readFileSync(script,'utf8');
 assert.match(s,/Get-ScheduledTask/);assert.match(s,/UNTRUSTED_WRITE_ACE/);
 assert.match(s,/UNTRUSTED_OWNER/);assert.match(s,/ReparsePoint/);
 assert.doesNotMatch(s,/(?:Register-ScheduledTask|Set-Acl|Set-ScheduledTask|Start-ScheduledTask|Stop-Process|icacls\.exe)/);
});
test('Windows fixture demonstrates unsafe user-owned action and empty task discovery',{
 skip:process.platform!=='win32'?'Windows only':false
},()=>{
 const d=mkdtempSync(path.join(tmpdir(),'rc-task-trust-'));
 try{
  const f=path.join(d,'test.ps1');writeFileSync(f,'# no execution');
  const run=extra=>spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',script,...extra],{
   cwd:dir,encoding:'utf8',timeout:12000,windowsHide:true});
  const a=run(['-InspectPath',f]);
  assert.equal(a.status,0,a.stderr);
  const data=JSON.parse(a.stdout.trim());
  assert.equal(data.readOnly,true);assert.equal(data.checks,1);
  assert.equal(data.accepted,false);assert.equal(data.unsafe,1);
  assert.equal(data.migrationReady,false);
  assert.ok(data.migrationBlockers.includes('DEPENDENCY_CLOSURE_UNVERIFIED'));
  assert.deepEqual(data.definitions,[]);
  const protectedExe=path.join(process.env.SystemRoot||'C:\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const secure=run(['-InspectPath',protectedExe]);
  assert.equal(secure.status,0,secure.stderr);
  const secureJson=JSON.parse(secure.stdout.trim());
  assert.equal(secureJson.unsafe,0,'Windows protected executable must not be falsely flagged');
  assert.equal(secureJson.accepted,true);
  const b=run(['-TaskNamePattern','NoSuchTask_RC438_2026_*']);
  assert.equal(b.status,0,b.stderr);assert.equal(JSON.parse(b.stdout.trim()).checks,0);
 }finally{rmSync(d,{recursive:true,force:true});}
});
