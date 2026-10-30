import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorCore,operatorToolDefinitions} from '../src/operator-core.mjs';

const tools=[
 'operator_status','operator_route','operator_advance',
 'workflow_create','workflow_run_start','workflow_run_tick',
 'read_text','write_text','run_shell',
 'browser_session_begin','browser_navigate','browser_snapshot','browser_session_end',
 'workspace_target_list','workspace_target_open','workspace_target_snapshot','system_status'
];
const fixture=(overrides={})=>{
 const config=overrides.config??{
  powerMode:{enabled:true,allowShell:true,browserControl:{requireExistingUserSession:true}},
  durableWorkflows:{enabled:true}
 };
 let tickCalls=0;
 const operator=createOperatorCore({
  config,platform:overrides.platform??'win32',
  toolNames:()=>overrides.tools??tools,
  readWorkflow:overrides.readWorkflow??(async()=>({enabled:true,runnerConfigured:true,automaticExecution:false})),
  readBrowser:overrides.readBrowser??(async()=>({available:true,backend:'chromium-cdp',policy:{requireExistingUserSession:true,allowOwnedIsolatedSession:false}})),
  readGui:overrides.readGui??(async()=>({available:true,backend:'cua-owner'})),
  readProvenance:overrides.readProvenance,
  advance:overrides.advance===null?undefined:async (runId,requestId)=>{tickCalls++;return {runId,requestId,status:'QUEUED',tickCalls};}
 });
 return {operator,get tickCalls(){return tickCalls;}};
};
test('uniform public operator schema has distinct read-only and effect tools',()=>{
 const names=operatorToolDefinitions.map(t=>t.name);
 assert.deepEqual(names,['operator_status','operator_route','operator_advance']);
 assert.equal(new Set(names).size,3);
 assert.equal(operatorToolDefinitions[0].annotations.readOnlyHint,true);
 assert.equal(operatorToolDefinitions[2].annotations.readOnlyHint,false);
 assert.deepEqual(operatorToolDefinitions[2].inputSchema.required,['runId','requestId']);
});
test('operator status reports actual engine and stable single-authority contract',async()=>{
 const x=await fixture().operator.execute('operator_status');
 assert.equal(x.schema,1);
 assert.equal(x.operator,'CHAT_OWNED');
 assert.equal(x.architecture,'SINGLE_EXISTING_COMMANDER_EXECUTOR');
 assert.equal(x.routes.workflow,true);
 assert.equal(x.workflow.automaticExecution,false);
 assert.equal(x.guarantees.universalAdminOrRoot,false);
 assert.equal(x.guarantees.autonomousUnenrolledRuns,false);
});
test('startup provenance is strictly hash-only and never reflects arbitrary paths or secrets',async()=>{
 const sha='a'.repeat(64),cfg='b'.repeat(64);
 const f=fixture({readProvenance:async()=>({
  entrypointSha256:sha,configSha256:cfg,nodeVersion:'v26.13.0',
  declaredVersion:'0.11.0-dev.18',rawPath:'/home/private/secrets',secret:'opaque'
 })}).operator;
 const r=(await f.execute('operator_status')).provenance;
 assert.deepEqual(r,{
  available:true,kind:'ON_DISK_SOURCE_HASH_AT_STARTUP_NOT_LOADED_MODULE_ATTESTATION',
  entrypointSha256:sha,nodeVersion:'v26.13.0',declaredVersion:'0.11.0-dev.18',
  configSha256:cfg
 });
 assert.equal(JSON.stringify(r).includes('private'),false);
});
test('unavailable and malformed provenance are fail-closed and do not block route selection',async()=>{
 const missing=(await fixture().operator.execute('operator_status')).provenance;
 assert.deepEqual(missing,{available:false,reason:'SOURCE_PROVENANCE_NOT_EXPOSED'});
 const bad=fixture({readProvenance:async()=>({entrypointSha256:'../../wrong'})}).operator;
 assert.equal((await bad.execute('operator_status')).provenance.reason,'SOURCE_PROVENANCE_INVALID');
 const failing=fixture({readProvenance:async()=>{throw Error('private path');}}).operator;
 assert.equal((await failing.execute('operator_status')).provenance.reason,'STATUS_UNAVAILABLE');
 assert.equal((await failing.execute('operator_route',{kind:'project'})).state,'GATED');
});
test('project plans use already-enrolled engine, not a new scheduler',async()=>{
 const v=await fixture().operator.execute('operator_route',{kind:'project'});
 assert.equal(v.state,'GATED');assert.equal(v.reason,'EXPLICIT_PROJECT_ENROLLMENT_REQUIRED');
 assert.deepEqual(v.next,['workflow_create','workflow_run_start','operator_advance']);
});
test('project cannot claim readiness without actual registered runner',async()=>{
 const r=await fixture({readWorkflow:async()=>({enabled:true,runnerConfigured:false})}).operator.execute('operator_route',{kind:'project'});
 assert.equal(r.state,'BLOCKED');
 assert.equal(r.reason,'PROJECT_RUNNER_NOT_CONFIGURED');
});
test('isolated Commander browser is denied under user-session policy by default',async()=>{
 const r=await fixture().operator.execute('operator_route',{kind:'owned_browser'});
 assert.equal(r.state,'BLOCKED');
 assert.equal(r.reason,'EXISTING_USER_SESSION_POLICY_BLOCKS_ISOLATED_PROFILE');
});
test('ephemeral browser requires explicit config AND live backend policy',async()=>{
 const config={powerMode:{enabled:true,allowShell:true,browserControl:{
  requireExistingUserSession:true,allowOwnedIsolatedSession:true
 }}};
 const half=await fixture({config}).operator.execute('operator_route',{kind:'owned_browser'});
 assert.equal(half.state,'BLOCKED');
 const full=await fixture({config,readBrowser:async()=>({available:true,policy:{
  requireExistingUserSession:true,allowOwnedIsolatedSession:true
 }})}).operator.execute('operator_route',{kind:'owned_browser'});
 assert.equal(full.state,'READY');
 assert.equal(full.reason,'COMMANDER_OWNED_EPHEMERAL_PROFILE_ONLY');
});
test('legacy optional isolated profile is reported only if backend has capability',async()=>{
 const config={powerMode:{enabled:true,allowShell:true,browserControl:{requireExistingUserSession:false}}};
 const r=await fixture({config,readBrowser:async()=>({available:true,policy:{requireExistingUserSession:false}})}).operator.execute('operator_route',{kind:'owned_browser'});
 assert.equal(r.state,'READY');
});
test('user browser never inherits owned-isolated permission',async()=>{
 const r=await fixture().operator.execute('operator_route',{kind:'user_browser'});
 assert.equal(r.state,'GATED');
 assert.equal(r.reason,'OWNER_SESSION_AUTHORIZATION_REQUIRED');
});
test('desktop authorization is separate from available GUI backend',async()=>{
 const yes=await fixture().operator.execute('operator_route',{kind:'desktop'});
 assert.equal(yes.state,'GATED');
 const no=await fixture({readGui:async()=>({available:false})}).operator.execute('operator_route',{kind:'desktop'});
 assert.equal(no.state,'BLOCKED');
 assert.equal(no.reason,'GUI_SESSION_UNAVAILABLE');
});
test('platform-independent tool contract remains identical in headless mode',async()=>{
 const win=fixture({platform:'win32',readGui:async()=>({available:false})}).operator;
 const linux=fixture({platform:'linux',readGui:async()=>({available:false})}).operator;
 assert.equal((await win.execute('operator_route',{kind:'desktop'})).state,
              (await linux.execute('operator_route',{kind:'desktop'})).state);
 assert.deepEqual(win.definitions.map(x=>x.name),linux.definitions.map(x=>x.name));
});
test('shell and filesystem route respect executable policy and registered tools',async()=>{
 const c={powerMode:{enabled:false,allowShell:false,browserControl:{}}};
 const x=fixture({config:c}).operator;
 assert.equal((await x.execute('operator_route',{kind:'file'})).state,'READY');
 assert.equal((await x.execute('operator_route',{kind:'shell'})).state,'BLOCKED');
});
test('unavailable subsystem and status error fail closed without leaking details',async()=>{
 const f=fixture({readBrowser:async()=>{throw Error('private dynamic status');}}).operator;
 const s=await f.execute('operator_status');
 assert.equal(s.browser.available,false);
 assert.equal(s.browser.reason,'STATUS_UNAVAILABLE');
 assert.equal((await f.execute('operator_route',{kind:'owned_browser'})).state,'BLOCKED');
});
test('operator advances exactly one existing run step through injected engine',async()=>{
 const f=fixture();
 const r=await f.operator.execute('operator_advance',{runId:'my_run',requestId:'step-one'});
 assert.deepEqual(r,{runId:'my_run',requestId:'step-one',status:'QUEUED',tickCalls:1});
 assert.equal(f.tickCalls,1);
});
test('invalid run identifiers cannot invoke the underlying workflow',async()=>{
 const f=fixture();
 await assert.rejects(f.operator.execute('operator_advance',{runId:'../../other',requestId:'safe-one'}),/OPERATOR_RUN_ID_INVALID/);
 await assert.rejects(f.operator.execute('operator_advance',{runId:'valid',requestId:'../unsafe'}),/OPERATOR_REQUEST_ID_INVALID/);
 await assert.rejects(f.operator.execute('operator_advance',{runId:'valid'}),/OPERATOR_REQUEST_ID_INVALID/);
 assert.equal(f.tickCalls,0);
});
test('no engine / disabled workflow refuses delegated effects',async()=>{
 const f=fixture({readWorkflow:async()=>({enabled:false,runnerConfigured:false})});
 await assert.rejects(f.operator.execute('operator_advance',{runId:'project',requestId:'step-one'}),/OPERATOR_RUNNER_UNAVAILABLE/);
 assert.equal(f.tickCalls,0);
});
test('release route preserves exact build and user acceptance gates',async()=>{
 const r=await fixture().operator.execute('operator_route',{kind:'release'});
 assert.equal(r.state,'GATED');
 assert.equal(r.reason,'EXACT_BUILD_CI_NATIVE_INSTALL_AND_ACCEPTANCE_REQUIRED');
});
test('unknown operator methods and task kinds are rejected',async()=>{
 const f=fixture().operator;
 await assert.rejects(f.execute('operator_route',{kind:'arbitrary_admin'}),/OPERATOR_KIND_INVALID/);
 await assert.rejects(f.execute('operator_exec_root',{runId:'x'}),/OPERATOR_TOOL_UNKNOWN/);
});
