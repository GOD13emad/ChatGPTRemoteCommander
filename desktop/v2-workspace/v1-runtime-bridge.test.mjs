import test from 'node:test';
import assert from 'node:assert/strict';
import {readLocalV1Runtime,readLocalV1Project,projectGoalGraph,resolveV1Target} from './v1-runtime-bridge.mjs';
const content=(name)=>{
 const fake={
 system_status:{version:'0.11.0-dev.18',platform:'linux',instance:{profile:'default'},
   capabilityProfile:{tier:'FULL_POWER'},durableWorkflows:{automaticExecution:false},
   privateKey:'SHOULD_NOT_LEAK'},
 gui_status:{available:true,backend:'gnome-mutter-remote-desktop',
   consentRequired:true,consentedSessionActive:false,secret:'not-for-ui'},
 browser_status:{available:true,backend:'chromium-cdp',active:false,backgroundOnly:true,
   cookies:['do-not-copy']},
 workflow_health:{ok:true,databaseIntegrity:'ok',scheduler:{automaticExecution:false,
   runnerConfigured:false,pending:0},tasks:[{body:'PRIVATE'}]},
 power_status:{enabled:true,allowShell:true,fullFilesystem:true,credentials:'PRIVATE'},
 workflow_list:{workflows:[{id:'project_one',revision:3,lifecycle:'INTERRUPTED',schedulerEnabled:true,secret:'PRIVATE'}]},
 agent_extension_list:{items:[{name:'hidden-plugin'},{name:'other'}]},
 delegation_status:{active:false,policy:'external-handoff-only',default:'continue_chat',commanderMayLaunchCodex:false,token:'PRIVATE'},
 delivery_status:{durable:true,pending:8,deadLetter:1,unfinishedRequests:3,transportReceipts:15,storage:{root:'/PRIVATE'}},
 workflow_run_status:{configured:true,enabled:true,provider:{available:true,mode:'proposal-only',apiToken:'PRIVATE'},policy:{worker:{enabled:false}},runs:[{status:'BLOCKED',rawArguments:'PRIVATE'},{status:'EXHAUSTED',toolArguments:'PRIVATE'}]}
 };
 return fake[name];
};
test('V1 integration uses fixed read-only tools and explicit safe fields',async ()=>{
 const calls=[];
 const request=async (url,opts)=>{
  assert.equal(url,'http://127.0.0.1:47831/mcp');
  assert.equal(opts.method,'POST');assert.equal(opts.redirect,'error');
  const data=JSON.parse(opts.body);calls.push(data);
  const result=data.method==='tools/list'?{tools:Array.from({length:125},(_,i)=>({name:'tool'+i}))}:
   {content:[{type:'text',text:JSON.stringify(content(data.params.name))}]};
  return {ok:true,headers:{get:()=>'application/json'},text:async()=>JSON.stringify({result})};
 };
 const data=await readLocalV1Runtime({request,os:'linux',uid:1000});
 assert.equal(data.state,'LIVE_READ_ONLY'); assert.equal(data.toolCount,125);
 assert.equal(data.core.tier,'FULL_POWER');assert.equal(data.gui.consentedSessionActive,false);
 assert.equal(data.workflow.automaticExecution,false);assert.equal(data.canExecute,false);
 assert.equal(data.projects.items[0].id,'project_one');
 assert.equal(data.agents.registeredCount,2);
 assert.equal(data.harness.commanderMayLaunchCodex,false);
 assert.equal(data.delivery.pending,8); assert.equal(data.delivery.authenticatedChat,false);
 assert.equal(data.runner.providerMode,'proposal-only'); assert.equal(data.runner.workerEnabled,false);
 assert.deepEqual(data.runner.storedRunStates,{BLOCKED:1,EXHAUSTED:1,COMPLETED:0,RUNNING:0,OTHER:0});
 assert.equal(data.runner.externalEffectsAttested,false);
 assert.equal(data.probes.delivery,'AVAILABLE');
 assert.equal(data.probes.runner,'AVAILABLE');
 assert.deepEqual(Object.keys(data.probes),
  ['gui','browser','workflow','power','projects','extensions','delegation','delivery','catalog','runner']);
 assert.deepEqual(calls.filter(x=>x.method==='tools/call').map(x=>x.params.name),
  ['system_status','gui_status','browser_status','workflow_health','power_status','workflow_list','agent_extension_list','delegation_status','delivery_status','workflow_run_status']);
 assert.equal(calls.filter(x=>x.method==='tools/list').length,1);
 assert.ok(!JSON.stringify(data).includes('PRIVATE'));
 assert.ok(!JSON.stringify(data).includes('SHOULD_NOT_LEAK'));
 assert.ok(!JSON.stringify(data).includes('cookies'));
});
test('root and SYSTEM do not probe local MCP',async ()=>{
 const fail=async()=>{throw Error('should not be called')};
 assert.equal((await readLocalV1Runtime({request:fail,os:'linux',uid:0})).state,'OWNER_SESSION_REQUIRED');
 assert.equal((await readLocalV1Runtime({request:fail,os:'win32',username:'SYSTEM'})).state,'OWNER_SESSION_REQUIRED');
});
test('unavailable and untrusted upstream responses fail closed',async ()=>{
 const bad=async()=>({ok:false,headers:{get:()=>null},text:async()=>''});
 const d=await readLocalV1Runtime({request:bad,os:'linux',uid:1000});
 assert.equal(d.state,'PROFILE_UNVERIFIED');assert.equal(d.toolCount,undefined);
 const malformed=async()=>({ok:true,headers:{get:()=>'application/json'},
  text:async()=>JSON.stringify({result:{content:[{type:'text',text:'{}'}]},error:'denied'})});
 assert.equal((await readLocalV1Runtime({request:malformed,os:'linux',uid:1000})).state,'PROFILE_UNVERIFIED');
});

