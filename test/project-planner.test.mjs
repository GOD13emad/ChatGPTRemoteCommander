import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCommandPlanner } from '../src/project-planner.mjs';

const FIXTURE = `
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const mode = process.argv[2];
let text='';
for await (const chunk of process.stdin) text += chunk;
const proposal = {action:'call',tool:'read_text',argumentsJson:'{"path":"proof.txt"}',summary:'Inspect evidence'};
const flag = name => process.argv[process.argv.indexOf(name)+1];
if (mode === 'echo') { proposal.summary=JSON.parse(text).marker; console.log(JSON.stringify(proposal)); }
if (mode === 'cwd') { proposal.summary=process.cwd(); console.log(JSON.stringify(proposal)); }
if (mode === 'bad') console.log('PRIVATE_CONTEXT not JSON');
if (mode === 'schema') console.log(JSON.stringify({...proposal, authority:true}));
if (mode === 'array') console.log(JSON.stringify({...proposal,argumentsJson:'[]'}));
if (mode === 'exit') { console.error('PRIVATE_CREDENTIAL'); process.exitCode=7; }
if (mode === 'stderr') { console.error('x'.repeat(10000)); setInterval(()=>{},1000); }
if (mode === 'flood') { console.log('x'.repeat(10000)); setInterval(()=>{},1000); }
if (mode === 'wait') setInterval(()=>{},1000);
if (mode === 'tree') {
  spawn(process.execPath,['-e','setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"leaked"),700)',JSON.parse(text).marker],{stdio:'ignore'});
  setInterval(()=>{},1000);
}
if (mode.startsWith('codex')) {
  const context=JSON.parse(text.slice(text.indexOf('\\n')+1));
  if(context.scratchMarker) fs.writeFileSync(context.scratchMarker,process.cwd());
  const schema=JSON.parse(fs.readFileSync(flag('--output-schema'),'utf8'));
  const required=['--ephemeral','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--json'];
  if (flag('--sandbox')!=='read-only' || !required.every(x=>process.argv.includes(x)) || schema.additionalProperties!==false || schema.required.length!==4) process.exit(8);
  const disabled=[]; for(let i=0;i<process.argv.length;i++) if(process.argv[i]==='--disable') disabled.push(process.argv[i+1]);
  if (!['apps','plugins','hooks','shell_tool','unified_exec','computer_use','browser_use','multi_agent'].every(x=>disabled.includes(x))) process.exit(9);
  if(!text.includes('Commander alone executes')) process.exit(10);
  proposal.summary=process.cwd();
  console.log(JSON.stringify({type:'thread.started',thread_id:'fixture'}));
  console.log(JSON.stringify({type:'turn.started'}));
  console.log(JSON.stringify({type:'item.completed',item:{type:mode==='codex-tool'?'command_execution':'agent_message',text:'PRIVATE_PROVIDER_TEXT'}}));
  if(mode!=='codex-incomplete') console.log(JSON.stringify({type:'turn.completed'}));
  if(mode!=='codex-missing') fs.writeFileSync(flag('--output-last-message'),JSON.stringify(proposal));
  if(mode==='codex-large') fs.appendFileSync(flag('--output-last-message'),' '.repeat(10000));
  if(mode==='codex-hardlink') fs.linkSync(flag('--output-last-message'),flag('--output-last-message')+'.link');
}
`;

function fixture(t, mode, overrides = {}) {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-planner-fixture-')));
  const script = path.join(directory, 'provider.mjs');
  fs.writeFileSync(script, FIXTURE);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const planner = createCommandPlanner({ kind: 'command', executable: process.execPath, args: [script, mode], timeoutMs: 5000, ...overrides });
  return { planner, directory };
}

test('plain command receives exact Unicode JSON context without shell interpretation', async t => {
  const { planner } = fixture(t, 'echo');
  const marker = 'سلام `literal` $(unchanged) "quoted"\nnext';
  const result = await planner.plan({ marker });
  assert.equal(result.summary, marker);
  assert.deepEqual(JSON.parse(result.argumentsJson), { path: 'proof.txt' });
});

