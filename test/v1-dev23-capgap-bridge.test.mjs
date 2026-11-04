import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const rootSource=path.join(os.homedir(),'.local','state','chatgpt-remote-commander','releases','v0.11.0-dev.23-5542845b43ea');
const candidate=path.join(os.homedir(),'.local','state','CommanderV2','QA','v1-dev23-capgap-bridge');
const delay=t=>new Promise(done=>setTimeout(done,t));
async function port(){
 const s=net.createServer();
 s.listen(0,'127.0.0.1');await once(s,'listening');
 const p=s.address().port;await new Promise(done=>s.close(done));return p;
}
async function call(port,method,name,args={}){
 const r=await fetch('http://127.0.0.1:'+port+'/mcp',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:'fixture-'+method+'-'+(name||'catalog'),
   method,params:method==='tools/call'?{name,arguments:args}:{}})});
 assert.equal(r.status,200);
 return r.json();
}
async function launch(source,cfg,port){
 const server=path.join(source,'src','server-v0.3.mjs');
 const child=spawn(process.execPath,[server],{cwd:source,
  env:{...process.env,REMOTE_COMMANDER_CONFIG:cfg},stdio:['ignore','pipe','pipe']});
 let error='';child.stderr.on('data',b=>{error=(error+b.toString('utf8')).slice(-3000);});
 try{
  for(let i=0;i<260;i++){
   if(child.exitCode!==null)break;
   try{const r=await fetch('http://127.0.0.1:'+port+'/health');
    if(r.ok)return {child,health:await r.json()};
   }catch{}
   await delay(20);
  }
  throw Error('V1_DEV23_QA_START_FAILED '+error);
 }catch(e){
  child.kill('SIGTERM');throw e;
 }
}
async function stop(child){
 if(!child)return;
 if(child.exitCode!==null)return;
 const closed=once(child,'close').catch(()=>null);
 child.kill('SIGTERM');
 await Promise.race([closed,delay(2500)]);
 if(child.exitCode===null)child.kill('SIGKILL');
}
test('pinned V1 dev23 bridge preserves baseline tools, persists idempotent gap across restart and isolates profile',async t=>{
 try{await fs.access(path.join(candidate,'.v1-dev23-capgap-disposable-qa'));}
 catch{return t.skip('Pinned dev23 staged candidate not present on this host');}
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'v1dev23-capgap-mcp-'));
 let child;
 try{
  const data=path.join(root,'data');await fs.mkdir(data,{recursive:true});
  const state=path.join(root,'private');const configPath=path.join(root,'config.json');
  let serverPort=await port();
  function config(scope,portNo){return {host:'127.0.0.1',port:portNo,
    allowedRoots:[data],allowedPrograms:[],auditLog:'var/audit.jsonl',
    durableDelivery:{directory:state,scope},
    powerMode:{enabled:false,fullFilesystem:false,guiControl:{enabled:false}},
    instance:{profile:scope,isolated:true}};}
  const baselineConfig=path.join(root,'baseline-config.json');
  await fs.writeFile(baselineConfig,JSON.stringify(config('dev23-baseline-qa',serverPort)),{mode:0o600});
  let session=await launch(rootSource,baselineConfig,serverPort);child=session.child;
  assert.equal(session.health.version,'0.11.0-dev.23');
  const before=(await call(serverPort,'tools/list')).result.tools.map(x=>x.name).sort();
  assert.equal(before.some(x=>x.startsWith('capability_gap_')),false);
  await stop(child);child=null;
  serverPort=await port();
  await fs.writeFile(configPath,JSON.stringify(config('owner-qa',serverPort)),{mode:0o600});
  session=await launch(candidate,configPath,serverPort);child=session.child;
  assert.equal(session.health.version,'0.11.0-dev.23-capgap-qa');
  const tools=(await call(serverPort,'tools/list')).result.tools.map(x=>x.name).sort();
  assert.deepEqual(tools.filter(x=>!before.includes(x)),
   ['capability_gap_get','capability_gap_list','capability_gap_report','capability_gap_triage']);
  assert.deepEqual(before.filter(x=>!tools.includes(x)),[]);
  const status=(await call(serverPort,'tools/call','system_status')).result.structuredContent;
  assert.equal(status.capabilityGaps.authorizationEffects,false);
  assert.equal(status.configSchema.capabilityGapRegistry,1);
  const report={requestId:'v1dev23-gap-report-001',capabilityKey:'mcp.gap-intake.qa-bridge',
   projectKey:'commander-v2',category:'CONNECTOR',consentGate:'NONE',
   title:'V1 dev23 custom gap intake QA',
   requiredBehavior:'Record real capability gaps from the installed Commander MCP catalog and preserve them.',
   observedLimitation:'The baseline dev23 catalog was missing four capability_gap_* tools.',
   errorCode:'CAPABILITY_GAP_TOOLS_UNAVAILABLE',
   candidateSolution:'Use the pinned bridge with exact baseline-source hashes and guarded rollout.',
   acceptanceTest:'Read the same gap after server restart and deny a second scoped profile.'};
  let res=await call(serverPort,'tools/call','capability_gap_report',report);
  assert.equal(res.result.structuredContent.created,true);
  res=await call(serverPort,'tools/call','capability_gap_report',report);
  assert.equal(res.result.structuredContent.created,true); // same durable requestId returns exact receipt
  res=await call(serverPort,'tools/call','capability_gap_report',{...report,requestId:'v1dev23-gap-report-002'});
  assert.equal(res.result.structuredContent.changed,false);
  await stop(child);child=null;
  session=await launch(candidate,configPath,serverPort);child=session.child;
  res=await call(serverPort,'tools/call','capability_gap_list',{});
  assert.equal(res.result.structuredContent.total,1);
  res=await call(serverPort,'tools/call','capability_gap_get',{capabilityKey:report.capabilityKey});
  assert.equal(res.result.structuredContent.observations.length,1);
  res=await call(serverPort,'tools/call','capability_gap_report',report);
  assert.equal(res.result.structuredContent.created,true); // durable request idempotency after restart
  await stop(child);child=null;
  serverPort=await port();
  await fs.writeFile(configPath,JSON.stringify(config('other-owner-qa',serverPort)),{mode:0o600});
  session=await launch(candidate,configPath,serverPort);child=session.child;
  res=await call(serverPort,'tools/call','capability_gap_list',{});
  assert.equal(res.result.structuredContent.total,0);
  console.log(JSON.stringify({gate:'V1_DEV23_GAP_BRIDGE_REAL_MCP_AND_RESTART_PASS',
   baselineCount:before.length,newTools:tools.length-before.length,duplicateStored:1,
   restarted:true,otherProfileIsolated:true,nativeAuthorityGranted:false}));
 }finally{
  await stop(child);
  await fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:60});
 }
});