test('V1 project inspector accepts only IDs enumerated in current V1 WorkflowStore',async()=>{
  const calls=[];
  const request=async(_,options)=>{
    const q=JSON.parse(options.body);
    calls.push(q.method==='tools/call'?q.params.name:'tools/list');
    let d={};
    if(q.method==='tools/list')d={tools:[]};
    else if(q.params.name==='system_status')d={instance:{profile:'default'}};
    else if(q.params.name==='workflow_list')d={workflows:[{id:'study_a',revision:3,lifecycle:'ACTIVE'}]};
    else if(q.params.name==='workflow_get')d={state:{id:'study_a',goal:'Some goal',lifecycleState:'INTERRUPTED',
      revision:4,steps:[{id:'step_1',title:'Safe title',status:'WAITING',dependsOn:[],secret:'PRIVATE'}],
      checkpoint:{epoch:2},root:'/PRIVATE'},acceptanceStatus:'UNVALIDATED',secret:'PRIVATE'};
    const result=q.method==='tools/list'?d:{content:[{type:'text',text:JSON.stringify(d)}]};
    return {ok:true,headers:{get:()=>'application/json'},text:async()=>JSON.stringify({result})};
  };
  const ignored=await readLocalV1Project('study_other',{request,os:'linux',uid:1000});
  assert.equal(ignored.state,'NOT_AVAILABLE');
  assert.ok(!calls.includes('workflow_get'));
  const got=await readLocalV1Project('study_a',{request,os:'linux',uid:1000});
  assert.equal(got.state,'PERSISTED_WORKFLOW_OBSERVED');
  assert.equal(got.canExecute,false);
  assert.equal(got.activeWorkerAttested,false);
  assert.equal(got.ownerChatAuthenticated,false);
  assert.equal(got.project.steps[0].id,'step_1');
  assert.equal(got.project.checkpointPresent,true);
  assert.ok(calls.includes('workflow_get'));
  assert.ok(!JSON.stringify(got).includes('PRIVATE'));
});
test('V1 project inspection rejects invalid identifiers and privileged identities without any tools',async()=>{
  const forbidden=async()=>{throw Error('UNEXPECTED_CALL')};
  assert.equal((await readLocalV1Project('x;run shell',{request:forbidden,os:'linux',uid:1000})).state,'INVALID_ID');
  assert.equal((await readLocalV1Project('study_a',{request:forbidden,os:'linux',uid:0})).state,'OWNER_SESSION_REQUIRED');
  assert.equal((await readLocalV1Project('study_a',{request:forbidden,os:'win32',username:'SYSTEM'})).state,'OWNER_SESSION_REQUIRED');
});

