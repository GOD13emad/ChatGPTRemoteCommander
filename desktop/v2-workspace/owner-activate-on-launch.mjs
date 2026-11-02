// Owner-account on-launch R6->R7 migration. Does not stop another app or
// run as SYSTEM. The existing Start Menu shortcut invokes it only when clicked.
// No background worker, service, registry Run key or privilege change.
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const sha=x=>createHash('sha256').update(x).digest('hex');
const pin=Object.freeze({
 'server.mjs':'0ff9ddf2bb500ce23064ff8c2b380d827bd2a21c906ff9c6390fac220f5d3cda',
 'desktop-app.mjs':'a31b56a90f8e25b37e42af46a4f4391a3e7ad91840cffa7a123329d4e0ef813c',
 'local-evidence.mjs':'3e886c45696210cad9b3273ffcd7b06d3b1c108c73fa835a1af2215cbae005e4',
 'owner-seat-evidence.mjs':'b36807a7f768cd728188cf623935460b59ddd332c4fa09c8e0bdcf04371daa04',
 'workflow-view.mjs':'75820dfff9e1d72c0e99d6c2df4fa9e564a0e8383e0675999ad4ab8746bccc32',
 'app.js':'a7e0a6b5194bc37200973b92121ec793ec5e340b2d7b92b67e82a22be0aa4c83',
 'app.css':'8cbf599b5cc33a6e7784df7c0e105f7d98197550de6a1b9d60eae34ab94e76a9',
 'index.html':'0fbb6e2afc3f6a34eede5387263d9afb7ca618a81e3f4f1cf82a73bbab7d57ff',
 'README.md':'3d2d2e1fc270c5e9e325d0e1f1a5605ae9d2ae3daef4d2753e77932eb6b92cce'
});
const manifestSha='363c7982ad5c38fa9f33583b9405498e2a51055c8067092171e4ef65587e093a';
const zipSha='29b7348051678832f57936f727f48a934b68c09d4ae727585d2b914bb7b476e2';
const upgradeSha='8043ab93f909f81b7490e98b94a0a5db34062000dfd38c6c72c006c9925f403a';
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function safeFile(file,max=131072){
 const s=await lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>max)
  fail('V2_R7_OWNER_FILE_UNSAFE');
 return readFile(file);
}
async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function matches(root){
 for(const [name,digest] of Object.entries(pin)){
  if(!await exists(join(root,name))||sha(await safeFile(join(root,name)))!==digest)return false;
 }
 return true;
}
async function stageTrusted(stage,archive){
 if(sha(await safeFile(archive,131072))!==zipSha)fail('V2_R7_ARCHIVE_UNTRUSTED');
 const raw=await safeFile(join(stage,'MANIFEST.json'));
 if(sha(raw)!==manifestSha)fail('V2_R7_MANIFEST_UNTRUSTED');
 const data=JSON.parse(raw.toString('utf8'));
 if(data.mode!=='LOCAL_GUI_PREVIEW_NO_PROMOTION'||!Array.isArray(data.files))
  fail('V2_R7_MANIFEST_UNTRUSTED');
 for(const [name,digest] of Object.entries(pin)){
  if(data.files.filter(x=>x.path===name&&x.sha256===digest).length!==1)
   fail('V2_R7_MANIFEST_UNTRUSTED');
  if(sha(await safeFile(join(stage,name)))!==digest)
   fail('V2_R7_STAGED_FILE_CHANGED');
 }
 if(data.files.filter(x=>x.path==='upgrade-user.mjs'&&x.sha256===upgradeSha).length!==1
  ||sha(await safeFile(join(stage,'upgrade-user.mjs')))!==upgradeSha)
   fail('V2_R7_UPDATER_UNTRUSTED');
}
export async function activateOwnerR7({runtime,stage,archive,lockPath,launch}={}){
 if(!runtime||!stage||!archive||!lockPath||typeof launch!=='function')
  fail('V2_R7_OWNER_BOOTSTRAP_REQUIRED');
 if(await exists(lockPath))return Object.freeze({state:'OWNER_APP_CURRENTLY_RUNNING',started:false});
 if(await matches(runtime)){
  await launch(runtime);
  return Object.freeze({state:'R7_ALREADY_CURRENT_AND_LAUNCHED',started:true});
 }
 // Before executing any staged JS, prove the exact accepted R7 archive,
 // immutable manifest and updater match the pinned release bits.
 await stageTrusted(stage,archive);
 const spec=pathToFileURL(join(stage,'upgrade-user.mjs')).href;
 const {upgradeOwnerWorkspace}=await import(spec);
 const result=await upgradeOwnerWorkspace({source:stage,destination:runtime,lockPath});
 if(!['UPGRADED_R6_TO_R7','ALREADY_CURRENT'].includes(result.state))
  fail('V2_R7_UPGRADE_UNVERIFIED');
 if(!await matches(runtime))fail('V2_R7_INSTALLED_RUNTIME_CHANGED');
 await launch(runtime);
 return Object.freeze({state:'R7_UPGRADED_AND_LAUNCHED',started:true});
}
function spawnOwnerApp(root){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[join(root,'desktop-app.mjs')],
   {cwd:root,detached:true,stdio:'ignore',windowsHide:false});
  child.once('error',reject);
  child.once('spawn',()=>{child.unref();resolve();});
 });
}
if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
 const home=homedir();
 const runtime=join(home,'AppData','Local','CommanderV2','WorkspacePreview');
 const stage=join(home,'Downloads','CommanderV2-Workspace-App-R7');
 const archive=join(home,'Downloads','CommanderV2-Workspace-App-R7.zip');
 const lockPath=join(runtime,'app-instance.lock');
 // The bootstrap must be invoked from the current owner's installed path.
 if(process.platform!=='win32'||resolve(dirname(fileURLToPath(import.meta.url))).toLowerCase()!==resolve(runtime).toLowerCase()){
  process.stderr.write('V2_R7_OWNER_INTERACTIVE_PATH_REQUIRED\n');
  process.exitCode=2;
 }else{
  try{const status=await activateOwnerR7({runtime,stage,archive,lockPath,launch:spawnOwnerApp});
    process.stdout.write(status.state+'\n');
  }catch(error){process.stderr.write(String(error?.code||'V2_R7_ACTIVATION_FAILED')+'\n');process.exitCode=2;}
 }
}