test('provider runs outside project and owned scratch is removed on success', async t => {
  const { planner } = fixture(t, 'cwd');
  const result = await planner.plan({});
  assert.notEqual(result.summary, process.cwd());
  assert.match(path.basename(result.summary), /^rc-project-planner-/);
  assert.equal(fs.existsSync(result.summary), false);
});

for (const [mode, code] of [['bad','PLANNER_INVALID_JSON'],['schema','PLANNER_INVALID_PROPOSAL'],['array','PLANNER_INVALID_PROPOSAL'],['exit','PLANNER_EXIT_FAILED'],['flood','PLANNER_OUTPUT_LIMIT'],['stderr','PLANNER_OUTPUT_LIMIT']]) {
  test('fail closed and redact provider diagnostics: ' + mode, async t => {
    const { planner } = fixture(t, mode, { maxOutputBytes: 4096 });
    await assert.rejects(planner.plan({}), error => error.code === code && !String(error).includes('PRIVATE'));
  });
}

test('timeout terminates a provider process tree', async t => {
  const { planner, directory } = fixture(t, 'tree', { timeoutMs: 200 });
  const marker = path.join(directory, 'child-effect.txt');
  await assert.rejects(planner.plan({ marker }), { code: 'PLANNER_TIMEOUT' });
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(fs.existsSync(marker), false);
});

test('abort stops an active provider and pre-aborted requests never start', async t => {
  const { planner } = fixture(t, 'wait');
  const controller = new AbortController();
  const pending = planner.plan({}, { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, { code: 'PLANNER_ABORTED' });
  await assert.rejects(planner.plan({}, { signal: controller.signal }), { code: 'PLANNER_ABORTED' });
});

test('missing executable fails without returning operating system details', async () => {
  const planner = createCommandPlanner({ kind: 'command', executable: path.join(os.tmpdir(), 'missing-planner-executable-93ba.exe') });
  await assert.rejects(planner.plan({}), { code: 'PLANNER_START_FAILED', message: 'PLANNER_START_FAILED' });
});

test('input/configuration are bounded and command description hides argv', async t => {
  const { planner } = fixture(t, 'echo');
  assert.throws(() => createCommandPlanner({ kind: 'command', executable: 'x', timeoutMs: 0 }), /INVALID_CONFIG/);
  assert.throws(() => createCommandPlanner({ kind: 'command', executable: 'x', args: ['\0'] }), /INVALID_CONFIG/);
  await assert.rejects(planner.plan({ marker: 'x'.repeat(600000) }), { code: 'PLANNER_INPUT_LIMIT' });
  const circular = {}; circular.self = circular;
  await assert.rejects(planner.plan(circular), { code: 'PLANNER_INVALID_CONTEXT' });
  assert.equal(JSON.stringify(planner.describe()).includes('provider.mjs'), false);
});

test('Codex emits only a validated schema proposal under explicit restrictions', async t => {
  const { planner } = fixture(t, 'codex', { kind: 'codex', model: 'fixture-model' });
  const result = await planner.plan({ goal: 'inspect' });
  assert.equal(result.action, 'call');
  assert.equal(fs.existsSync(result.summary), false);
  assert.equal(planner.describe().model, 'fixture-model');
});

for (const [mode, code] of [['codex-tool','PLANNER_UNEXPECTED_TOOL'],['codex-incomplete','PLANNER_INCOMPLETE_RESULT'],['codex-missing','PLANNER_INCOMPLETE_RESULT'],['codex-large','PLANNER_OUTPUT_LIMIT'],['codex-hardlink','PLANNER_INVALID_RESULT_FILE']]) {
  test('Codex rejects provider evidence: ' + mode, async t => {
    const { planner, directory } = fixture(t, mode, { kind: 'codex', maxOutputBytes: 4096 });
    const scratchMarker = path.join(directory, 'scratch-path.txt');
    await assert.rejects(planner.plan({ scratchMarker }), { code });
    assert.equal(fs.existsSync(fs.readFileSync(scratchMarker,'utf8')), false);
  });
}

test('Claude remains unavailable until the installed client is qualified', async () => {
  const planner = createCommandPlanner({ kind: 'claude', executable: 'claude' });
  assert.equal(planner.describe().available, false);
  await assert.rejects(planner.plan({}), { code: 'PLANNER_PROVIDER_UNAVAILABLE' });
});
