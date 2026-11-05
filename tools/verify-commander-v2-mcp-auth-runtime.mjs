#!/usr/bin/env node
// Functional denial/allow tests of a QA-only, capability-gated V1 MCP child.
// No owner credentials, active V1 or installed Commander state touched.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=e=>{throw Error('CMDV2_BEARER_NATIVE_QA_'+e)};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const EXP={
 linux:{manifest:'45f141302e19728d7ee2eb4898c5fa35d1b99889ef6707760fd079dda7771842',server:'bb998b57495dc72f984be4a71bd7143dafe8a5f5099c05cdd9cfcd1ee44521d4'},
 win32:{manifest:'f91097d773bb754cba34900d8f44609555b1936a510e55af9ee933cd4f7d239a',server:'3be48a03a44d8ac8ec58af3c8b2d3a527c9d3723fc5b935f00a86eb3e0097b6e'}
};
function bytes(f){const st=fs.lstatSync(f);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('BAD_SOURCE_FILE');return fs.readFileSync(f);}
function preflight(root,output){
 if(!path.isAbsolute(root)||!EXP[process.platform])fail('BAD_OS_ROOT');
 const base=path.resolve(root);
 if(path.basename(base)!==(process.platform==='win32'?'official-cos-tag2150-sparse-20261104':'cos2150-unified-rebuild-20261104'))fail('NOT_QA_SOURCE');
 if(bytes(path.join(base,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('MISSING_QA_MARKER');
 const component=output?path.join(base,'release','commander-v2-authqa',process.platform==='win32'?'win-unpacked':'linux-unpacked','resources','commander-v1-core'):path.join(base,'resources','commander-v1-core');
 const m=JSON.parse(bytes(path.join(component,'MANIFEST.json')));
 if(sha(bytes(path.join(component,'MANIFEST.json')))!==EXP[process.platform].manifest||
  sha(bytes(path.join(component,'src','server-v0.3.mjs')))!==EXP[process.platform].server||
  m.qaTransportAuth!=='QA_EPHEMERAL_PROCESS_BEARER_NOT_OWNER_LOGIN'||m.files.length!==75)
  fail('EMBEDDED_AUTH_CORE_SHA_DRIFT');
 const exeRoot=path.join(base,'release',output?'commander-v2-authqa':'commander-v2-supervised-qa',
  process.platform==='win32'?'win-unpacked':'linux-unpacked');
 const executable=path.join(exeRoot,process.platform==='win32'?'Commander V2.exe':'commander-v2');
 bytes(executable).subarray(0,0);
 return {server:path.join(component,'src','server-v0.3.mjs'),executable,component,base};
}
async function freePort(){
 const listener=net.createServer();
 listener.listen(0,'127.0.0.1');await once(listener,'listening');
 const p=listener.address().port;
 await new Promise(resolve=>listener.close(()=>resolve()));
 return p;
}
async function stop(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const done=once(child,'close').catch(()=>null);
 child.kill('SIGTERM');await Promise.race([done,sleep(2200)]);
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
}
function env(root,config,secret){
 const home=path.join(root,'home');
 return {
  PATH:process.env.PATH||'',LANG:process.env.LANG||'C.UTF-8',
  HOME:home,USERPROFILE:home,APPDATA:path.join(home,'AppData','Roaming'),
  LOCALAPPDATA:path.join(home,'AppData','Local'),
  XDG_CONFIG_HOME:path.join(home,'.config'),XDG_DATA_HOME:path.join(home,'.local','share'),
  XDG_CACHE_HOME:path.join(home,'.cache'),TMP:root,TEMP:root,TMPDIR:root,
  SystemRoot:process.env.SystemRoot||'',windir:process.env.windir||'',
  ComSpec:process.env.ComSpec||'',PATHEXT:process.env.PATHEXT||'',
  ELECTRON_RUN_AS_NODE:'1',REMOTE_COMMANDER_CONFIG:config,
  ...(secret?{COMMANDER_V2_QA_MCP_SECRET:secret}:{})
 };
}
async function start(exe,server,tmp,config,port,secret){
 const child=spawn(exe,[server],{cwd:path.dirname(server),env:env(tmp,config,secret),
  stdio:['ignore','pipe','pipe'],windowsHide:true});
 let serverFailed=false,errs='';
 child.on('error',()=>{serverFailed=true;});
 child.stderr.on('data',b=>{errs=(errs+b.toString()).slice(-450)});
 child.stdout.resume();
 for(let n=0;n<95;n++){
  if(serverFailed||child.exitCode!==null||child.signalCode!==null)break;
  try{
   const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(450),redirect:'error'});
   if(r.ok){const j=await r.json();if(j.ok===true&&j.version==='0.11.0-dev.23-capgap-qa')return {child,health:j};}
  }catch{}
  await sleep(75);
 }
 await stop(child);
 fail('CHILD_WAS_NOT_AUTH_GATED_READY'+(errs.includes('COMMANDER_V2_QA_MCP_BEARER_REQUIRED')?'_MISSING_TOKEN':''));
}
async function rpc(port,method,token,name,args={}){
 const data={jsonrpc:'2.0',id:'authqa-'+method,method,
  params:method==='tools/call'?{name,arguments:args}:{}};
 return await fetch('http://127.0.0.1:'+port+'/mcp',{
  method:'POST',redirect:'error',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
  body:JSON.stringify(data),signal:AbortSignal.timeout(1800)
 });
}
export async function verify(root,packaged=false){
 const {server,executable,component}=preflight(root,packaged);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cmdv2-mcp-bearer-'));
 const secret=randomBytes(32).toString('hex');
 let child=null;
 try{
  for(const x of ['data','home'])fs.mkdirSync(path.join(temp,x),{mode:0o700});
  const port=await freePort(),config=path.join(temp,'config.json');
  const body={host:'127.0.0.1',port,allowedRoots:[path.join(temp,'data')],allowedPrograms:[],
   auditLog:path.join(temp,'audit.jsonl'),runtimeState:path.join(temp,'runtime.json'),
   durableDelivery:{directory:path.join(temp,'delivery'),scope:'bearer-only-qa'},
   powerMode:{enabled:false,fullFilesystem:false,guiControl:{enabled:false}},
   instance:{profile:'bearer-only-qa',isolated:true}};
  fs.writeFileSync(config,JSON.stringify(body),{mode:0o600});
  if(bytes(config).toString().includes(secret))fail('SECRET_STORED_IN_CONFIG');
  const first=await start(executable,server,temp,config,port,secret);child=first.child;
  if(Object.keys(first.health).sort().join(',')!=='name,ok,version')fail('HEALTH_EXPOSES_PRIVATE_CONFIG');
  const without=await rpc(port,'tools/list',null);
  if(without.status!==401)fail('MISSING_TOKEN_NOT_DENIED');
  const invalid=await rpc(port,'tools/list','0'.repeat(64));
  if(invalid.status!==401)fail('BAD_TOKEN_NOT_DENIED');
  // Undici/fetch canonicalizes Host; use native raw HTTP to actually send the hostile Host header.
  const hostSpoof=await new Promise((resolve,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port,path:'/mcp',method:'POST',
    headers:{Host:'attacker.example','content-type':'application/json',
     authorization:'Bearer '+secret}},res=>{
     res.resume();res.once('end',()=>resolve(res.statusCode));
    });
   req.once('error',reject);
   req.end(JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/list',params:{}}));
  });
  if(hostSpoof!==403)fail('HOST_HEADER_NOT_DENIED_STATUS_'+hostSpoof);
  const originSpoof=await fetch('http://127.0.0.1:'+port+'/mcp',{
   method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret,origin:'https://attacker.example'},
   body:JSON.stringify({jsonrpc:'2.0',id:4,method:'tools/list',params:{}}),
   signal:AbortSignal.timeout(1800)
  });
  if(originSpoof.status!==403)fail('UNTRUSTED_ORIGIN_NOT_DENIED_STATUS_'+originSpoof.status);
  const authorized=await rpc(port,'tools/list',secret);
  if(authorized.status!==200)fail('VALID_PROCESS_TOKEN_NOT_ACCEPTED');
  const catalog=await authorized.json();
  if(catalog.result?.tools?.length!==64)fail('AUTHORIZED_TOOL_COUNT_CHANGED');
  const deniedMutation=await rpc(port,'tools/call',null,'capability_gap_report',{
   requestId:'must-never-write',capabilityKey:'guard.denied',projectKey:'commander-v2',category:'OTHER',
   consentGate:'NONE',title:'Unauthorized MCP rejected',requiredBehavior:'The unauthorized RPC must not store data.',
   observedLimitation:'Unauthorized bearer missing.',errorCode:'UNAUTHORIZED_TEST'
  });
  if(deniedMutation.status!==401)fail('UNAUTHORIZED_TOOL_EFFECT_BOUNDARY');
  const list=await rpc(port,'tools/call',secret,'capability_gap_list',{});
  const inventory=await list.json();
  if(inventory.result?.structuredContent?.total!==0)fail('UNAUTHORIZED_PERSISTED_MUTATION');
  await stop(child);child=null;
  const second=randomBytes(32).toString('hex');
  const after=await start(executable,server,temp,config,port,second);child=after.child;
  if((await rpc(port,'tools/list',secret)).status!==401)fail('RESTART_OLD_TOKEN_STILL_ACCEPTED');
  if((await rpc(port,'tools/list',second)).status!==200)fail('RESTART_NEW_TOKEN_NOT_ACCEPTED');
  await stop(child);child=null;
  // Missing process capability secret must make the patched Core fail before listening.
  const absent=spawn(executable,[server],{cwd:path.dirname(server),env:env(temp,config,null),
   stdio:'ignore',windowsHide:true});
  let errSpawn=false;absent.on('error',()=>{errSpawn=true;});
  await Promise.race([once(absent,'close').catch(()=>null),sleep(2500)]);
  if(!errSpawn&&absent.exitCode===null){await stop(absent);fail('MISSING_TOKEN_SERVER_DID_NOT_EXIT');}
  if(!errSpawn&&absent.exitCode===0)fail('MISSING_TOKEN_SERVER_EXITED_SUCCESSFULLY');
  if(fs.existsSync(path.join(component,'var')))fail('SOURCE_RESOURCE_RUNTIME_WRITTEN');
  return {gate:'COMMANDER_V2_MCP_PROCESS_CAPABILITY_NATIVE_QA_PASS',
   platform:process.platform,packaged,coreMethods:64,unauthenticatedRejected:true,
   wrongTokenRejected:true,hostSpoofRejected:true,originSpoofRejected:true,
   mutationRejectedBeforeDispatch:true,bearerRotatesOnRestart:true,missingEnvFailsClosed:true,
   healthMinimized:true,ownerAuthenticated:false,oauthImplemented:false,
   elevated:false,liveV1Touched:false,installed:false};
 }finally{await stop(child);fs.rmSync(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 verify(process.argv[2],process.argv[3]==='packaged').then(x=>console.log(JSON.stringify(x)))
  .catch(e=>{console.error(String(e.message||e));process.exitCode=2;});
}
