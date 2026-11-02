import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createWorkspace, normalizeCoreUrl } from './server.mjs';

test('only explicit localhost HTTP health endpoints can be configured',()=>{
  assert.equal(normalizeCoreUrl('http://127.0.0.1:48844'),'http://127.0.0.1:48844');
  assert.equal(normalizeCoreUrl('http://localhost:48844/'),'http://localhost:48844');
  for (const url of ['https://example.org','http://10.0.0.1:48844','http://evil@127.0.0.1:48844','http://localhost:48844/foo',
      'file:///tmp/secret','http://localhost:80','http://127.0.0.1:48844/?x=1','invalid']) {
    assert.equal(normalizeCoreUrl(url),null,url);
  }
});
test('workspace is read-only, private by default, and serves the actual UI',async(t)=>{
  const app=await createWorkspace({port:0,coreUrl:''});
  t.after(()=>new Promise(r=>app.server.close(r)));
  const base='http://127.0.0.1:'+app.port;
  const noauth=await fetch(base+'/api/status');
  assert.equal(noauth.status,403);
  const noPost=await fetch(base+'/api/status',{method:'POST'});
  assert.equal(noPost.status,405);
  const badHost=await new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port:app.port,path:'/',headers:{Host:'example.org:'+app.port}},
      (res)=>{res.resume();resolve({status:res.statusCode});});req.on('error',reject);
  });
  assert.equal(badHost.status,403);
  const ui=await fetch(base+'/');
  assert.equal(ui.status,200);
  assert.match(ui.headers.get('content-security-policy'),/default-src 'none'/);
  const html=await ui.text();
  for(const marker of ['Commander V2','Task Progress','Live View','Recent Files','draft-table','New Task'])
    assert.ok(html.includes(marker),marker);
  assert.match((await fetch(base+'/app.css').then(r=>r.text())),/\.workspace/);
  assert.match((await fetch(base+'/app.js').then(r=>r.text())),/readDrafts/);
  assert.equal((await fetch(base+'/../passwd')).status,404);
  const status=await fetch(base+'/api/status',{headers:{'X-Commander-Workspace-Token':app.token}}).then(r=>r.json());
  assert.equal(status.mode,'READ_ONLY_GUI_PREVIEW');
  assert.equal(status.core.state,'NOT_CONFIGURED');
  assert.equal(status.gui,'NOT_CONNECTED');
  assert.equal(status.auth,'NOT_ENROLLED');
  assert.equal(status.tasks,'LOCAL_DRAFTS_ONLY');
  assert.equal(status.transport.schema,1);
  assert.equal(status.transport.scope,'LOCAL_TRANSPORT_ONLY');
  assert.equal(status.transport.ownerRpcAuthenticated,false);
  assert.equal(status.transport.chatGPTOAuthVerified,false);
  assert.equal(status.transport.workerEffectVerified,false);
  assert.equal(status.evidence.chatIdentityAuthenticated,false);
  assert.equal(status.ownerSeat.authenticated,false);
  assert.equal(status.ownerSeat.canExecute,false);
  assert.equal(status.ownerSeat.authority,'MONITOR_ONLY_UNAUTHENTICATED');
  assert.ok(['CONNECTED','STALE','UNVERIFIED','UNSUPPORTED'].includes(status.evidence.state));
  assert.equal(status.evidence.authority,'LOCAL_UNAUTHENTICATED');
});
test('reachable Core is reported only on independently valid health evidence',async(t)=>{
  const core=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,version:'0.11.0-dev.18',secret:'MUST_NOT_LEAK'}));});
  await new Promise(r=>core.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>core.close(r)));
  const app=await createWorkspace({port:0,coreUrl:'http://127.0.0.1:'+core.address().port});
  t.after(()=>new Promise(r=>app.server.close(r)));
  const result=await fetch('http://127.0.0.1:'+app.port+'/api/status',{headers:{'X-Commander-Workspace-Token':app.token}}).then(r=>r.text());
  const data=JSON.parse(result);
  assert.equal(data.core.state,'REACHABLE');
  assert.equal(data.core.version,'0.11.0-dev.18');
  assert.ok(!result.includes('MUST_NOT_LEAK'));
  assert.equal(data.auth,'NOT_ENROLLED');
});
test('HTTP 200 without healthy evidence never implies connected',async(t)=>{
  const core=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'unknown',version:'strange'}));});
  await new Promise(r=>core.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>core.close(r)));
  const app=await createWorkspace({port:0,coreUrl:'http://127.0.0.1:'+core.address().port});
  t.after(()=>new Promise(r=>app.server.close(r)));
  const data=await fetch('http://127.0.0.1:'+app.port+'/api/status',{headers:{'X-Commander-Workspace-Token':app.token}}).then(r=>r.json());
  assert.equal(data.core.state,'RESPONDED_UNVERIFIED');
  assert.equal(data.gui,'NOT_CONNECTED');
});


