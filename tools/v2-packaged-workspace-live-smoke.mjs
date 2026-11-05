#!/usr/bin/env node
// Pinned Commander V2 native *packaged* Workspace -> actual owner V1 read-only UI backend.
// Never installs, reads browser credentials, grants a ChatGPT session, or sends a V1 tool mutation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const SHA=Object.freeze({
 publishedManifest:'7512cbc77ed07281864355184da1db1a9d89c00321d50c77bf50b6216e2b9e2a',
 readonlyFixManifest:'1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64',
 server:'95ea301d60763875e246a47566d06e856bb4d0a64763d2c7612845093705fb6b'
});
const error=s=>Object.assign(new Error('CMDV2_WORKSPACE_NATIVE_QA_'+s),{code:'CMDV2_WORKSPACE_NATIVE_QA_'+s});
function bytes(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>32768)throw error('FILE_UNTRUSTED');
 return fs.readFileSync(file);
}
function sha(b){return createHash('sha256').update(b).digest('hex');}
function source(candidate=false){
 const base=process.platform==='win32'
  ?path.join(process.env.LOCALAPPDATA||'', 'CommanderV2','QA','official-cos-tag2150-sparse-20261104')
  :path.join(os.homedir(),'.local','state','CommanderV2','QA','cos2150-unified-rebuild-20261104');
 if(!path.isAbsolute(base)||!['linux','win32'].includes(process.platform))
  throw error('PLATFORM_UNSUPPORTED');
 if(bytes(path.join(base,'.commander-v2-isolated-qa')).toString('utf8')!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')
  throw error('NOT_ISOLATED_QA');
 const output=candidate?'commander-v2-readonlyfix-qa':'commander-v2-authqa';
 const baseDir=path.join(base,'release',output,
  process.platform==='win32'?'win-unpacked':'linux-unpacked',
  'resources','commander-v2-workspace');
 const manifest=path.join(baseDir,'MANIFEST.json'),server=path.join(baseDir,'server.mjs');
 if(sha(bytes(manifest))!==(candidate?SHA.readonlyFixManifest:SHA.publishedManifest)||sha(bytes(server))!==SHA.server)
  throw error('PACKAGED_SOURCE_CHANGED');
 return server;
}
function exactPrivateUrl(url,token,port){
 const u=new URL(url);
 return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port===String(port)&&
 u.pathname==='/'&&!u.search&&u.hash==='#'+token&&
 typeof token==='string'&&/^[a-f0-9]{48}$/.test(token);
}
export function checkV2ReadOnlyWorkspace({unauth,invalid,allowed,status,action,
 runtime,control}={}){
 if(unauth!==403||invalid!==403||allowed!==200||status!==200||action!==405)
  throw error('HTTP_AUTH_OR_METHOD_GUARD_FAILED');
 if(!runtime||!['LIVE_READ_ONLY','DEGRADED_READ_ONLY'].includes(runtime.state)||
  runtime.source!=='V1_LOCAL_CORE'||runtime.transport!=='LOCAL_LOOPBACK'||
  runtime.identityBasis!=='LOCAL_PROFILE_LABEL_NOT_AUTHENTICATION'||
  runtime.selectedProfile!=='default'||runtime.canExecute!==false||
  runtime.core?.version!=='0.11.0-dev.23'||
  !Number.isInteger(runtime.toolCount)||runtime.toolCount<50||runtime.toolCount>200||
  !runtime.gui||typeof runtime.gui.available!=='boolean'||
  !runtime.browser||typeof runtime.browser.available!=='boolean'||
  !control||control.auth!=='NOT_ENROLLED'||control.mode!=='READ_ONLY_GUI_PREVIEW'||
  control.workflow!=='NOT_CONNECTED'||control.gui!=='NOT_CONNECTED'||
  control.browser!=='NOT_CONNECTED')
  throw error('LIVE_READ_ONLY_OR_IDENTITY_UNVERIFIED');
 return Object.freeze({
  gate:'COMMANDER_V2_PACKAGED_WORKSPACE_V1_LIVE_READONLY_QA_PASS',
  source:'PINNED_ELECTRON_RESOURCE',
  platform:process.platform,
  v1Version:runtime.core.version,toolCount:runtime.toolCount,
  backendState:runtime.state,
  guiReadAvailable:runtime.gui.available,
  browserReadAvailable:runtime.browser.available,
  browserCurrentlyActive:runtime.browser.active===true,
  identityBasis:'OWNER_LOCAL_PROFILE_NOT_CHAT_AUTH',
  chatAuthenticated:false,canExecute:false,
  liveV1Touched:false,installed:false
 });
}
async function postStatus(host,port,token){
 return await new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:'/api/status',method:'POST',
   timeout:1500,headers:{Host:host,'X-Commander-Workspace-Token':token}},res=>{
   res.resume();res.once('end',()=>resolve(res.statusCode));
  });
  req.once('timeout',()=>req.destroy(error('HTTP_TIMEOUT')));
  req.once('error',reject);
  req.end();
 });
}
export async function verify({candidate=false}={}){
 if(process.platform==='linux'&&process.getuid?.()===0)
  throw error('NONROOT_REQUIRED');
 if(typeof candidate!=='boolean')throw error('MODE_INVALID');
 const f=source(candidate);
 const {createWorkspace}=await import(pathToFileURL(f).href);
 const w=await createWorkspace({port:0});
 try{
  if(!Number.isInteger(w.port)||w.port<1025||w.port>65535||!exactPrivateUrl(w.url,w.token,w.port))
   throw error('PRIVATE_BINDING_UNVERIFIED');
  const uri='http://127.0.0.1:'+w.port;
  const request=(s,token)=>fetch(uri+s,{method:'GET',redirect:'error',
   headers:token===undefined?{}:{'X-Commander-Workspace-Token':token},
   signal:AbortSignal.timeout(6000)});
  const [unauth,invalid,allowed,status,action]=await Promise.all([
   request('/api/v1-runtime'),
   request('/api/v1-runtime','0'.repeat(48)),
   request('/api/v1-runtime',w.token),
   request('/api/status',w.token),
   postStatus('127.0.0.1:'+w.port,w.port,w.token)
  ]);
  const runtime=allowed.status===200?await allowed.json():null;
  const control=status.status===200?await status.json():null;
  if(process.env.CMDV2_WORKSPACE_QA_DIAGNOSTIC==='1'){
   // Only type-safe nonsecret booleans and fixed status enum values.
   process.stderr.write('CMDV2_SANITIZED_STATUS '+JSON.stringify({
    unauth:unauth.status,invalid:invalid.status,allowed:allowed.status,
    status:status.status,action,backendState:runtime?.state,
    source:runtime?.source,selectedDefaultProfile:runtime?.selectedProfile==='default',
    identityBasis:runtime?.identityBasis,
    version:runtime?.core?.version,toolCount:runtime?.toolCount,
    canExecute:runtime?.canExecute,
    probeStates:runtime?.probes,
    guiVerified:typeof runtime?.gui?.available==='boolean',
    browserVerified:typeof runtime?.browser?.available==='boolean',
    authStatus:control?.auth,mode:control?.mode,
    workflow:control?.workflow,guiStatus:control?.gui,
    browserStatus:control?.browser
   })+'\n');
  }
  return checkV2ReadOnlyWorkspace({
   unauth:unauth.status,invalid:invalid.status,
   allowed:allowed.status,status:status.status,action,runtime,control
  });
 }finally{
  w.server.closeAllConnections();
  await new Promise(resolve=>w.server.close(resolve));
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>3||(process.argv.length===3&&process.argv[2]!=='--candidate')){
  process.stderr.write('CMDV2_WORKSPACE_NATIVE_QA_INVALID_ARGUMENTS\n');process.exitCode=2;
 }else verify({candidate:process.argv.length===3})
  .then(x=>process.stdout.write(JSON.stringify({...x,candidate:process.argv.length===3})+'\n'))
  .catch(e=>{process.stderr.write(String(e?.code??'CMDV2_WORKSPACE_NATIVE_QA_FAILED')+'\n');process.exitCode=2;});
}
