#!/usr/bin/env node
// Reproducible owner-local native MCP QA: never promotes/restarts any installed V1 service.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const PINNED_SERVER_SHA_LIST=process.platform==='win32'
 ? ['fafd2151117456b7146fe3dafbe57f5f0507e2ebf8778964ab43562c569387e6']
 : ['c1c13efa74c75d00ca3b6e778a7af6b63f4053ac346caec12308d76117565933',
    'fafd2151117456b7146fe3dafbe57f5f0507e2ebf8778964ab43562c569387e6'];
const fail=s=>{throw Error('V1_DEV23_CAPGAP_NATIVE_QA_'+s)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const l=net.createServer();l.listen(0,'127.0.0.1');await once(l,'listening');const p=l.address().port;await new Promise(r=>l.close(r));return p;}
async function rpc(port,method,name,args={}){
 const response=await fetch('http://127.0.0.1:'+port+'/mcp',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:'qa-'+method+'-'+(name||'list'),method,
   params:method==='tools/call'?{name,arguments:args}:{}}),signal:AbortSignal.timeout(2500)});
 if(response.status!==200)fail('MCP_HTTP_STATUS');
 const result=await response.json();
 if(result.error||result.result?.isError)fail('MCP_TOOL_ERROR');
 return result.result;
}
async function start(dir,configFile,port,expectedVersion){
 let stderr='';
 const child=spawn(process.execPath,[path.join(dir,'src','server-v0.3.mjs')],{
  cwd:dir,env:{...process.env,REMOTE_COMMANDER_CONFIG:configFile},
  stdio:['ignore','pipe','pipe'],windowsHide:true});
 child.stderr.on('data',buf=>{stderr=(stderr+buf.toString('utf8')).slice(-700);});
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)break;
  try{
   const response=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(1000)});
   if(response.ok){
    const x=await response.json();
    if(x.ok===true&&x.version===expectedVersion)return child;
   }
  }catch{}
  await sleep(65);
 }
 child.kill('SIGTERM');
 fail('QA_CHILD_FAILED_START_'+(stderr.includes('EADDRINUSE')?'PORT':'UNKNOWN'));
}
async function stop(child){
 if(!child||child.exitCode!==null)return;
 const closed=once(child,'close').catch(()=>null);
 child.kill('SIGTERM');
 await Promise.race([closed,sleep(2500)]);
 if(child.exitCode===null)child.kill('SIGKILL');
}
async function main(source,candidate){
 if(!['win32','linux'].includes(process.platform))fail('UNSUPPORTED_NATIVE_PLATFORM');
 for(const d of [source,candidate]){
  if(!path.isAbsolute(d)||!fs.lstatSync(d).isDirectory())fail('SOURCE_DIR_INVALID');
 }
 const original=path.join(source,'src','server-v0.3.mjs');
 const baselineSha=sha(fs.readFileSync(original));
 if(!PINNED_SERVER_SHA_LIST.includes(baselineSha))fail('IMMUTABLE_V1_BASELINE_CHANGED');
 if(fs.readFileSync(path.join(candidate,'.v1-dev23-capgap-disposable-qa'),'utf8')!=='DISPOSABLE_SOURCE_QA_ONLY\n')
  fail('QA_MARKER_INVALID');
 const qaSource=fs.readFileSync(path.join(candidate,'src','server-v0.3.mjs'),'utf8');
 if(!qaSource.includes('capability_gap_report')||!qaSource.includes('0.11.0-dev.23-capgap-qa'))fail('QA_PATCH_INVALID');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capgap-win-native-'));
 let child=null;
 try{
  const data=path.join(dir,'data');fs.mkdirSync(data,{mode:0o700});
  const storage=path.join(dir,'delivery');const configFile=path.join(dir,'config.json');
  let port=await freePort();
  const config=(scope,p)=>({
   host:'127.0.0.1',port:p,allowedRoots:[data],allowedPrograms:[],
   auditLog:path.join(dir,'audit.jsonl'),durableDelivery:{directory:storage,scope},
   powerMode:{enabled:false,fullFilesystem:false,guiControl:{enabled:false}},
   instance:{profile:scope,isolated:true}});
  fs.writeFileSync(configFile,JSON.stringify(config('owner-qa',port)),{mode:0o600});
  child=await start(source,configFile,port,'0.11.0-dev.23');
  const before=(await rpc(port,'tools/list')).tools.map(x=>x.name).sort();
  if(before.some(x=>x.startsWith('capability_gap_')))fail('BASELINE_HAS_NEW_TOOLS');
  await stop(child);child=null;
  port=await freePort();fs.writeFileSync(configFile,JSON.stringify(config('owner-qa',port)),{mode:0o600});
  child=await start(candidate,configFile,port,'0.11.0-dev.23-capgap-qa');
  const after=(await rpc(port,'tools/list')).tools.map(x=>x.name).sort();
  const added=after.filter(x=>!before.includes(x));
  if(JSON.stringify(added)!==JSON.stringify(['capability_gap_get','capability_gap_list','capability_gap_report','capability_gap_triage'])||
     before.some(x=>!after.includes(x)))fail('TOOL_CATALOG_CHANGED_UNEXPECTEDLY');
  const input={requestId:'win-capgap-qa-owner-one',capabilityKey:'mcp.native-capgap.windows-qa',
   projectKey:'commander-v2',category:'CONNECTOR',consentGate:'NONE',title:'Windows native gap methods QA',
   requiredBehavior:'Expose the four owner-scoped gap methods in a pinned Windows V1 candidate.',
   observedLimitation:'Unmodified Windows V1 release has no capability_gap methods.',
   errorCode:'CAPABILITY_GAP_MCP_UNAVAILABLE',
   acceptanceTest:'Read exactly four added methods after restart with another owner denied.',
   candidateSolution:'Use a guarded updater candidate with owner-specific native permissions.'};
  const first=(await rpc(port,'tools/call','capability_gap_report',input)).structuredContent;
  if(!first?.created)fail('FIRST_REPORT_NOT_CREATED');
  const replay=(await rpc(port,'tools/call','capability_gap_report',input)).structuredContent;
  if(!replay?.created||replay.record.revision!==first.record.revision)fail('REQUEST_REPLAY_NOT_IDEMPOTENT');
  await stop(child);child=null;
  child=await start(candidate,configFile,port,'0.11.0-dev.23-capgap-qa');
  const persisted=(await rpc(port,'tools/call','capability_gap_list',{})).structuredContent;
  if(persisted?.total!==1)fail('RESTART_PERSISTENCE_FAILED');
  await stop(child);child=null;
  port=await freePort();fs.writeFileSync(configFile,JSON.stringify(config('another-owner-qa',port)),{mode:0o600});
  child=await start(candidate,configFile,port,'0.11.0-dev.23-capgap-qa');
  const isolated=(await rpc(port,'tools/call','capability_gap_list',{})).structuredContent;
  if(isolated?.total!==0)fail('CROSS_PROFILE_LEAK');
  if(sha(fs.readFileSync(original))!==baselineSha)fail('IMMUTABLE_SOURCE_CHANGED_AFTER_TEST');
  console.log(JSON.stringify({gate:'V1_DEV23_CAPGAP_NATIVE_QA_PASS',platform:process.platform,baselineSha,
   baselineMethods:before.length,newMethods:added.length,allBaselinePreserved:true,
   restartPersisted:true,otherOwnerIsolated:true,activeV1Modified:false,
   signedInstaller:false,permissionGranted:false,workerEffectsVerified:false}));
 }finally{await stop(child);fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:80});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main(process.argv[2],process.argv[3]).catch(e=>{console.error(String(e.message||e));process.exitCode=2;});
}
