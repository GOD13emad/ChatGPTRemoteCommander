// Version-pinned owner-local preview migration R8 -> R9.
// Preserves existing profile/drafts and never touches V1 or another user.
// A recoverable local staging folder is retained if rollback is uncertain.
import {readFile,lstat,mkdir,rename,rm,copyFile,access,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
const FILES=Object.freeze(['server.mjs','desktop-app.mjs','local-evidence.mjs',
 'owner-seat-evidence.mjs','workflow-view.mjs','transport-evidence.mjs','owner-diagnostic-reader.mjs','app.js','app.css','index.html','README.md']);
const OLD_FILES=Object.freeze(FILES.filter(x=>x!=='owner-diagnostic-reader.mjs'));
const HEX=/^[a-f0-9]{64}$/;
const sha=buf=>createHash('sha256').update(buf).digest('hex');
async function plainFile(path){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>131072||st.size<1)
  throw Error('V2_UPGRADE_UNSAFE_FILE');
 return {bytes:await readFile(path),mode:st.mode};
}
async function digest(path){return sha((await plainFile(path)).bytes);}
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
const fail=code=>{throw Error(code);};
export async function upgradeOwnerWorkspace({source,destination,lockPath,afterMutation}={}){
 if(!source||!destination||!lockPath)fail('V2_UPGRADE_PATH_REQUIRED');
 if(resolve(source)===resolve(destination))fail('V2_UPGRADE_SAME_ROOT_DENIED');
 const input=JSON.parse((await plainFile(join(source,'MANIFEST.json'))).bytes.toString('utf8'));
 const prior=JSON.parse((await plainFile(join(source,'PREVIOUS_RELEASE.json'))).bytes.toString('utf8'));
 if(input.mode!=='LOCAL_GUI_PREVIEW_NO_PROMOTION'||!Array.isArray(input.files)||
   prior.schema!==1||prior.kind!=='COMMANDER_V2_WORKSPACE_PREVIOUS_RELEASE'||
   prior.previousArchiveSha256!=='cdea95fed64a736ba3a6dbd4f0b48a460709001a59ba06b82af174a5c583dbeb')
    fail('V2_UPGRADE_INVALID_MANIFEST');
 const map=new Map();
 for(const item of input.files){
  if(!item||typeof item.path!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(item.path)||
    map.has(item.path)||!HEX.test(item.sha256))fail('V2_UPGRADE_INVALID_MANIFEST');
  map.set(item.path,item.sha256);
 }
 if(FILES.some(name=>!map.has(name))||
  !prior.files||Object.keys(prior.files).length!==OLD_FILES.length||
  OLD_FILES.some(name=>!HEX.test(prior.files[name])))
   fail('V2_UPGRADE_INVALID_MANIFEST');
 // Validate all named future runtime files *before* touching an existing install.
 for(const name of FILES)
  if(await digest(join(source,name))!==map.get(name))fail('V2_UPGRADE_SOURCE_HASH_MISMATCH');
 const dir=await lstat(destination);
 if(!dir.isDirectory()||dir.isSymbolicLink())fail('V2_UPGRADE_DEST_UNTRUSTED');
 if(await exists(lockPath))fail('V2_UPGRADE_APP_RUNNING_OR_STALE_LOCK');
 // Only owner-authored R8 is acceptable; unknown local changes are never overwritten.
 let current=true;
 for(const name of FILES){
  if(!await exists(join(destination,name)) ||
      await digest(join(destination,name))!==map.get(name)){current=false;break;}
 }
 if(current)return Object.freeze({state:'ALREADY_CURRENT',changed:0});
 if(await exists(join(destination,'owner-diagnostic-reader.mjs')))
  fail('V2_UPGRADE_BASELINE_CHANGED');
 for(const name of OLD_FILES){
  if(!await exists(join(destination,name))||
     await digest(join(destination,name))!==prior.files[name])
   fail('V2_UPGRADE_BASELINE_CHANGED');
 }
 const stage=destination+'.upgrade-'+randomUUID().replaceAll('-','');
 await mkdir(stage,{mode:0o700});
 const changes=[];
 let restored=true;
 try {
  await mkdir(join(stage,'new'));
  await mkdir(join(stage,'old'));
  for(const name of FILES){
   await copyFile(join(source,name),join(stage,'new',name));
   if(await digest(join(stage,'new',name))!==map.get(name))
     fail('V2_UPGRADE_STAGING_HASH_MISMATCH');
  }
  if(await exists(lockPath))fail('V2_UPGRADE_APP_RUNNING_OR_STALE_LOCK');
  for(const name of FILES){
   const hadOld=await exists(join(destination,name));
   if(hadOld)await rename(join(destination,name),join(stage,'old',name));
   changes.push({name,hadOld,newWritten:false});
   await rename(join(stage,'new',name),join(destination,name));
   changes.at(-1).newWritten=true;
   await afterMutation?.(name);
  }
  for(const name of FILES){
   if(await digest(join(destination,name))!==map.get(name))
     fail('V2_UPGRADE_READBACK_MISMATCH');
  }
  let cleanup='CLEAN';
  try { await rm(stage,{recursive:true,force:true}); }
  catch { cleanup='PENDING'; }
  return Object.freeze({state:cleanup==='CLEAN'?'UPGRADED_R8_TO_R9':'UPGRADED_WITH_RECOVERY_STAGE',changed:FILES.length});
 }catch(e){
  for(const entry of changes.reverse()){
   try {
    if(entry.newWritten&&await exists(join(destination,entry.name))) {
      const at=join(destination,entry.name);
      if(await digest(at)!==map.get(entry.name)){restored=false;continue;}
      await rm(at);
    }
    if(entry.hadOld&&await exists(join(stage,'old',entry.name))) {
      await rename(join(stage,'old',entry.name),join(destination,entry.name));
    }
  }catch{restored=false;}
  }
  if(restored){await rm(stage,{recursive:true,force:true});throw e;}
  fail('V2_UPGRADE_ROLLBACK_UNCERTAIN_RECONCILE_STAGE_'+stage);
 }
}
if(process.argv[1] && fileURLToPath(import.meta.url).toLowerCase()===resolve(process.argv[1]).toLowerCase()){
 const os=process.platform,home=homedir();
 const destination=os==='win32'?join(home,'AppData','Local','CommanderV2','WorkspacePreview')
   :join(home,'.local','share','CommanderV2','WorkspacePreview');
 const lockPath=os==='win32'?join(destination,'app-instance.lock')
   :join(home,'.local','state','CommanderV2','WorkspacePreview','app-instance.lock');
 try{
  const result=await upgradeOwnerWorkspace({source:fileURLToPath(new URL('.',import.meta.url)),destination,lockPath});
  process.stdout.write(result.state+'\n');
 }catch(e){process.stderr.write((String(e.message).startsWith('V2_UPGRADE_')?e.message:'V2_UPGRADE_FAILED')+'\n');process.exitCode=2;}
}
