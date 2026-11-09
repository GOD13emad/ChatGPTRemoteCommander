#!/usr/bin/env node
// Owner-only, read-only R0 companion to v2-enrollment-census.mjs.
// A missing conventional .key does not imply the live systemd unit lacks a
// credential provider. Never read YAML, .key, env-file or secret values.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function fail(code){throw Object.assign(new Error(code),{code});}
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UNIT=/^[A-Za-z0-9_.@\\-]+\.service$/;
export function assessV2LinuxCredentialBindings({profileNames,keyStems,processes}={}){
 if(!Array.isArray(profileNames)||!Array.isArray(keyStems)||
    !Array.isArray(processes)||profileNames.length>100||keyStems.length>100||
    processes.length>100||profileNames.some(n=>typeof n!=='string'||!NAME.test(n))||
    keyStems.some(n=>typeof n!=='string'||!NAME.test(n))||
    new Set(profileNames).size!==profileNames.length||
    new Set(keyStems).size!==keyStems.length)
  fail('V2_PROVIDER_CENSUS_INVALID_INPUT');
 for(const p of processes)if(!p||typeof p.profile!=='string'||!NAME.test(p.profile)||
   typeof p.active!=='boolean'||typeof p.serviceActive!=='boolean'||
   typeof p.ownerService!=='boolean'||typeof p.hasEnvironmentFile!=='boolean'||
   typeof p.hasLoadCredential!=='boolean')
  fail('V2_PROVIDER_CENSUS_INVALID_PROCESS');
 const keys=new Set(keyStems),out={matched:0,missing:0,
  missingWithLiveOwnerProcess:0,missingWithActiveSystemdProvider:0,
  missingWithoutProviderEvidence:0,providerProof:'METADATA_ONLY',
  credentialUsability:'NOT_TESTED',safeForAutomaticMigration:false};
 for(const p of profileNames){
  if(keys.has(p)){out.matched++;continue;}
  out.missing++;
  const related=processes.filter(x=>x.profile===p&&x.active);
  if(related.length)out.missingWithLiveOwnerProcess++;
  if(related.some(x=>x.ownerService&&x.serviceActive&&
       (x.hasEnvironmentFile||x.hasLoadCredential)))
    out.missingWithActiveSystemdProvider++;
  else out.missingWithoutProviderEvidence++;
 }
 return Object.freeze({schema:1,scope:'ONE_OS_USER_NOT_WHOLE_HOST',...out});
}
function ownedDirNames(dir,suffix){
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid())
   fail('V2_PROVIDER_CENSUS_UNTRUSTED_DIRECTORY');
 const list=fs.readdirSync(dir,{withFileTypes:true});
 if(list.some(x=>x.isSymbolicLink()))fail('V2_PROVIDER_CENSUS_SYMLINK');
 return list.filter(x=>x.isFile()&&x.name.endsWith(suffix))
  .map(x=>x.name.slice(0,-suffix.length));
}
function systemdBinding(unit){
 if(typeof unit!=='string'||!UNIT.test(unit))return null;
 let data;
 try{data=execFileSync('systemctl',['--user','show',unit,
  '--property=ActiveState,EnvironmentFiles,LoadCredential'],
  {encoding:'utf8',timeout:3000,maxBuffer:16384});}
 catch{return null;}
 const m=Object.fromEntries(data.split('\n').filter(x=>x.includes('='))
    .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
 return {serviceActive:m.ActiveState==='active',
  hasEnvironmentFile:Boolean(m.EnvironmentFiles?.trim()),
  hasLoadCredential:Boolean(m.LoadCredential?.trim())};
}
export function collectV2LinuxCredentialBindings({home=os.homedir()}={}){
 if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()===0)
  fail('V2_PROVIDER_CENSUS_OWNER_LINUX_ONLY');
 if(typeof home!=='string'||!path.isAbsolute(home))
  fail('V2_PROVIDER_CENSUS_HOME_INVALID');
 const profileNames=ownedDirNames(path.join(home,'.config','tunnel-client'),'.yaml');
 const keyStems=ownedDirNames(path.join(home,'.config',
  'chatgpt-remote-commander','credentials'),'.key');
 const processes=[];
 for(const ent of fs.readdirSync('/proc',{withFileTypes:true})){
  if(!ent.isDirectory()||!/^\d+$/.test(ent.name))continue;
  const dir='/proc/'+ent.name;
  try{
   if(fs.readFileSync(dir+'/comm','utf8').trim()!=='tunnel-client')continue;
   const args=fs.readFileSync(dir+'/cmdline').toString('utf8').split('\0').filter(Boolean);
   const at=args.indexOf('--profile');
   if(at<0||at+1>=args.length||!NAME.test(args[at+1]))continue;
   // Never inspect /proc/<pid>/environ or credentials. Cgroup ownership
   // merely identifies a native service, not proof of provider usability.
   const cgroup=fs.readFileSync(dir+'/cgroup','utf8');
   const units=[...cgroup.matchAll(/(?:^|\/)([A-Za-z0-9_.@\\-]+\.service)(?:\/|$)/gm)]
     .map(x=>x[1]);
   const providers=units.map(systemdBinding).filter(Boolean);
   processes.push({profile:args[at+1],active:true,ownerService:providers.length>0,
    serviceActive:providers.some(x=>x.serviceActive),
    hasEnvironmentFile:providers.some(x=>x.serviceActive&&x.hasEnvironmentFile),
    hasLoadCredential:providers.some(x=>x.serviceActive&&x.hasLoadCredential)});
  }catch(e){if(!['ENOENT','ESRCH','EACCES','EPERM'].includes(e?.code))
    fail('V2_PROVIDER_CENSUS_PROCESS_UNREADABLE');}
 }
 return assessV2LinuxCredentialBindings({profileNames,keyStems,processes});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{if(process.argv.length!==2)fail('V2_PROVIDER_CENSUS_ARGUMENTS_INVALID');
  process.stdout.write(JSON.stringify(collectV2LinuxCredentialBindings())+'\n');
 }catch(e){process.stderr.write((String(e?.code||'').startsWith('V2_PROVIDER_CENSUS_')
   ?e.code:'V2_PROVIDER_CENSUS_FAILED')+'\n');process.exitCode=2;}
}
