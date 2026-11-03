// Commander V2 Workspace R18: bounded, reversible owner-local Local-AI read-only monitor upgrade.
// No core V1 mutation, no GUI takeover, no account tokens, no model inference/Worker execution.
import {readFile,lstat,mkdir,copyFile,rename,rm,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const OLD_R17=Object.freeze({
  'server.mjs':'3e355922417362c2326e719da715ae3265b417dabd3f00f02c3e22d4ccbb5389',
  'app.js':'89cd4fbfb441ffda7ea1844ef32bda61149b72bacff1cedcefd3870c513d20c2',
  'index.html':'041f054872f56f48e0d015d25aa142238a082711958b73699f393df9f27f5029'
});
export const NEW_R18=Object.freeze({
  'server.mjs':'65ced3f54f65e1d12a87387368be318068efd7f9f5b8321b8bfe94a092fb7f2c',
  'app.js':'89df65619cd29f5063e78d308b9ff5e4d17550d7a06a9a86698c81b2a06fc064',
  'index.html':'11e512eee5358f9482169fad6d813c08a5aafcf0271e0a5ea136f55d3135fee7',
  'local-model-evidence.mjs':'6e8fc0b469e91382e813422182915860a659d9b5aca2fe332e963ae3b81fa191'
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function ownerDir(p){
  const st=await lstat(p);
  if(!st.isDirectory()||st.isSymbolicLink()||(process.getuid&&st.uid!==process.getuid()))
    throw Error('R18_OWNER_DIRECTORY_UNVERIFIED');
}
async function digest(p){
  const st=await lstat(p);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<1||st.size>200000||
     (process.getuid&&st.uid!==process.getuid()))throw Error('R18_UNTRUSTED_FILE');
  return sha(await readFile(p));
}
export async function upgradeR18({source,destination,lockPath,afterMutation}={}){
  if(typeof source!=='string'||typeof destination!=='string'||typeof lockPath!=='string'||
     !source||!destination||!lockPath)throw Error('R18_PATHS_REQUIRED');
  if(resolve(source)===resolve(destination))throw Error('R18_SAME_ROOT_DENIED');
  await ownerDir(source);await ownerDir(destination);
  if(await exists(lockPath))throw Error('R18_OWNER_APP_LOCKED');
  for(const [name,pin] of Object.entries(NEW_R18))
    if(await digest(join(source,name))!==pin)throw Error('R18_SOURCE_CHANGED');
  const current=await Promise.all(Object.entries(NEW_R18).map(async([name,pin])=>
    await exists(join(destination,name)) && await digest(join(destination,name))===pin));
  if(current.every(Boolean))return Object.freeze({state:'ALREADY_R18',changed:0});
  // Never upgrade unrecognized V2 or an owner-modified preview install.
  for(const [name,pin] of Object.entries(OLD_R17)){
    if(!await exists(join(destination,name))||await digest(join(destination,name))!==pin)
      throw Error('R18_BASELINE_CHANGED');
  }
  if(await exists(join(destination,'local-model-evidence.mjs')))
    throw Error('R18_UNKNOWN_MODULE_PRESENT');
  const stage=join(destination,'.r18-transaction-'+randomUUID().replaceAll('-',''));
  await mkdir(stage,{mode:0o700});
  let recovered=true;const changes=[];
  try {
    for(const [name,pin] of Object.entries(NEW_R18)){
      await copyFile(join(source,name),join(stage,'new-'+name));
      if(await digest(join(stage,'new-'+name))!==pin)throw Error('R18_STAGE_CHANGED');
    }
    if(await exists(lockPath))throw Error('R18_OWNER_APP_LOCKED');
    for(const [name,pin] of Object.entries(NEW_R18)){
      const old=Object.hasOwn(OLD_R17,name),target=join(destination,name);
      if(old&&await digest(target)!==OLD_R17[name])throw Error('R18_BASELINE_CHANGED');
      if(!old&&await exists(target))throw Error('R18_UNKNOWN_MODULE_PRESENT');
      const entry={name,old,newInstalled:false};
      changes.push(entry);
      if(old)await rename(target,join(stage,'old-'+name));
      await rename(join(stage,'new-'+name),target);
      entry.newInstalled=true;
      await afterMutation?.(name);
    }
    for(const [name,pin] of Object.entries(NEW_R18))
      if(await digest(join(destination,name))!==pin)throw Error('R18_READBACK_CHANGED');
    await rm(stage,{recursive:true,force:true});
    return Object.freeze({state:'UPGRADED_R17_TO_R18',changed:4});
  }catch(error){
    for(const entry of changes.reverse()){
      try{
        const target=join(destination,entry.name);
        if(entry.newInstalled&&await exists(target)){
          if(await digest(target)!==NEW_R18[entry.name]){recovered=false;continue;}
          await unlink(target);
        }
        if(entry.old&&await exists(join(stage,'old-'+entry.name)))
          await rename(join(stage,'old-'+entry.name),target);
        else if(entry.old&&!await exists(target))recovered=false;
      }catch{recovered=false;}
    }
    if(recovered)await rm(stage,{recursive:true,force:true});
    else throw Error('R18_ROLLBACK_UNCERTAIN_RECONCILE_'+stage);
    throw error;
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
  if(!await nativeOwner()){
    process.stderr.write('R18_OWNER_SESSION_REQUIRED\n');process.exitCode=2;
  }else{
    const home=homedir(),source=fileURLToPath(new URL('.',import.meta.url));
    const dest=process.platform==='win32'?join(home,'AppData','Local','CommanderV2','WorkspacePreview'):
      join(home,'.local','share','CommanderV2','WorkspacePreview');
    const lock=process.platform==='win32'?join(dest,'app-instance.lock'):
      join(home,'.local','state','CommanderV2','WorkspacePreview','app-instance.lock');
    try{const result=await upgradeR18({source,destination:dest,lockPath:lock});console.log(result.state);}
    catch(error){console.error(String(error?.message).startsWith('R18_')?error.message:'R18_FAILED');process.exitCode=2;}
  }
}
