#!/usr/bin/env node
// Read-only, nonsecret single-install collision evidence. NOT a cutover authority.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const app=/^(?:Commander V2(?: Workspace Preview)?|Remote Commander(?: Browser)?|Chat On Steroids)$/i;
const pkg=/^(?:commander-v2|chatgpt-remote-commander|remote-commander-browser|chat-on-steroids)$/i;
const unit=/^(?:chatgpt-remote-commander|commander-|rc-cua-|rc-owner-|rc-private-)[\w@.-]*\.service$/i;
// KDE generates an application scope and an escaped-name autostart service for
// an existing Commander V2 Workspace Preview. Neither is an apt package.
const previewUnit=/^app-(?:com\.commanderv2\.workspace\.preview[-\w.]*\.scope|commander(?:-v2|\\x2dv2)(?:-workspace|\\x2dworkspace)(?:-preview|\\x2dpreview)@[A-Za-z0-9._-]+\.service)$/i;
const task=/^(?:ChatGPTRemoteCommander|CommanderTransferMesh|CommanderV2)[\w. -]*$/i;
const processName=/^(?:Commander|Commander V2|RemoteCommander|Chat On Steroids|CoS)$/i;
const ok=(v,n=128)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\x00-\x1f\x7f]/.test(v);
const run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',timeout:6000,maxBuffer:1048576,windowsHide:true});
const rows=s=>String(s).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const ordered=a=>a.sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y),'en'));
function linuxPackages(raw){
 return ordered(rows(raw).flatMap(s=>{
  const p=s.split(/\s+/,2);
  return pkg.test(p[0])&&ok(p[1],80)?[{name:p[0],version:p[1]}]:[];
 })).slice(0,100);
}
function linuxUnits(raw,active=false){
 return ordered(rows(raw).flatMap(s=>{
  const p=s.replace(/^[●\s]+/,'').split(/\s+/);
  if(!unit.test(p[0])&&!previewUnit.test(p[0]))return [];
  if(active)return ['loaded','not-found','masked'].includes(p[1])&&ok(p[2],30)&&ok(p[3],30)
   ?[{name:p[0],active:p[2],substate:p[3]}]:[];
  return ok(p[1],30)?[{name:p[0],startup:p[1]}]:[];
 })).slice(0,200);
}
function windowsRecords(raw,kind){
 const value=JSON.parse(raw);
 const a=Array.isArray(value)?value:value===null?[]:[value];
 if(a.length>200)throw Error('BOUNDS');
 return ordered(a.flatMap(x=>{
  if(!x||typeof x!=='object'||Array.isArray(x))throw Error('NATIVE_RECORD');
  if(kind==='apps')return app.test(x.DisplayName??'')&&ok(x.DisplayName)
   ?[{name:x.DisplayName,version:/^[0-9][0-9A-Za-z.+-]{0,79}$/.test(x.DisplayVersion??'')?x.DisplayVersion:'UNKNOWN',
      publisher:/^(?:TandemVector Labs|Chat On Steroids|Remote Commander)$/i.test(x.Publisher??'')?x.Publisher:'UNKNOWN',
      installId:/^[A-Za-z0-9_.{}-]{1,80}$/.test(x.PSChildName??'')?x.PSChildName:'UNKNOWN'}]:[];
  if(kind==='tasks')return task.test(x.TaskName??'')&&ok(x.TaskName)
   ?[{name:x.TaskName,state:ok(x.State,30)?x.State:'UNKNOWN'}]:[];
  return processName.test(x.ProcessName??'')&&ok(x.ProcessName)?[{name:x.ProcessName}]:[];
 }));
}
const appScript=[
 "$keys=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
 '$a=@(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -match "Commander|Chat On Steroids"} | Select-Object DisplayName,DisplayVersion,Publisher,PSChildName)',
 'ConvertTo-Json -InputObject $a -Compress -Depth 3'].join(';');
const taskScript=[
 '$a=@(Get-ScheduledTask -ErrorAction Stop | Where-Object {$_.TaskName -match "Commander"} | ForEach-Object {[pscustomobject]@{TaskName=$_.TaskName;State=[string]$_.State}})',
 'ConvertTo-Json -InputObject $a -Compress -Depth 3'].join(';');
