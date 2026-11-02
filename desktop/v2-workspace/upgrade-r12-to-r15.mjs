// Commander V2 Workspace R15 — exact-source, reversible R12 owner preview upgrade.
// Intentionally unrelated to V1 Core updater, tunnels, accounts or WorkflowStore.
import {readFile,lstat,mkdir,copyFile,rename,rm,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const OLD_R12=Object.freeze({
 'server.mjs':'e4f728d0a1e84b7cfe13c2ab37fa1d77c20df46f45863a252dcd9ddbe0310cfc',
 'app.js':'ddac83d0d1b991e93fd863a863f4b0ccfa3510558b01eb7c5e6d83fb955c778e',
 'v1-runtime-bridge.mjs':'4e5d6c74c84363e1611e0ede1ad876c8ff198f28a2dc611986785805ab660f49'
});
export const NEW_R15=Object.freeze({
 'server.mjs':'3e355922417362c2326e719da715ae3265b417dabd3f00f02c3e22d4ccbb5389',
 'app.js':'5901d28ccf774f2a8ab6a3317e8be63bdddc599e318349673bbbea55b48b1b29',
 'v1-runtime-bridge.mjs':'5ad4f272a1ca932742bf16532b972480338345a65125098aec256bd0dc0085e9',
 'continuation-handoff.mjs':'ef01463bec1a87104436c4b6e66b0766f862b3ad38e63e0d7016403f67420166'
});
const REPLACED=Object.keys(OLD_R12);
const FILES=Object.keys(NEW_R15);
const digest=b=>createHash('sha256').update(b).digest('hex');
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function checkedFile(p){
 const f=await lstat(p);
 if(!f.isFile()||f.isSymbolicLink()||f.nlink!==1||f.size<1||f.size>200000)
  throw Error('R15_UNTRUSTED_FILE');
 return readFile(p);
}
async function fileSha(p){return digest(await checkedFile(p));}
async function safeDirectory(p){
 const d=await lstat(p);
 if(!d.isDirectory()||d.isSymbolicLink())throw Error('R15_UNTRUSTED_DIRECTORY');
 if(process.platform!=='win32'&&d.uid!==process.getuid())throw Error('R15_FOREIGN_OWNER');
}
export async function upgradeR12ToR15({source,destination,lockPath,afterMutation}={}){
 if(!source||!destination||!lockPath)throw Error('R15_REQUIRED_PATHS');
 if(resolve(source)===resolve(destination))throw Error('R15_SAME_SOURCE_DENIED');
 await safeDirectory(source);await safeDirectory(destination);
 if(await exists(lockPath))throw Error('R15_OWNER_APPLICATION_LOCKED');
 for(const name of FILES){
  if(await fileSha(join(source,name))!==NEW_R15[name])throw Error('R15_SOURCE_CHANGED');
 }
 // A previously successful exact upgrade is an idempotent no-op.
 let current=true;
 for(const name of FILES){
  if(!await exists(join(destination,name))||
     await fileSha(join(destination,name))!==NEW_R15[name]){current=false;break;}
 }
 if(current)return Object.freeze({state:'ALREADY_R15',changed:0});
 if(await exists(join(destination,'continuation-handoff.mjs')))throw Error('R15_UNKNOWN_CONTINUATION_MODULE');
 for(const name of REPLACED){
  if(!await exists(join(destination,name))||
     await fileSha(join(destination,name))!==OLD_R12[name])
    throw Error('R15_BASELINE_CHANGED');
 }
 const stage=join(destination,'.r12r15-transaction-'+randomUUID().replaceAll('-',''));
 await mkdir(stage,{mode:0o700});
 const changes=[];let recovered=true;
 try{
  for(const name of FILES){
   await copyFile(join(source,name),join(stage,'new-'+name));
   if(await fileSha(join(stage,'new-'+name))!==NEW_R15[name])
    throw Error('R15_STAGE_CHANGED');
  }
  if(await exists(lockPath))throw Error('R15_OWNER_APPLICATION_LOCKED');
  for(const name of FILES){
   const old=Object.hasOwn(OLD_R12,name);
   if(old&&await fileSha(join(destination,name))!==OLD_R12[name])
     throw Error('R15_BASELINE_CHANGED');
   if(!old&&await exists(join(destination,name)))throw Error('R15_UNKNOWN_RUNTIME_BRIDGE');
   const entry={name,old,installed:false};
   changes.push(entry);
   if(old)await rename(join(destination,name),join(stage,'old-'+name));
   await rename(join(stage,'new-'+name),join(destination,name));
   entry.installed=true;
   await afterMutation?.(name);
  }
  for(const name of FILES){
   if(await fileSha(join(destination,name))!==NEW_R15[name])throw Error('R15_READBACK_CHANGED');
  }
  await rm(stage,{recursive:true,force:true});
  return Object.freeze({state:'UPGRADED_R12_TO_R15',changed:FILES.length});
 }catch(e){
  for(const item of changes.reverse()){
   try{
    const target=join(destination,item.name);
    if(item.installed){
      if(await fileSha(target)!==NEW_R15[item.name]){recovered=false;continue;}
      await unlink(target);
    }
    if(item.old){
      const backup=join(stage,'old-'+item.name);
      if(await exists(backup))await rename(backup,target);
      else if(!await exists(target))recovered=false;
    }
   }catch{recovered=false;}
  }
  if(recovered)await rm(stage,{recursive:true,force:true});
  else throw Error('R15_ROLLBACK_UNCERTAIN_RECONCILE_'+stage);
  throw e;
 }
}
async function nativeOwner(){
 if(process.platform!=='win32')return process.getuid?.()!==0;
 try{
  const actual=execFileSync('whoami',[],{encoding:'utf8',timeout:2000,windowsHide:true}).trim().toLowerCase();
  return Boolean(actual)&&!['nt authority\\system','nt authority\\local service','nt authority\\network service'].includes(actual);
 }catch{return false;}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!await nativeOwner()){process.stderr.write('R15_OWNER_SESSION_REQUIRED\n');process.exitCode=2;}
 else{
  const home=homedir(),source=fileURLToPath(new URL('.',import.meta.url));
  const destination=process.platform==='win32'
    ?join(home,'AppData','Local','CommanderV2','WorkspacePreview')
    :join(home,'.local','share','CommanderV2','WorkspacePreview');
  const lockPath=process.platform==='win32'
    ?join(destination,'app-instance.lock')
    :join(home,'.local','state','CommanderV2','WorkspacePreview','app-instance.lock');
  try{const result=await upgradeR12ToR15({source,destination,lockPath});process.stdout.write(result.state+'\n');}
  catch(e){process.stderr.write(String(e.message).startsWith('R15_')?e.message+'\n':'R15_FAILED\n');process.exitCode=2;}
 }
}
