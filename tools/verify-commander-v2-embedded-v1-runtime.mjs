#!/usr/bin/env node
// Explicit, isolated functional QA for V1 Core INSIDE the Commander V2 executable.
// Uses ELECTRON_RUN_AS_NODE and separate loopback port/config. No active service install or takeover.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=k=>{throw Error('COMMANDER_V2_EMBEDDED_CORE_QA_'+k)};
const sleep=t=>new Promise(r=>setTimeout(r,t));
const EXPECTED={linux:{manifest:'c6c64886301c427bae8b8934304eaf82ee6382fefc01aee8e013e0745c4f1306',server:'d62c98fd122b3492aac678593f5181ba765820f8383b68c365487338501e0219'},win32:{manifest:'aff379a6ffccbf6e0837d2dcf01415283b0a44205ce4aece6b19cfe914a4c923',server:'dda3d17ebf62f16315f494a9160402cd8a040fba7f93400a3f9310565fc201ad'}};
function file(f){const s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('SOURCE_FILE_NOT_REGULAR');return fs.readFileSync(f)}
function directory(d){const s=fs.lstatSync(d);if(!s.isDirectory()||s.isSymbolicLink())fail('SOURCE_DIRECTORY_NOT_REGULAR')}
function preflight(root){
 if(typeof root!=='string'||!path.isAbsolute(root)||!Object.hasOwn(EXPECTED,process.platform))fail('UNSUPPORTED_PLATFORM_OR_PATH');
 const base=path.resolve(root);
 const platformDir=process.platform==='win32'?'win-unpacked':'linux-unpacked';
 if(path.basename(base)!==platformDir||path.basename(path.dirname(base))!=='commander-v2-qa')fail('QA_PRODUCT_DIRECTORY');
 const parent=path.dirname(path.dirname(path.dirname(base)));
 if(path.basename(parent)!==(process.platform==='win32'?'official-cos-tag2150-sparse-20261104':'cos2150-unified-rebuild-20261104'))fail('QA_SOURCE_DIRECTORY');
 directory(parent);directory(base);
 if(file(path.join(parent,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('QA_MARKER_REQUIRED');
 const res=path.join(base,'resources','commander-v1-core');
 directory(res);directory(path.join(res,'src'));
 if(sha(file(path.join(res,'MANIFEST.json')))!==EXPECTED[process.platform].manifest)fail('PINNED_BUNDLE_MANIFEST_CHANGED');
 const manifest=JSON.parse(file(path.join(res,'MANIFEST.json')));
 if(manifest.mode!=='QA_INTERNAL_NOT_ACTIVATED'||manifest.files?.length!==75||manifest.serverSha!==EXPECTED[process.platform].server)fail('SOURCE_MODE_OR_VERSION_CHANGED');
 if(sha(file(path.join(res,'src','server-v0.3.mjs')))!==EXPECTED[process.platform].server)fail('EMBEDDED_SERVER_CHANGED');
 const binary=path.join(base,process.platform==='win32'?'Commander V2.exe':'commander-v2');
 if(!fs.lstatSync(binary).isFile())fail('ELECTRON_EXECUTABLE_MISSING');
 if(fs.existsSync(path.join(res,'var')))fail('EMBEDDED_RESOURCE_ALREADY_DIRTY');
 return {res,binary,manifest};
}
async function freePort(){
 const l=net.createServer();l.listen(0,'127.0.0.1');await once(l,'listening');
 const p=l.address().port;await new Promise(r=>l.close(r));return p;
}
async function rpc(port,method,name,args={}){
 const req={jsonrpc:'2.0',id:'e2e-'+method+'-'+(name||'catalog'),method,params:method==='tools/call'?{name,arguments:args}:{}};
 const r=await fetch('http://127.0.0.1:'+port+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req),signal:AbortSignal.timeout(2600)});
 if(!r.ok)fail('MCP_HTTP_'+r.status);
 const data=await r.json();if(data.error||data.result?.isError)fail('MCP_ERROR_RESPONSE');
 return data.result;
}
async function start(binary,res,root,configPath,port){
 let err='',out='';
 const home=path.join(root,'home');
 const env={
  PATH:process.env.PATH||'',LANG:process.env.LANG||'C.UTF-8',
  HOME:home,USERPROFILE:home,
  APPDATA:path.join(home,'AppData','Roaming'),LOCALAPPDATA:path.join(home,'AppData','Local'),
  XDG_CONFIG_HOME:path.join(home,'.config'),XDG_DATA_HOME:path.join(home,'.local','share'),
  XDG_CACHE_HOME:path.join(home,'.cache'),TMPDIR:path.join(root,'tmp'),
  TMP:path.join(root,'tmp'),TEMP:path.join(root,'tmp'),
  SystemRoot:process.env.SystemRoot||'',windir:process.env.windir||'',ComSpec:process.env.ComSpec||'',
  PATHEXT:process.env.PATHEXT||'',ELECTRON_RUN_AS_NODE:'1',REMOTE_COMMANDER_CONFIG:configPath
 };
 const child=spawn(binary,[path.join(res,'src','server-v0.3.mjs')],{cwd:res,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 child.stderr.on('data',b=>{err=(err+b.toString()).slice(-1300)});
 child.stdout.on('data',b=>{out=(out+b.toString()).slice(-1300)});
 for(let i=0;i<90;i++){
  if(child.exitCode!==null)break;
  try{
   const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(800)});
   if(r.ok){const health=await r.json();if(health.ok===true&&health.version==='0.11.0-dev.23-capgap-qa')return child;}
  }catch{}
  await sleep(80);
 }
 child.kill('SIGTERM');fail('PACKAGED_CORE_DID_NOT_START_'+(err.includes('EADDRINUSE')?'PORT_IN_USE':err.slice(-200).replace(/\s+/g,'_')));
}
async function stop(child){
 if(!child||child.exitCode!==null)return;
 const closed=once(child,'close').catch(()=>null);
 child.kill('SIGTERM');await Promise.race([closed,sleep(2000)]);
 if(child.exitCode===null)child.kill('SIGKILL');
}
export async function verify(root){
 const {res,binary,manifest}=preflight(root);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cmdv2-embedded-qa-'));
 let child=null;
 const config=path.join(tmp,'config.json');
 try{
  for(const x of ['data','home','tmp'])fs.mkdirSync(path.join(tmp,x),{mode:0o700});
  const port=await freePort();
  const mk=scope=>({
   host:'127.0.0.1',port,allowedRoots:[path.join(tmp,'data')],allowedPrograms:[],
   auditLog:path.join(tmp,'audit.jsonl'),runtimeState:path.join(tmp,'runtime.json'),
   durableDelivery:{directory:path.join(tmp,'delivery'),scope},
   powerMode:{enabled:false,fullFilesystem:false,guiControl:{enabled:false}},
   instance:{profile:scope,isolated:true}
  });
  const write=scope=>fs.writeFileSync(config,JSON.stringify(mk(scope)),{mode:0o600});
  write('embedded-owner-qa');
  child=await start(binary,res,tmp,config,port);
  const catalog=(await rpc(port,'tools/list')).tools.map(t=>t.name).sort();
  const gaps=['capability_gap_get','capability_gap_list','capability_gap_report','capability_gap_triage'];
  if(catalog.length!==64||gaps.some(g=>!catalog.includes(g)))fail('CORE_TOOLS_MISSING');
  const request={requestId:'embedded-v1-e2e-qa',
   capabilityKey:'embedded-runtime.qa.functional',projectKey:'commander-v2',
   category:'CONNECTOR',consentGate:'NONE',title:'Embedded runtime owner-scoped QA',
   requiredBehavior:'V1 MCP must start from one bundled Commander V2 executable.',
   observedLimitation:'Baseline V1 method not exposed by old releases.',
   errorCode:'EMBEDDED_RUNTIME_UNQUALIFIED',
   acceptanceTest:'Observe 64 methods and recover owner-private ledger after packaged runtime restart.',
   candidateSolution:'Use the embedded exact pinned V1 source and Electron runAsNode.'};
  const first=(await rpc(port,'tools/call','capability_gap_report',request)).structuredContent;
  if(!first?.created)fail('CREATE_TOOL_FAILED');
  const replay=(await rpc(port,'tools/call','capability_gap_report',request)).structuredContent;
  if(!replay?.created||replay.record.revision!==first.record.revision)fail('IDEMPOTENCE_FAILED');
  await stop(child);child=null;
  child=await start(binary,res,tmp,config,port);
  const stored=(await rpc(port,'tools/call','capability_gap_list',{})).structuredContent;
  if(stored?.total!==1)fail('RESTART_DATA_NOT_PERSISTED');
  await stop(child);child=null;
  write('embedded-other-owner-qa');
  child=await start(binary,res,tmp,config,port);
  const isolated=(await rpc(port,'tools/call','capability_gap_list',{})).structuredContent;
  if(isolated?.total!==0)fail('CROSS_OWNER_LEDGER_LEAK');
  if(fs.existsSync(path.join(res,'var')))fail('PACKAGED_SOURCE_DATA_WRITTEN');
  if(sha(file(path.join(res,'src','server-v0.3.mjs')))!==manifest.serverSha)fail('SOURCE_CHANGED');
  return {gate:'COMMANDER_V2_EMBEDDED_V1_RUNTIME_QA_PASS',platform:process.platform,
   packagedExecutable:path.basename(binary),sourceFiles:manifest.files.length,methods:catalog.length,
   addedNativeGapMethods:4,requestIdIdempotent:true,restartPersistent:true,secondOwnerIsolated:true,
   electronNodeInternal:true,sourceUnchanged:true,productionServiceStarted:false,
   installed:false,ownerAccountsUsed:false,fullPowerGranted:false,liveGuiVerified:false};
 }finally{await stop(child);fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 verify(process.argv[2]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(String(e.message||e));process.exitCode=2;});
}
