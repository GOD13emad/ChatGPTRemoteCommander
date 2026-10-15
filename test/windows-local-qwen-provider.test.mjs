import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { proposeLocal } from '../examples/provider-adapter/windows-local-qwen3.mjs';
import { localCreditFreeProvider, workCreditRunnerGate, WORK_CREDIT_POLICY } from '../src/no-work-credit-policy.mjs';
import { applyProjectRunnerConfig } from '../src/project-runner-config.mjs';

const win = {skip:process.platform !== 'win32' && 'Windows owner-local model only'};
const script=fileURLToPath(new URL('../examples/provider-adapter/windows-local-qwen3.mjs',import.meta.url));
const sha=crypto=>createHash('sha256').update(fs.readFileSync(crypto)).digest('hex');
const pin='ce7d22362e47a7b71d9cc508e43e0d52503f46d351c47f96f969e9f28e506fa6';
const digest='0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0';
const approved=()=>{
  return {kind:'command',executable:process.execPath,args:[script],model:'qwen3:4b-instruct',
    endpoint:'http://127.0.0.1:18882/api/chat',creditPolicy:WORK_CREDIT_POLICY,
    localOnly:true,scriptSha256:pin};
};
const context=(target='inspection.txt')=>({
  goal:'Read only inspection.txt, do not edit.',
  currentStep:{id:'inspect',title:'Read inspection.txt'},
  tools:[{name:'read_text'}],
  checks:[{criterion:0,type:'file_sha256',path:target,sha256:'a'.repeat(64)}],
  adaptive:{enabled:false},worker:{enabled:false}
});
const providerResponse=(value)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const response={action:'call',tool:'read_text',argumentsJson:'{"path":"inspection.txt"}',summary:'AUTHORIZED_READ_PROPOSED'};
const mocked=(proposal,observed=[])=>async(route,args)=>{
  observed.push({route,method:args?.method??'GET',body:args?.body});
  if(route==='/api/tags')return providerResponse({models:[{name:'qwen3:4b-instruct',digest}]});
  if(route==='/api/chat')return providerResponse({message:{content:JSON.stringify(proposal)}});
  throw Error('UNKNOWN_LOCAL_ENDPOINT');
};

test('Windows local provider is fixed-source, fixed-model, owner opt-in, never Work',{...win},()=>{
  assert.equal(sha(script),pin);
  const p=approved();
  assert.equal(localCreditFreeProvider(p),true);
  assert.equal(workCreditRunnerGate({enabled:true,autoTick:false,provider:p,allowedTools:['read_text']}).allowed,true);
  const local={enabled:true,autoTick:true,provider:p,allowedTools:['read_text'],
    maxActions:2,maxPlannerCalls:3,maxDurationMs:60000};
  assert.equal(workCreditRunnerGate(local).allowed,true);
  for(const q of [
    {...p,endpoint:'https://api.openai.com/v1/chat/completions'},
    {...p,model:'qwen3:4b-instruct:cloud'},
    {...p,scriptSha256:'f'.repeat(64)},
    {...p,executable:'cmd.exe'},
    {...p,args:[script,'unsafe']},
    {...p,adapterFile:script},
    {...p,kind:'codex'}
  ]) assert.equal(localCreditFreeProvider(q),false);
  assert.equal(workCreditRunnerGate({...local,allowedTools:['write_text']}).allowed,false);
  assert.equal(workCreditRunnerGate({...local,maxActions:99}).allowed,false);
  assert.equal(workCreditRunnerGate({...local,adaptive:{enabled:true}}).allowed,false);
  assert.equal(workCreditRunnerGate({...local,worker:{enabled:true}}).allowed,false);
  assert.equal(workCreditRunnerGate({...local,team:{workers:[{id:'extra',role:'extra'}],maxParallel:1}}).allowed,false);
  const cfg={powerMode:{enabled:true},capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:true,disabledCapabilities:[]},
    durableWorkflows:{enabled:true,runner:{enabled:true,provider:p,allowedTools:['read_text']}}};
  const admitted=applyProjectRunnerConfig(cfg,{platform:'win32'});
  assert.equal(admitted.status,'PRESERVED_EXPLICIT_NON_CODEX_PROVIDER');
  assert.equal(admitted.config.durableWorkflows.runner.autoTick,false);
  assert.equal(admitted.config.durableWorkflows.runner.adaptive.enabled,false);
  assert.equal(admitted.config.durableWorkflows.runner.worker.enabled,false);
  assert.equal(admitted.config.durableWorkflows.runner.team,undefined);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-win-provider-'));
  try{
    const copied=path.join(tmp,'windows-local-qwen3.mjs');
    fs.copyFileSync(script,copied);
    fs.appendFileSync(copied,'// changing reviewed bytes\n');
    assert.equal(localCreditFreeProvider({...p,args:[copied]}),false);
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});

