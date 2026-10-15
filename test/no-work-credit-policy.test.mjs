import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WORK_CREDIT_POLICY, localCreditFreeProvider, workCreditRunnerGate } from '../src/no-work-credit-policy.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const deny = runner => workCreditRunnerGate(runner).allowed;

test('policy denies Work/Codex/Claude/OpenRouter and unknown runners despite FULL_POWER',()=>{
  for (const kind of ['work','codex','claude','openrouter','cloud','other']) {
    assert.equal(deny({enabled:true,provider:{kind,executable:'/bin/true'}}),false,kind);
  }
  assert.equal(workCreditRunnerGate({enabled:false}).status,'RUNNER_OFF');
  assert.equal(WORK_CREDIT_POLICY,'DENY_WORK_CREDITS');
});
test('a command declaration cannot self-certify with a loopback URL or missing pins',()=>{
  const base={enabled:true,provider:{kind:'command',executable:'/bin/sh',args:['/tmp/linux-local-qwen3.sh'],endpoint:'http://127.0.0.1:18080/v1/chat/completions',localOnly:true,creditPolicy:WORK_CREDIT_POLICY}};
  assert.equal(deny(base),false);
  assert.equal(deny({enabled:true,provider:{...base.provider,endpoint:'https://api.openai.com/v1/chat/completions'}}),false);
});
test('only same-directory pinned owner-private local script and adapter may qualify',{skip:process.platform!=='linux'},t=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'rc-credit-policy-'));
  t.after(()=>fs.rmSync(d,{recursive:true,force:true}));
  const script=path.join(d,'linux-local-qwen3.sh'), adapter=path.join(d,'adapter.mjs');
  const approved=path.resolve('examples/provider-adapter');
  fs.copyFileSync(path.join(approved,'linux-local-qwen3.sh'),script);
  fs.copyFileSync(path.join(approved,'adapter.mjs'),adapter);
  fs.chmodSync(script,0o700);
  fs.chmodSync(adapter,0o600);
  const provider={
    kind:'command',executable:'/bin/sh',args:[script],
    endpoint:'http://127.0.0.1:18080/v1/chat/completions',
    localOnly:true,creditPolicy:WORK_CREDIT_POLICY,
    scriptSha256:hash(fs.readFileSync(script)),adapterSha256:hash(fs.readFileSync(adapter)),adapterFile:adapter
  };
  assert.equal(localCreditFreeProvider(provider),true);
  assert.equal(deny({enabled:true,provider,allowedTools:['read_text']}),true);
  const local={enabled:true,autoTick:true,provider,
    allowedTools:['read_text'],maxActions:2,maxPlannerCalls:3,maxDurationMs:60000};
  assert.equal(workCreditRunnerGate(local).allowed,true);
  for(const invalid of [
    {...local,allowedTools:['write_text']},
    {...local,allowedTools:['read_text','run_shell']},
    {...local,team:{workers:[{id:'extra',role:'extra'}],maxParallel:1}},
    {...local,adaptive:{enabled:true}},
    {...local,worker:{enabled:true}},
    {...local,maxActions:25},
    {...local,maxPlannerCalls:500},
    {...local,maxDurationMs:300000},
    {...local,provider:{...provider,endpoint:'https://api.openai.com/v1/chat/completions'}}
  ]) assert.equal(workCreditRunnerGate(invalid).allowed,false);
  fs.appendFileSync(adapter,'// altered\n');
  assert.equal(deny({enabled:true,provider}),false);
  // Recomputing the altered digest does NOT authorize unknown code.
  assert.equal(deny({enabled:true,provider:{
    ...provider,adapterSha256:hash(fs.readFileSync(adapter))}}),false);
  fs.copyFileSync(path.join(approved,'adapter.mjs'),adapter);
  fs.chmodSync(adapter,0o666);
  assert.equal(deny({enabled:true,provider}),false);
  fs.chmodSync(adapter,0o600);
  assert.equal(deny({enabled:true,provider:{...provider,scriptSha256:'f'.repeat(64)}}),false);
  const bad={...provider,args:[script,'unexpected']};
  assert.equal(deny({enabled:true,provider:bad}),false);
  assert.equal(deny({enabled:true,provider:{...provider,endpoint:'http://localhost:18080/v1/chat/completions'}}),false);
});
