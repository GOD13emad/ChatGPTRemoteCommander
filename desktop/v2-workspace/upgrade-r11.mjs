// Commander V2 Workspace R11 — exact-source, reversible R9 preview upgrade.
// Intentionally unrelated to V1 Core updater, tunnels, accounts or WorkflowStore.
import {readFile,lstat,mkdir,copyFile,rename,rm,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const OLD_R9=Object.freeze({
 'server.mjs':'f7cefd19f05e5ea5b8414ca9a99d047601aec82d5607857911f245379e7f6990',
 'app.js':'d77e40b81fe43c2cc242e64a60ccd928eab757b7ea21173f99c66c35c205252b',
 'index.html':'fa334fe9af02ff3ce72642db509458055f5eebfde310fa252f3f2f5172f75533'
});
export const NEW_R11=Object.freeze({
 'server.mjs':'e4f728d0a1e84b7cfe13c2ab37fa1d77c20df46f45863a252dcd9ddbe0310cfc',
 'app.js':'85adb3f0fdfec7515b6f8e51e15e6e76fcc7f5d5210d78a8efd700b9501745cd',
 'index.html':'041f054872f56f48e0d015d25aa142238a082711958b73699f393df9f27f5029',
 'v1-runtime-bridge.mjs':'d7202ed33458fec5662b4b5591739e1c1ff8e139a506b6b7ac26a96e883b2e3a'
});
const REPLACED=Object.keys(OLD_R9);
const FILES=Object.keys(NEW_R11);
const digest=b=>createHash('sha256').update(b).digest('hex');
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function checkedFile(p){
 const f=await lstat(p);
 if(!f.isFile()||f.isSymbolicLink()||f.nlink!==1||f.size<1||f.size>200000)
  throw Error('R11_UNTRUSTED_FILE');
 return readFile(p);
}
async function fileSha(p){return digest(await checkedFile(p));}
async function safeDirectory(p){
 const d=await lstat(p);
 if(!d.isDirectory()||d.isSymbolicLink())throw Error('R11_UNTRUSTED_DIRECTORY');
 if(process.platform!=='win32'&&d.uid!==process.getuid())throw Error('R11_FOREIGN_OWNER');
}
export async function upgradeR11({source,destination,lockPath,afterMutation}={}){
 if(!source||!destination||!lockPath)throw Error('R11_REQUIRED_PATHS');
 if(resolve(source)===resolve(destination))throw Error('R11_SAME_SOURCE_DENIED');
 await safeDirectory(source);await safeDirectory(destination);
 if(await exists(lockPath))throw Error('R11_OWNER_APPLICATION_LOCKED');
 for(const name of FILES){
  if(await fileSha(join(source,name))!==NEW_R11[name])throw Error('R11_SOURCE_CHANGED');
 }
 // A previously successful exact upgrade is an idempotent no-op.
 let current=true;
 for(const name of FILES){
  if(!await exists(join(destination,name))||
     await fileSha(join(destination,name))!==NEW_R11[name]){current=false;break;}
 }
 if(current)return Object.freeze({state:'ALREADY_R11',changed:0});
 if(await exists(join(destination,'v1-runtime-bridge.mjs')))throw Error('R11_UNKNOWN_RUNTIME_BRIDGE');
 for(const name of REPLACED){
  if(!await exists(join(destination,name))||
     await fileSha(join(destination,name))!==OLD_R9[name])
    throw Error('R11_BASELINE_CHANGED');
 }
 const stage=join(destination,'.r11-transaction-'+randomUUID().replaceAll('-',''));
 await mkdir(stage,{mode:0o700});
 const changes=[];let recovered=true;
 try{
  for(const name of FILES){
   await copyFile(join(source,name),join(stage,'new-'+name));
   if(await fileSha(join(stage,'new-'+name))!==NEW_R11[name])
    throw Error('R11_STAGE_CHANGED');
  }
  if(await exists(lockPath))throw Error('R11_OWNER_APPLICATION_LOCKED');
  for(const name of FILES){
   const old=Object.hasOwn(OLD_R9,name);
   if(old&&await fileSha(join(destination,name))!==OLD_R9[name])
     throw Error('R11_BASELINE_CHANGED');
   if(!old&&await exists(join(destination,name)))throw Error('R11_UNKNOWN_RUNTIME_BRIDGE');
   const entry={name,old,installed:false};
   changes.push(entry);
   if(old)await rename(join(destination,name),join(stage,'old-'+name));
   await rename(join(stage,'new-'+name),join(destination,name));
   entry.installed=true;
   await afterMutation?.(name);
  }
  for(const name of FILES){
   if(await fileSha(join(destination,name))!==NEW_R11[name])throw Error('R11_READBACK_CHANGED');
  }
  await rm(stage,{recursive:true,force:true});
  return Object.freeze({state:'UPGRADED_R9_TO_R11',changed:FILES.length});
 }catch(e){
  for(const item of changes.reverse()){
   try{
    const target=join(destination,item.name);
    if(item.installed){
      if(await fileSha(target)!==NEW_R11[item.name]){recovered=false;continue;}
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
  else throw Error('R11_ROLLBACK_UNCERTAIN_RECONCILE_'+stage);
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
 if(!await nativeOwner()){process.stderr.write('R11_OWNER_SESSION_REQUIRED\n');process.exitCode=2;}
 else{
  const home=homedir(),source=fileURLToPath(new URL('.',import.meta.url));
  const destination=process.platform==='win32'
    ?join(home,'AppData','Local','CommanderV2','WorkspacePreview')
    :join(home,'.local','share','CommanderV2','WorkspacePreview');
  const lockPath=process.platform==='win32'
    ?join(destination,'app-instance.lock')
    :join(home,'.local','state','CommanderV2','WorkspacePreview','app-instance.lock');
  try{const result=await upgradeR11({source,destination,lockPath});process.stdout.write(result.state+'\n');}
  catch(e){process.stderr.write(String(e.message).startsWith('R11_')?e.message+'\n':'R11_FAILED\n');process.exitCode=2;}
 }
}