const processScript=[
 '$a=@(Get-Process -ErrorAction Stop | Where-Object {$_.ProcessName -match "Commander|Steroids|CoS"} | Select-Object ProcessName)',
 'ConvertTo-Json -InputObject $a -Compress -Depth 3'].join(';');
function probe(record,key,fn){try{record[key]={status:'OBSERVED',items:fn()};}
 catch{record[key]={status:'UNKNOWN',items:[]};}}
function localDir(home,rel){
 try{const st=fs.lstatSync(path.join(home,rel));
  return {label:rel,state:st.isSymbolicLink()?'ALIAS':st.isDirectory()?'DIRECTORY':'OTHER'};}
 catch(e){return {label:rel,state:e?.code==='ENOENT'?'ABSENT':'UNKNOWN'};}
}
export function collectV2InstallCollisionInventory({platform=process.platform,home=os.homedir(),
 exec=run,observedAt=new Date().toISOString(),includeLocations=true}={}){
 if(!['linux','win32'].includes(platform)||!(platform==='win32'?path.win32:path.posix).isAbsolute(home)||
   typeof exec!=='function'||!Number.isFinite(Date.parse(observedAt)))
  throw Error('V2_COLLISION_INVALID_ARGUMENT');
 const r={schema:1,scope:'NONSECRET_READ_ONLY_INSTALL_COLLISION',platform,observedAt,
  installedReplacementAccepted:false,cutoverAuthorized:false};
 let keys;
 if(platform==='linux'){
  keys=['packages','unitFiles','activeUnits'];
  probe(r,'packages',()=>linuxPackages(exec('dpkg-query',['-W','-f='+'$'+'{Package} '+'$'+'{Version}\n'])));
  probe(r,'unitFiles',()=>linuxUnits(exec('systemctl',['--user','list-unit-files','--type=service','--no-legend','--no-pager'])));
  probe(r,'activeUnits',()=>linuxUnits(exec('systemctl',['--user','list-units','--all','--plain','--no-legend','--no-pager']),true));
  if(includeLocations)r.locations=[
   '.local/share/ChatGPTRemoteCommander','.local/state/chatgpt-remote-commander',
   '.local/state/CommanderV2','.config/systemd/user'].map(x=>localDir(home,x));
 }else{
  keys=['apps','tasks','processes'];
  const ps=(s)=>exec('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command',s]);
  probe(r,'apps',()=>windowsRecords(ps(appScript),'apps'));
  probe(r,'tasks',()=>windowsRecords(ps(taskScript),'tasks'));
  probe(r,'processes',()=>windowsRecords(ps(processScript),'processes'));
 }
 r.completeness=keys.every(k=>r[k].status==='OBSERVED')?'OBSERVED':'INCOMPLETE';
 r.next='OWNER_ATTESTED_IDENTITY_AND_REVERSIBLE_CUTOVER_REQUIRED';
 r.observationDigest=createHash('sha256').update(JSON.stringify({
  platform,probes:keys.map(k=>r[k]),locations:r.locations??[]
 })).digest('hex');
 return r;
}
/** Read-only, authenticated owner follow-up required. A collision inventory is
 * never an authority to remove, update, elevate or migrate live V1/Browser. */