test('workflow API denies unauthenticated clients and remains NOT_CONNECTED by default',async t=>{
 const app=await createWorkspace({port:0});
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const url='http://127.0.0.1:'+app.port+'/api/workflow';
 assert.equal((await fetch(url)).status,403);
 assert.equal((await fetch(url,{method:'POST'})).status,405);
 const data=await fetch(url,{headers:{'X-Commander-Workspace-Token':app.token}})
  .then(r=>r.json());
 assert.deepEqual(data,{state:'NOT_CONNECTED',workflow:null});
});
test('trusted owner callback may publish only schema-bounded read-only workflow view',async t=>{
 let called=0;
 const raw=()=>({
  schema:1,source:'EXISTING_WORKFLOW_STORE',
  authority:'OWNER_SESSION_AND_GRANT_VERIFIED',hostId:'private-host',
  workflowId:'work-one',revision:8,headSha256:'a'.repeat(64),
  lifecycle:'INTERRUPTED',acceptanceStatus:'UNVALIDATED',
  schedulerEnabled:false,steps:[{id:'read-one',status:'recorded'}],
  isExecutionReceipt:false
 });
 const app=await createWorkspace({port:0,trustedWorkflowReader:async()=>{called++;return raw();}});
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const url='http://127.0.0.1:'+app.port+'/api/workflow';
 const hdr={'X-Commander-Workspace-Token':app.token};
 const res=await fetch(url,{headers:hdr});
 assert.equal(res.status,200);
 const body=await res.text(),value=JSON.parse(body);
 assert.equal(value.state,'OWNER_READER_OBSERVED');
 assert.equal(value.workflow.lifecycle,'INTERRUPTED');
 assert.equal(value.workflow.steps[0].status,'recorded');
 assert.equal(value.workflow.isExecutionReceipt,false);
 assert.doesNotMatch(body,/private-host|token|owner-credential|source/);
 assert.equal(called,1);
});
test('invalid result or rejected consent yields UNVERIFIED without leakage',async t=>{
 for(const trustedWorkflowReader of [
  async()=>{throw Error('private owner secret');},
  async()=>({workflowId:'fake',secret:'DO_NOT_LEAK'})
 ]){
  const app=await createWorkspace({port:0,trustedWorkflowReader});
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const r=await fetch('http://127.0.0.1:'+app.port+'/api/workflow',{
   headers:{'X-Commander-Workspace-Token':app.token}
  });
  const txt=await r.text();
  assert.equal(r.status,503);
  assert.deepEqual(JSON.parse(txt),{state:'UNVERIFIED',workflow:null});
  assert.doesNotMatch(txt,/private owner secret|DO_NOT_LEAK/);
 }
});