test('Windows local adapter only proposes one pre-enrolled exact read',{...win},async()=>{
  const calls=[];
  const proposal=await proposeLocal(context(),{request:mocked(response,calls)});
  assert.deepEqual(proposal,response);
  assert.deepEqual(calls.map(x=>x.route),['/api/tags','/api/chat']);
  const sent=JSON.parse(calls[1].body);
  assert.equal(sent.model,'qwen3:4b-instruct');
  assert.deepEqual(sent.format.properties.argumentsJson.enum,['{"path":"inspection.txt"}','{}']);
  assert.equal(calls[1].method,'POST');
  assert.equal(calls[1].body.includes('OPENAI_API_KEY'),false);
});

test('Windows local adapter fails closed before model for ambiguous file or additional tools',{...win},async()=>{
  for(const bad of [
    context('../secrets.txt'),
    context('C:\\secret.txt'),
    {...context(),checks:[]},
    {...context(),tools:[{name:'read_text'},{name:'write_text'}]},
    {...context(),adaptive:{enabled:true}},
    {...context(),worker:{enabled:true}}
  ]){
    let invoked=false;
    await assert.rejects(proposeLocal(bad,{request:async()=>{invoked=true;throw Error('SHOULD_NOT_CALL')}}));
    assert.equal(invoked,false);
  }
});

test('Windows local adapter validates model digest and tool proposal, rejecting forgery',{...win},async()=>{
  const badCatalog=async()=>providerResponse({models:[{name:'qwen3:4b-instruct',digest:'b'.repeat(64)}]});
  await assert.rejects(proposeLocal(context(),{request:badCatalog}),/LOCAL_MODEL_HASH_MISMATCH/);
  for(const forged of [
    {...response,tool:'run_shell'},
    {...response,argumentsJson:'{"path":"../private"}'},
    {...response,argumentsJson:'{"path":"inspection.txt","tool":"read_text"}'},
    {...response,summary:'I already executed it'},
    {...response,extra:'secret'},
    {action:'block',tool:'',argumentsJson:'{"path":"inspection.txt"}',summary:'POLICY_BLOCKED'}
  ]) await assert.rejects(proposeLocal(context(),{request:mocked(forged)}),/LOCAL_MODEL_PROPOSAL_REJECTED/);
});

test('Windows local adapter accurately surfaces a constrained blocked proposal',{...win},async()=>{
  const denied={action:'block',tool:'',argumentsJson:'{}',summary:'POLICY_BLOCKED'};
  assert.deepEqual(await proposeLocal(context(),{request:mocked(denied)}),denied);
});

test('Windows local adapter is a desktop-only optional capability, not Linux-enabled',()=>{
  if(process.platform!=='win32')
    assert.equal(localCreditFreeProvider({kind:'command',executable:process.execPath,args:[script],
      endpoint:'http://127.0.0.1:18882/api/chat',localOnly:true,creditPolicy:WORK_CREDIT_POLICY,
      model:'qwen3:4b-instruct',scriptSha256:pin}),false);
});