test('stage cannot overwrite an existing QA candidate or mutate a pinned live release',async t=>{
 try{await fs.access(path.join(candidate,'.v1-dev23-capgap-disposable-qa'));}
 catch{return t.skip('Local pinned QA stage not present');}
 const live=path.join(rootSource,'src','server-v0.3.mjs');
 const staged=path.join(candidate,'src','server-v0.3.mjs');
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const oldLive=sha(await fs.readFile(live)),oldStage=sha(await fs.readFile(staged));
 const tool=new URL('../tools/v1-dev23-capgap-stage.mjs',import.meta.url).pathname;
 const denied=spawnSync(process.execPath,[tool,rootSource,candidate],
  {encoding:'utf8',timeout:9000});
 assert.equal(denied.status,2);
 assert.match(denied.stderr,/V1_DEV23_GAP_BRIDGE_QA_ALREADY_EXISTS/);
 assert.equal(sha(await fs.readFile(live)),oldLive);
 assert.equal(sha(await fs.readFile(staged)),oldStage);
 assert.equal(oldLive,'c1c13efa74c75d00ca3b6e778a7af6b63f4053ac346caec12308d76117565933');
 assert.equal(oldStage,'d62c98fd122b3492aac678593f5181ba765820f8383b68c365487338501e0219');
});