test('R12 projects show V1 operation journal and conversation binding only as observed records',async()=>{
  const calls=[];
  const request=async(_,options)=>{
    const q=JSON.parse(options.body);
    calls.push(q);
    const name=q.params?.name;
    let response={};
    if(q.method==='tools/list')response={tools:[]};
    if(name==='system_status')response={instance:{profile:'default'}};
    if(name==='workflow_list')response={workflows:[{id:'project_a',revision:5,lifecycle:'INTERRUPTED'}]};
    if(name==='workflow_get')response={state:{id:'project_a',goal:'Restore task',steps:[],revision:5,lifecycleState:'INTERRUPTED'},acceptanceStatus:'UNVALIDATED'};
    if(name==='workflow_operations')response={id:'project_a',operations:[{stepId:'s1',status:'DONE',classification:'OBSERVED',resultStatus:'SUCCESS',preStateHash:'a'.repeat(64),postStateHash:'b'.repeat(64),rawArguments:{secret:'do-not-leak'},tool:'run_shell'}]};
    if(name==='conversation_status')response={projectId:'project_a',bound:true,store:{token:'do-not-leak'},pending:[]};
    const result=q.method==='tools/list'?response:{content:[{type:'text',text:JSON.stringify(response)}]};
    return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({result})};
  };
  const answer=await readLocalV1Project('project_a',{request,os:'linux',uid:1000});
  assert.equal(answer.state,'PERSISTED_WORKFLOW_OBSERVED');
  assert.equal(answer.recordedOperations.count,1);
  assert.equal(answer.recordedOperations.items[0].hasPostStateHash,true);
  assert.equal(answer.recordedOperations.items[0].status,'DONE');
  assert.equal(answer.binding.projectHasConversationBinding,true);
  assert.equal(answer.binding.currentChatAttested,false);
  assert.equal(answer.binding.mayWakeWorker,false);
  assert.equal(answer.canExecute,false);
  assert.ok(!JSON.stringify(answer).includes('do-not-leak'));
  assert.ok(!JSON.stringify(answer).includes('run_shell'));
  assert.equal(calls.find(v=>v.params?.name==='conversation_status').params.arguments.projectId,'project_a');
});
test('R12 forged/missing additional V1 reports cannot prove a receipt, a chat or a Worker',async()=>{
  const request=async(_,options)=>{
    const q=JSON.parse(options.body),name=q.params?.name;
    let response={};
    if(q.method==='tools/list')response={tools:[]};
    if(name==='system_status')response={instance:{profile:'default'}};
    if(name==='workflow_list')response={workflows:[{id:'project_a',revision:5,lifecycle:'INTERRUPTED'}]};
    if(name==='workflow_get')response={state:{id:'project_a',goal:'Verify',steps:[],revision:5,lifecycleState:'INTERRUPTED'}};
    if(name==='workflow_operations')response={id:'another_project',operations:[{status:'DONE'}]};
    if(name==='conversation_status')response={projectId:'another_project',bound:true};
    const result=q.method==='tools/list'?response:{content:[{type:'text',text:JSON.stringify(response)}]};
    return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({result})};
  };
  const answer=await readLocalV1Project('project_a',{request,os:'linux',uid:1000});
  assert.equal(answer.state,'PERSISTED_WORKFLOW_OBSERVED');
  assert.equal(answer.recordedOperations,null);
  assert.equal(answer.binding,null);
  assert.equal(answer.activeWorkerAttested,false);
  assert.equal(answer.ownerChatAuthenticated,false);
});

test('R13 saved V1 dependencies create CoS-style observable graph without action authority',()=>{
 const a=projectGoalGraph([
  {id:'a',title:'Done',status:'DONE',dependsOn:[]},
  {id:'b',title:'Planned',status:'WAITING',dependsOn:['a']},
  {id:'c',title:'Blocked',status:'PENDING',dependsOn:['b']}
 ]);
 assert.equal(a.state,'PERSISTED_DEPENDENCY_GRAPH');
 assert.equal(a.canExecute,false);
 assert.deepEqual(a.counts,{recordedComplete:1,dependencySatisfied:1,dependencyBlocked:1,unknown:0});
 assert.equal(a.nodes[1].status,'DEPENDENCIES_SATISFIED_STORED_ONLY');
 assert.equal(a.nodes[2].status,'DEPENDENCY_BLOCKED_STORED_ONLY');
 assert.deepEqual(a.nodes[2].dependencies,['b']);
});
test('R13 invalid, cycle, duplicates and partial V1 graphs fail closed',()=>{
 for(const steps of [
  [{id:'a',status:'WAITING',dependsOn:['z']}],
  [{id:'a',status:'WAITING',dependsOn:['b']},{id:'b',status:'WAITING',dependsOn:['a']}],
  [{id:'a',status:'WAITING',dependsOn:[]},{id:'a',status:'WAITING',dependsOn:[]}],
  [{id:'a',status:'WAITING',dependsOn:['a','a']}],
  Array.from({length:51},(_,i)=>({id:'n'+i,status:'PENDING',dependsOn:[]}))
 ]){
  const x=projectGoalGraph(steps);
  assert.equal(x.state,'UNVERIFIED');
  assert.equal(x.canExecute,false);
  assert.deepEqual(x.nodes,[]);
 }
});
test('R13 completed V1 state never implies current chat, Worker or tool permission',()=>{
 const x=projectGoalGraph([{id:'done',status:'COMPLETED',dependsOn:[]},
   {id:'next',status:'WAITING',dependsOn:['done']}]);
 assert.equal(x.nodes[1].status,'DEPENDENCIES_SATISFIED_STORED_ONLY');
 assert.equal(x.canExecute,false);
 assert.ok(!Object.hasOwn(x,'ownerChatAuthenticated'));
 assert.ok(!Object.hasOwn(x,'dispatch'));
});

