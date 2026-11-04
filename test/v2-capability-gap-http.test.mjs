import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('isolated MCP server reports and deduplicates capability/privilege gaps across project chats',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-gap-http-'));
 const serverRoot=path.join(root,'server'),data=path.join(root,'data'),port=await freePort();let child;
 try{
  await fs.mkdir(serverRoot,{recursive:true});await fs.mkdir(data,{recursive:true});
  await fs.cp(new URL('../src/',import.meta.url),path.join(serverRoot,'src'),{recursive:true});
  const config={host:'127.0.0.1',port,allowedRoots:[data],allowedPrograms:['node'],
   auditLog:'var/audit.jsonl',durableDelivery:{directory:path.join(root,'delivery')},
   powerMode:{enabled:false,fullFilesystem:false,guiControl:{enabled:false}}};
  const file=path.join(serverRoot,'config.json');
  await fs.writeFile(file,JSON.stringify(config),{mode:0o600});
  child=spawn(process.execPath,[path.join(serverRoot,'src','server-v0.3.mjs')],{
   cwd:serverRoot,env:{...process.env,REMOTE_COMMANDER_CONFIG:file},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',b=>stderr+=b.toString('utf8'));
  let healthy=false;
  for(let n=0;n<240;n++){try{const r=await fetch('http://127.0.0.1:'+port+'/health');if(r.ok){healthy=true;break;}}catch{}await wait(30);}
  assert.equal(healthy,true,stderr.slice(-1200));
  let rpcId=0;
  async function rpc(method,name,args={}){
    const body={jsonrpc:'2.0',id:++rpcId,method,params:method==='tools/call'?{name,arguments:args}:{}};
    const r=await fetch('http://127.0.0.1:'+port+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal(r.status,200);
    return r.json();
  }
  const listed=await rpc('tools/list');
  for(const n of ['capability_gap_report','capability_gap_list','capability_gap_get','capability_gap_triage'])assert.ok(listed.result.tools.find(x=>x.name===n));
  const d=listed.result.tools.find(x=>x.name==='capability_gap_report');
  assert.equal(d.annotations.readOnlyHint,false);
  assert.ok(d.inputSchema.required.includes('requestId'));
  const status=(await rpc('tools/call','system_status')).result.structuredContent;
  assert.equal(status.configSchema.capabilityGapRegistry,1);
  assert.equal(status.capabilityGaps.authorizationEffects,false);
  const input={requestId:'owner-gap-001',capabilityKey:'browser.profile.native-attach',
   projectKey:'commander-v2',category:'BROWSER',consentGate:'BROWSER_OWNER',
   title:'Owner browser profile attach missing',
   requiredBehavior:'Attach to an already authenticated owner browser through its supported native consent flow.',
   observedLimitation:'Firefox/Brave attachment route returns PROFILE_ATTACH_NOT_READY.',
   errorCode:'PROFILE_ATTACH_NOT_READY',
   candidateSolution:'Discover existing browser connector routes; request scoped native owner consent only when necessary.',
   acceptanceTest:'Real attached browser observation succeeds, and another user session remains isolated.'};
  const first=(await rpc('tools/call','capability_gap_report',input)).result.structuredContent;
  assert.equal(first.created,true);assert.equal(first.record.state,'OPEN');
  const replay=(await rpc('tools/call','capability_gap_report',input)).result.structuredContent;
  assert.deepEqual(replay,first);
  const same=(await rpc('tools/call','capability_gap_report',{...input,requestId:'owner-gap-002'})).result.structuredContent;
  assert.equal(same.changed,false);assert.equal(same.record.observationCount,1);
  const another=(await rpc('tools/call','capability_gap_report',{...input,projectKey:'research-project',requestId:'owner-gap-003'})).result.structuredContent;
  assert.equal(another.record.observationCount,2);
  assert.equal(another.record.impactedProjects.length,2);
  const detail=(await rpc('tools/call','capability_gap_get',{capabilityKey:input.capabilityKey})).result.structuredContent;
  assert.equal(detail.observations.length,2);
  assert.equal(detail.acceptanceVerified,false);
  const triaged=(await rpc('tools/call','capability_gap_triage',{requestId:'owner-triage-001',
   capabilityKey:input.capabilityKey,expectedRevision:another.record.revision,
   state:'BLOCKED',candidateSolution:input.candidateSolution,acceptanceTest:input.acceptanceTest})).result.structuredContent;
  assert.equal(triaged.acceptanceVerified,false);assert.equal(triaged.record.state,'BLOCKED');
  const items=(await rpc('tools/call','capability_gap_list',{state:'BLOCKED'})).result.structuredContent;
  assert.equal(items.total,1);assert.equal(items.items[0].observationCount,2);
  assert.equal(items.fleetSync,false);
  const bad=await rpc('tools/call','capability_gap_triage',{requestId:'owner-triage-002',capabilityKey:input.capabilityKey,
    expectedRevision:triaged.record.revision,state:'VERIFIED',
    candidateSolution:input.candidateSolution,acceptanceTest:input.acceptanceTest});
  assert.ok(bad.error||bad.result?.isError||bad.result?.content?.some(x=>x.type==='text'&&/STATUS_INVALID/i.test(x.text)));
 }finally{
  if(child){
    child.kill('SIGTERM');let timer;
    try{await Promise.race([once(child,'close'),new Promise(resolve=>{timer=setTimeout(resolve,4500);})]);}
    finally{clearTimeout(timer);}
  }
  await fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:60});
 }
});
