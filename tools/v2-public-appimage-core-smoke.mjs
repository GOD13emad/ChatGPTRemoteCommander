#!/usr/bin/env node
// Commander V2: published, pinned AppImage -> native Electron supervisor -> isolated V1 Core.
// Explicit smoke run only. No production credential, service, installer or GUI-owner access.
// Uses its own process group and private HOME/XDG/TMPDIR. Does not require sudo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const SHA='12f846b2df01b78ca6eb2f87835a988b5dbec77f88bdaed54f8211228e8cb1ef';
const QA_NAME='cmdv2-public-core-smoke-';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=code=>{throw Object.assign(new Error('V2_PUBLIC_CORE_'+code),{code});};
function ownerFile(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==process.getuid())
  fail('UNTRUSTED_APPIMAGE');
 return st;
}
async function digest(file){
 const hash=createHash('sha256');
 for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 return hash.digest('hex');
}
function processesInGroup(pgid){
 const lines=execFileSync('ps',['-eo','pid=,pgid=,uid=,comm='],{
  encoding:'utf8',timeout:2500,maxBuffer:1024*1024
 }).split(/\r?\n/);
 return lines.flatMap(line=>{
  const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  return match&&Number(match[2])===pgid?[{
   pid:Number(match[1]),pgid:Number(match[2]),uid:Number(match[3]),comm:match[4]
  }]:[];
 });
}
// Pure boundary helper: electron may use an absolute SingletonSocket path
// inside HOME/TMPDIR, while extracted AppImage libraries use relative links.
// Never authorize any path that resolves outside the exact private QA root.
export function isPrivateQaSymlinkTarget(root,dir,reference){
 const target=path.resolve(dir,reference);
 return target===root||target.startsWith(root+path.sep);
}
async function stopOwnedGroup(pgid){
 if(!Number.isSafeInteger(pgid)||pgid<2)return;
 for(const signal of ['SIGTERM','SIGKILL']){
  const members=processesInGroup(pgid);
  if(members.length===0)return;
  if(members.some(x=>x.uid!==process.getuid()))fail('FOREIGN_PROCESS_GROUP_MEMBER');
  try{process.kill(-pgid,signal)}catch(e){if(e?.code!=='ESRCH')throw e;}
  for(let i=0;i<15;i++){
   await sleep(100);
   if(processesInGroup(pgid).length===0)return;
  }
 }
 if(processesInGroup(pgid).length)fail('CHILD_CLEANUP_INCOMPLETE');
}
function readQaConfig(file,root){
 const stat=fs.lstatSync(file);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.uid!==process.getuid()||
    (stat.mode&0o077)!==0||stat.size>8192)fail('CORE_CONFIG_UNTRUSTED');
 const raw=fs.readFileSync(file,'utf8');
 const cfg=JSON.parse(raw);
 if(cfg.host!=='127.0.0.1'||cfg.instance?.profile!=='embedded-qa'||
    cfg.instance.isolated!==true||cfg.powerMode?.enabled!==false||
    cfg.powerMode?.fullFilesystem!==false||
    !Number.isInteger(cfg.port)||cfg.port<1025||cfg.port>65535||
    !Array.isArray(cfg.allowedRoots)||cfg.allowedRoots.length!==1||
    cfg.allowedRoots[0]!==path.join(root,'config','Commander V2','v1-core-isolated-qa','data'))
  fail('CORE_CONFIG_NOT_ISOLATED');
 return cfg.port;
}
async function probe(port){
 const base='http://127.0.0.1:'+port;
 try{
  const health=await fetch(base+'/health',{
   redirect:'error',signal:AbortSignal.timeout(900)});
  if(health.status!==200)return null;
  const body=await health.json();
  if(body.ok!==true||body.version!=='0.11.0-dev.23-capgap-qa')return null;
  const denied=await fetch(base+'/mcp',{method:'POST',redirect:'error',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),
   signal:AbortSignal.timeout(900)});
  if(denied.status!==401)fail('UNAUTHORIZED_MCP_NOT_DENIED');
  return Object.freeze({healthStatus:200,coreVersion:body.version,
   unauthenticatedMcpStatus:401});
 }catch(e){if(e?.code?.startsWith('V2_PUBLIC_CORE_'))throw e;return null;}
}
export async function smoke(){
 if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()===0)
  fail('NONROOT_LINUX_REQUIRED');
 const app=path.join(os.homedir(),'Downloads','CommanderV2-Branded-QA-20261105',
   'Commander-V2-Linux-x64.AppImage');
 ownerFile(app);
 if(await digest(app)!==SHA)fail('APPIMAGE_SHA_MISMATCH');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),QA_NAME));
 fs.chmodSync(root,0o700);
 const config=path.join(root,'config','Commander V2','v1-core-isolated-qa','config.json');
 for(const sub of ['home','config','data','cache','tmp'])
  fs.mkdirSync(path.join(root,sub),{mode:0o700});
 const log=fs.openSync(path.join(root,'launch.log'),'wx',0o600);
 let group=null,passed=null,cleanup=false;
 try{
  const env={PATH:process.env.PATH||'/usr/bin:/bin',LANG:process.env.LANG||'C.UTF-8',HOME:path.join(root,'home'),
   XDG_CONFIG_HOME:path.join(root,'config'),
   XDG_CACHE_HOME:path.join(root,'cache'),
   XDG_DATA_HOME:path.join(root,'data'),
   TMPDIR:path.join(root,'tmp'),
   TMP:path.join(root,'tmp'),TEMP:path.join(root,'tmp'),
   APPIMAGE_EXTRACT_AND_RUN:'1',
   COMMANDER_V2_EMBEDDED_CORE_QA:'isolated'};
  // A brand-new Unix process group is the only group the cleanup may signal.
  const child=spawn('xvfb-run',['-a','-s','-screen 0 1280x800x24',
   app,'--commander-v2-core-qa','--disable-gpu','--disable-dev-shm-usage'],{
   detached:true,env,stdio:['ignore',log,log],windowsHide:true
  });
  group=child.pid;
  if(!Number.isSafeInteger(group))fail('QA_LAUNCH_FAILED');
  let spawnError=null;
  child.once('error',e=>{spawnError=e;});
  for(let i=0;i<160;i++){
   if(spawnError)fail('QA_LAUNCH_FAILED');
   if(fs.existsSync(config)){
    const port=readQaConfig(config,root);
    passed=await probe(port);
    if(passed)break;
   }
   await sleep(125);
  }
  if(!passed)fail('CORE_HEALTH_OR_BEARER_UNVERIFIED');
 }finally{
  fs.closeSync(log);
  try{
   if(group!==null)await stopOwnedGroup(group);
   // Only delete our private mkdtemp directory after confirming no child group.
   const st=fs.lstatSync(root);
   if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||
      (st.mode&0o077)!==0)fail('QA_ROOT_UNTRUSTED');
   // AppImage libraries and Electron SingletonSocket create internal symlinks,
   // sometimes absolute but still entirely confined to our disposable root.
   // Never follow links during deletion; reject *any* resolved target outside
   // the uniquely created private QA root, regardless of reference form.
   const stack=[root];
   while(stack.length){
    const dir=stack.pop();
    for(const name of fs.readdirSync(dir)){
     const item=path.join(dir,name),st=fs.lstatSync(item);
     if(st.isSymbolicLink()){
      const reference=fs.readlinkSync(item);
      if(!isPrivateQaSymlinkTarget(root,dir,reference))
        fail('QA_SYMLINK_ESCAPE_REFUSED');
      continue;
     }
     if(st.isDirectory())stack.push(item);
    }
   }
   fs.rmSync(root,{recursive:true,force:false,maxRetries:4,retryDelay:125});
   cleanup=!fs.existsSync(root);
  }catch(e){
   if(passed)throw e;
   fail('QA_CLEANUP_UNCERTAIN');
  }
 }
 if(!cleanup)fail('QA_CLEANUP_UNCERTAIN');
 return Object.freeze({gate:'PUBLISHED_APPIMAGE_ISOLATED_CORE_QA_PASS',
  appimageSha256:SHA,...passed,privateProfile:true,installed:false,
  administratorGranted:false,chatAccountAuthenticated:false,
  v1ServiceModified:false,cleanupVerified:true});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2){process.stderr.write('V2_PUBLIC_CORE_QA_NO_ARGUMENTS\n');process.exitCode=2;}
 else smoke().then(r=>process.stdout.write(JSON.stringify(r)+'\n'))
  .catch(e=>{process.stderr.write(String(e?.message||'V2_PUBLIC_CORE_QA_FAILED')+'\n');process.exitCode=2;});
}