test('R15 explicit local V1 target rejects arbitrary routes, missing profile and redirect origins',()=>{
 assert.deepEqual(resolveV1Target({endpoint:undefined,expectedProfile:undefined}),
   {state:'CONFIGURED',endpoint:'http://127.0.0.1:47831/mcp',expectedProfile:'default'});
 for(const [endpoint,expectedProfile] of [
  ['http://127.0.0.1:47910/mcp',undefined],
  [undefined,'MMZ'],['http://127.0.0.1:47910/mcp','../x'],
  ['http://localhost:47910/mcp','MMZ'],
  ['http://127.0.0.1:47910/mcp?tool=write','MMZ'],
  ['http://127.0.0.1:47910/other','MMZ'],
  ['http://127.0.0.1:47910/mcp#fragment','MMZ'],
  ['http://127.0.0.1:47910@evil.example/mcp','MMZ'],
  ['https://127.0.0.1:47910/mcp','MMZ']
 ])assert.equal(resolveV1Target({endpoint,expectedProfile}).state,'PROFILE_TARGET_INVALID');
 assert.equal(resolveV1Target({endpoint:'http://127.0.0.1:47910/mcp',expectedProfile:'MMZ'}).state,'CONFIGURED');
});
test('R15 wrong-profile V1 instance fails before reading any WorkflowStore data',async()=>{
 const methods=[];
 const request=async(url,opts)=>{
  methods.push(JSON.parse(opts.body).params?.name||'tools/list');
  assert.equal(url,'http://127.0.0.1:47910/mcp');
  return {ok:true,headers:{get:()=>'application/json'},
    text:async()=>JSON.stringify({result:{content:[{type:'text',text:'{"instance":{"profile":"default"}}'}]}})};
 };
 const d=await readLocalV1Runtime({request,os:'linux',uid:1000,
   endpoint:'http://127.0.0.1:47910/mcp',expectedProfile:'MMZ'});
 assert.equal(d.state,'PROFILE_MISMATCH');
 assert.equal(d.expectedProfile,'MMZ');
 assert.equal(d.canExecute,false);
 assert.deepEqual(methods,['system_status']);
 const p=await readLocalV1Project('study_a',{request,os:'linux',uid:1000,
   endpoint:'http://127.0.0.1:47910/mcp',expectedProfile:'MMZ'});
 assert.equal(p.state,'PROFILE_MISMATCH');
 assert.deepEqual(methods,['system_status','system_status']);
});
test('R15 selected same-owner profile reads only from exact pinned loopback port',async()=>{
 const urls=[];
 const request=async(url,opts)=>{
  urls.push(url);
  const call=JSON.parse(opts.body);
  const name=call.params?.name;
  const datum=name==='system_status'?{instance:{profile:'MMZ'},version:'0.11'}:
    name==='workflow_list'?{workflows:[]}:call.method==='tools/list'?{tools:[]}:{};
  const result=call.method==='tools/list'?datum:{content:[{type:'text',text:JSON.stringify(datum)}]};
  return {ok:true,headers:{get:()=>'application/json'},
    text:async()=>JSON.stringify({result})};
 };
 const a=await readLocalV1Runtime({request,os:'linux',uid:1000,
   endpoint:'http://127.0.0.1:47910/mcp',expectedProfile:'MMZ'});
 assert.equal(a.state,'LIVE_READ_ONLY');assert.equal(a.core.profile,'MMZ');
 assert.equal(a.selectedProfile,'MMZ');assert.equal(a.canExecute,false);
 assert.ok(urls.length>2);
 assert.deepEqual([...new Set(urls)],['http://127.0.0.1:47910/mcp']);
});