export function assessV2InstallCollision(inventory){
 if(!inventory||inventory.schema!==1||
   inventory.scope!=='NONSECRET_READ_ONLY_INSTALL_COLLISION'||
   !['linux','win32'].includes(inventory.platform))
  throw Error('V2_COLLISION_DECISION_SCHEMA_INVALID');
 const keys=inventory.platform==='linux'?
  ['packages','unitFiles','activeUnits']:['apps','tasks','processes'];
 if(keys.some(k=>!inventory[k]||typeof inventory[k]!=='object'||
   !['OBSERVED','UNKNOWN'].includes(inventory[k].status)||
   !Array.isArray(inventory[k].items)))
  throw Error('V2_COLLISION_DECISION_PROBE_INVALID');
 const fingerprint=createHash('sha256').update(JSON.stringify({
  platform:inventory.platform,
  probes:keys.map(k=>inventory[k]),
  locations:inventory.locations??[]
 })).digest('hex');
 if(fingerprint!==inventory.observationDigest)
  throw Error('V2_COLLISION_DECISION_OBSERVATION_CHANGED');
 const reasons=new Set();
 if(inventory.completeness!=='OBSERVED')reasons.add('INSTALL_DISCOVERY_INCOMPLETE');
 if(inventory.platform==='win32'){
  const apps=inventory.apps.items;
  if(apps.some(x=>/^(?:Commander V2|Chat On Steroids)/i.test(x.name)))
   reasons.add('EXISTING_V2_REGISTRATION');
  if(apps.some(x=>x.name==='Remote Commander'))
   reasons.add('EXISTING_V1_REGISTRATION');
  if(apps.some(x=>x.name==='Remote Commander Browser'))
   reasons.add('EXISTING_BROWSER_REGISTRATION');
  if(inventory.processes.items.some(x=>/^(?:Commander|Commander V2|Chat On Steroids|CoS)$/i.test(x.name)))
   reasons.add('ACTIVE_DESKTOP_PREVIEW_PROCESS');
  if(inventory.tasks.items.some(x=>/^(?:ChatGPTRemoteCommander|CommanderV2)/i.test(x.name)&&x.state==='Running'))
   reasons.add('ACTIVE_OWNER_SERVICE_TASK');
  if(inventory.tasks.items.some(x=>/ComputeOnly/i.test(x.name)))
   reasons.add('HEADLESS_COMPUTE_QUEUE_PRESENT');
 }else{
  if(inventory.packages.items.some(x=>x.name==='commander-v2'||x.name==='chat-on-steroids'))
   reasons.add('EXISTING_V2_PACKAGE');
  if(inventory.packages.items.some(x=>x.name==='chatgpt-remote-commander'||x.name==='remote-commander-browser'))
   reasons.add('EXISTING_V1_OR_BROWSER_PACKAGE');
  if(inventory.activeUnits.items.some(x=>x.name.startsWith('app-')&&x.active==='active'))
   reasons.add('ACTIVE_V2_DESKTOP_PREVIEW');
  if(inventory.activeUnits.items.some(x=>x.active==='active'&&
    /^(?:chatgpt-remote-commander|commander-|rc-cua-|rc-owner-|rc-private-)/i.test(x.name)))
   reasons.add('ACTIVE_V1_OR_OWNER_UNIT');
  if(inventory.locations?.some(x=>x.state==='ALIAS'||x.state==='UNKNOWN'))
   reasons.add('INSTALL_LOCATION_UNVERIFIED');
 }
 // Even a complete empty inventory has no evidence that rollback, user
 // sessions, credentials, GUI consent or the exact installer have been tested.
 reasons.add('OWNER_BACKUP_AND_ROLLBACK_UNVERIFIED');
 reasons.add('EXACT_INSTALLER_AND_IDENTITY_CUTOVER_UNVERIFIED');
 return Object.freeze({
  schema:1,platform:inventory.platform,observationDigest:fingerprint,
  status:inventory.completeness==='OBSERVED'?
   'BLOCKED_OWNER_MIGRATION_PROOF_REQUIRED':'BLOCKED_INSTALL_INVENTORY_INCOMPLETE',
  reasons:Object.freeze([...reasons].sort()),
  installedReplacementAccepted:false,
  oneInstallAccepted:false,
  canInstall:false,canUninstall:false,mayAlterExistingProfiles:false,
  next:'PRESERVE_ACTIVE_V1_AND_OWNER_BROWSER_SESSIONS_THEN_ATTEST_ROLLBACK'
 });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2&&!(process.argv.length===3&&process.argv[2]==='--readiness'))
   throw Error('V2_COLLISION_NO_ARGUMENTS');
  const r=collectV2InstallCollisionInventory();
  const result=process.argv.length===3?assessV2InstallCollision(r):r;
  process.stdout.write(JSON.stringify(result)+'\n');
  if(process.argv.length===3||r.completeness!=='OBSERVED')process.exitCode=3;
 }catch{process.stderr.write('V2_COLLISION_INVENTORY_ERROR\n');process.exitCode=2;}
}