test('coordinator receipt endpoint remains private and NOT_CONNECTED without owner reader',async t=>{
 const app=await createWorkspace({port:0});
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const url='http://127.0.0.1:'+app.port+'/api/fenced-receipt';
 assert.equal((await fetch(url)).status,403);
 assert.equal((await fetch(url,{method:'POST'})).status,405);
 const r=await fetch(url,{headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{state:'NOT_CONNECTED',receipt:null});
});
test('native owner callback may expose only validated coordinator DB receipt, never worker effect',async t=>{
 let called=0;
 const app=await createWorkspace({port:0,trustedReceiptReader:async()=>{
  called++;return {schema:1,source:'V2_CENTRAL_COORDINATOR',
   state:'COMMITTED_FENCED_RECEIPT',workflowId:'wf-one',
   receiptId:'operation-one',digest:'b'.repeat(64),fence:2,
   coordinatorCommitted:true,workerEffectVerified:false};
 }});
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const url='http://127.0.0.1:'+app.port+'/api/fenced-receipt';
 const res=await fetch(url,{headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.state,'COORDINATOR_RECORD_OBSERVED');
 assert.equal(data.receipt.coordinatorCommitted,true);
 assert.equal(data.receipt.workerEffectVerified,false);
 assert.equal(data.receipt.fence,2);
 assert.equal(called,1);
});
test('forged worker success and injected receipt fields are denied without leakage',async t=>{
 for(const fn of [
  async()=>{throw Error('DO_NOT_LEAK_PRIVATE');},
  async()=>({schema:1,source:'V2_CENTRAL_COORDINATOR',
   state:'COMMITTED_FENCED_RECEIPT',workflowId:'wf-one',
   receiptId:'op-one',digest:'a'.repeat(64),fence:2,coordinatorCommitted:true,
   workerEffectVerified:true,private:'DO_NOT_LEAK_PRIVATE'})
 ]){
  const app=await createWorkspace({port:0,trustedReceiptReader:fn});
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const r=await fetch('http://127.0.0.1:'+app.port+'/api/fenced-receipt',{
   headers:{'X-Commander-Workspace-Token':app.token}
  });
  const raw=await r.text();
  assert.equal(r.status,503);
  assert.deepEqual(JSON.parse(raw),{state:'UNVERIFIED',receipt:null});
  assert.doesNotMatch(raw,/DO_NOT_LEAK_PRIVATE/);
 }
});


test('private artifact endpoint is localhost-token-bound and disconnected by default',async t=>{
 const app=await createWorkspace({port:0});
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const url='http://127.0.0.1:'+app.port+'/api/private-artifact';
 assert.equal((await fetch(url)).status,403);
 assert.equal((await fetch(url,{method:'POST'})).status,405);
 const res=await fetch(url,{headers:{'X-Commander-Workspace-Token':app.token}});
 assert.deepEqual(await res.json(),{state:'NOT_CONNECTED',artifact:null});
});
test('private file digest proof does not imply general worker or GUI action',async t=>{
 const app=await createWorkspace({port:0,trustedPrivateArtifactReader:async()=>({
  schema:1,source:'V2_PRIVATE_ARTIFACT_ACTUATOR',
  state:'PRIVATE_ARTIFACT_HASH_VERIFIED',workflowId:'workflow-one',
  receiptId:'artifact-one',digest:'a'.repeat(64),fence:2,
  coordinatorCommitted:true,privateArtifactVerified:true,workerEffectVerified:false
 })});
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const res=await fetch('http://127.0.0.1:'+app.port+'/api/private-artifact',{
  headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.artifact.privateArtifactVerified,true);
 assert.equal(data.artifact.workerEffectVerified,false);
});
test('injected private artifact result returns UNVERIFIED without leakage',async t=>{
 const app=await createWorkspace({port:0,trustedPrivateArtifactReader:async()=>({
  schema:1,source:'V2_PRIVATE_ARTIFACT_ACTUATOR',
  state:'PRIVATE_ARTIFACT_HASH_VERIFIED',workflowId:'workflow-one',
  receiptId:'artifact-one',digest:'a'.repeat(64),fence:2,secret:'DO_NOT_LEAK',
  coordinatorCommitted:true,privateArtifactVerified:true,workerEffectVerified:false
 })});
 t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const res=await fetch('http://127.0.0.1:'+app.port+'/api/private-artifact',{
  headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(res.status,503);
 const text=await res.text();
 assert.deepEqual(JSON.parse(text),{state:'UNVERIFIED',artifact:null});
 assert.doesNotMatch(text,/DO_NOT_LEAK/);
});


test('R10 V1-backed workspace route is token-gated and cannot dispatch writes',async t=>{
 let calls=0;
 const app=await createWorkspace({port:0,v1RuntimeReader:async()=>{calls++;
  return {source:'V1_LOCAL_CORE',state:'LIVE_READ_ONLY',canExecute:false,toolCount:117,
   gui:{available:true,consentedSessionActive:false},workflow:{healthy:true}};}});
 t.after(()=>new Promise(done=>app.server.close(done)));
 const url='http://127.0.0.1:'+app.port+'/api/v1-runtime';
 assert.equal((await fetch(url)).status,403);
 assert.equal((await fetch(url,{method:'POST',headers:{'X-Commander-Workspace-Token':app.token}})).status,405);
 assert.equal(calls,0);
 const response=await fetch(url,{headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
 const result=await response.json();
 assert.equal(result.source,'V1_LOCAL_CORE');
 assert.equal(result.toolCount,117);
 assert.equal(result.canExecute,false);
 assert.equal(calls,1);
 assert.equal((await fetch('http://127.0.0.1:'+app.port+'/api/dispatch',{
   method:'POST',headers:{'X-Commander-Workspace-Token':app.token}})).status,405);
});
test('R10 V1 reader errors cannot return internal data',async t=>{
 const app=await createWorkspace({port:0,v1RuntimeReader:async()=>{throw Error('MY_SECRET_SENSITIVE_VALUE')}});
 t.after(()=>new Promise(done=>app.server.close(done)));
 const response=await fetch('http://127.0.0.1:'+app.port+'/api/v1-runtime',{
   headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(response.status,503);
 const body=await response.text();
 assert.ok(!body.includes('MY_SECRET_SENSITIVE_VALUE'));
 assert.match(body,/UNVERIFIED/);
});

test('CoS-style project details are read only, validated and bearer-gated',async t=>{
  let calls=[];
  const app=await createWorkspace({port:0,v1ProjectReader:async(id)=>{
    calls.push(id);
    return {state:'PERSISTED_WORKFLOW_OBSERVED',canExecute:false,
      isExecutionReceipt:false,project:{id,lifecycle:'INTERRUPTED',steps:[]}};
  }});
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const url='http://127.0.0.1:'+app.port+'/api/v1-project';
  assert.equal((await fetch(url+'?id=study_a')).status,403);
  assert.equal((await fetch(url+'?id=../secrets',{headers:{'X-Commander-Workspace-Token':app.token}})).status,400);
  assert.equal((await fetch(url+'?id=study_a&id=other',{headers:{'X-Commander-Workspace-Token':app.token}})).status,400);
  assert.equal((await fetch(url+'?id=study_a',{method:'POST',headers:{'X-Commander-Workspace-Token':app.token}})).status,405);
  assert.deepEqual(calls,[]);
  const res=await fetch(url+'?id=study_a',{headers:{'X-Commander-Workspace-Token':app.token}});
  assert.equal(res.status,200);
  const observed=await res.json();
  assert.equal(observed.project.id,'study_a');
  assert.equal(observed.canExecute,false);
  assert.equal(observed.isExecutionReceipt,false);
  assert.deepEqual(calls,['study_a']);
});
test('project reader failure is fail closed without stack trace or credentials',async t=>{
  const app=await createWorkspace({port:0,v1ProjectReader:async()=>{throw Error('secret-api-token')}});
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const res=await fetch('http://127.0.0.1:'+app.port+'/api/v1-project?id=study_a',
    {headers:{'X-Commander-Workspace-Token':app.token}});
  assert.equal(res.status,503);
  const body=await res.text();
  assert.ok(!body.includes('secret-api-token'));
  assert.match(body,/UNVERIFIED/);
});


test('continuation handoff can be copied only after token-gated fresh server-side project lookup',async t=>{
 const calls=[];
 const app=await createWorkspace({port:0,
   v1ProjectReader:async id=>{calls.push(id);return {state:'PERSISTED_WORKFLOW_OBSERVED',project:{id},canExecute:false}},
   continuationBuilder:detail=>({state:'MANUAL_CONTINUATION_PREVIEW',content:'Project: '+detail.project.id,
      canExecute:false,canResume:false,sha256:'a'.repeat(64)})
 });
 t.after(()=>new Promise(done=>app.server.close(done)));
 const url='http://127.0.0.1:'+app.port+'/api/v1-handoff';
 assert.equal((await fetch(url+'?id=project_a')).status,403);
 assert.equal((await fetch(url+'?id=project_a',{method:'POST',headers:{'X-Commander-Workspace-Token':app.token}})).status,405);
 assert.equal((await fetch(url+'?id=project_a&id=b',{headers:{'X-Commander-Workspace-Token':app.token}})).status,400);
 assert.equal((await fetch(url+'?id=../../etc/passwd',{headers:{'X-Commander-Workspace-Token':app.token}})).status,400);
 assert.deepEqual(calls,[]);
 const r=await fetch(url+'?id=project_a',{headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(r.status,200);
 assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
 const body=await r.json();
 assert.equal(body.canExecute,false);
 assert.equal(body.canResume,false);
 assert.equal(body.state,'MANUAL_CONTINUATION_PREVIEW');
 assert.deepEqual(calls,['project_a']);
});
test('continuation builder failure remains private and fail closed',async t=>{
 const app=await createWorkspace({port:0,v1ProjectReader:async()=>{throw Error('private-secret-session')}});
 t.after(()=>new Promise(done=>app.server.close(done)));
 const r=await fetch('http://127.0.0.1:'+app.port+'/api/v1-handoff?id=project_a',
   {headers:{'X-Commander-Workspace-Token':app.token}});
 assert.equal(r.status,503);
 const text=await r.text();
 assert.match(text,/UNVERIFIED/);
 assert.ok(!text.includes('private-secret-session'));
});