test('R16 wrong profile does not read V1 run status',async()=>{
 const calls=[];
 const request=async(_,args)=>{
  const d=JSON.parse(args.body);calls.push(d.params?.name);
  return {ok:true,headers:{get:()=> 'application/json'},
    text:async()=>JSON.stringify({result:{content:[{type:'text',text:'{"instance":{"profile":"default"}}'}]}})};
 };
 const x=await readLocalV1Runtime({os:'linux',uid:1000,request,
    endpoint:'http://127.0.0.1:47910/mcp',expectedProfile:'MMZ'});
 assert.equal(x.state,'PROFILE_MISMATCH');
 assert.deepEqual(calls,['system_status']);
});
test('R16 runner status cannot expose raw arguments or assert actual worker effects',async()=>{
 const request=async(_,options)=>{
  const req=JSON.parse(options.body),name=req.params?.name;
  const content=name==='system_status'?{instance:{profile:'default'}}:
    name==='workflow_run_status'?{configured:true,enabled:true,
      provider:{available:true,mode:'proposal-only',secret:'NEVER_LEAK'},
      policy:{worker:{enabled:false}},
      runs:[{status:'COMPLETED',toolArguments:'NEVER_LEAK',receipt:{secret:'NEVER_LEAK'}}]}:
    name==='workflow_list'?{workflows:[]}:req.method==='tools/list'?{tools:[]}:{};
  const result=req.method==='tools/list'?content:{content:[{type:'text',text:JSON.stringify(content)}]};
  return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({result})};
 };
 const z=await readLocalV1Runtime({os:'linux',uid:1000,request});
 assert.equal(z.runner.observedRunCount,1);
 assert.equal(z.runner.storedRunStates.COMPLETED,1);
 assert.equal(z.runner.externalEffectsAttested,false);
 assert.equal(z.runner.canExecuteFromWorkspace,false);
 assert.ok(!JSON.stringify(z).includes('NEVER_LEAK'));
});

test('R17 identifies timed-out optional V1 probe without leaking upstream error or enabling execution',async()=>{
 const secret='PRIVATE-UPSTREAM-ERROR-MUST-NOT-LEAK';
 const request=async(_,options)=>{
  const data=JSON.parse(options.body),name=data.params?.name;
  if(name==='delivery_status'||name==='workflow_run_status')
    throw Object.assign(new Error(secret),{name:'TimeoutError'});
  const result=data.method==='tools/list'?{tools:[]}:
    {content:[{type:'text',text:JSON.stringify(
     name==='system_status'?{instance:{profile:'default'}}:
       name==='workflow_list'?{workflows:[]}:content(name)||{})}]};
  return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({result})};
 };
 const d=await readLocalV1Runtime({request,os:'linux',uid:1000});
 assert.equal(d.state,'DEGRADED_READ_ONLY');
 assert.equal(d.probes.delivery,'TIMEOUT');
 assert.equal(d.probes.runner,'TIMEOUT');
 assert.equal(d.probes.projects,'AVAILABLE');
 assert.equal(d.runner,null);
 assert.equal(d.delivery,null);
 assert.equal(d.canExecute,false);
 assert.ok(!JSON.stringify(d).includes(secret));
});
test('R17 fails closed with generic UNVERIFIED probe state and no raw exception',async()=>{
 const request=async(_,opts)=>{
  const d=JSON.parse(opts.body),name=d.params?.name;
  if(name==='gui_status')throw Error('PRIVATE_EXCEPTION_DETAILS');
  const result=d.method==='tools/list'?{tools:[]}:
    {content:[{type:'text',text:JSON.stringify(
      name==='system_status'?{instance:{profile:'default'}}:
      name==='workflow_list'?{workflows:[]}:content(name)||{})}]};
  return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({result})};
 };
 const d=await readLocalV1Runtime({request,os:'linux',uid:1000});
 assert.equal(d.probes.gui,'UNVERIFIED');
 assert.equal(d.canExecute,false);
 assert.ok(!JSON.stringify(d).includes('PRIVATE_EXCEPTION_DETAILS'));
});
