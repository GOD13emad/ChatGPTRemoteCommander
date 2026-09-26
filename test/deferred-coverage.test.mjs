import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { powerToolDefinitions } from '../src/power-tools-v0.3.mjs';
import { browserToolDefinitions } from '../src/browser-contract.mjs';

const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const def = (defs,name) => {
  const found=defs.find(x=>x.name===name);
  assert.ok(found,`missing tool definition: ${name}`);
  return found;
};
const max = (definition,property) => definition.inputSchema?.properties?.[property]?.maximum;

test('uncertain-duration direct work is deferred or hard-bounded',()=>{
  const server=read('src/server-v0.3.mjs');
  const power=read('src/power-tools-v0.3.mjs');
  const browserProcess=read('src/browser-process.mjs');
  const guiProcess=read('src/gui-process.mjs');
  const standard=read('src/tools-v0.3.mjs');

  assert.match(server,/AUTO_DEFERRED_MUTATIONS = new Set\(\['copy_path', 'move_path', 'delete_path'\]\)/);
  assert.match(server,/asyncOperationTools\.execute\('operation_start'/);
  assert.match(server,/tool: name,\s*arguments: effectArgs/s);

  assert.equal(max(def(powerToolDefinitions,'run_shell'),'timeoutMs'),15000);
  assert.equal(max(def(powerToolDefinitions,'search_files'),'maxDurationMs'),10000);
  assert.match(power,/PROCESS_LIST_TIMEOUT/);
  assert.match(power,/terminateProcessTree\(session\.child\.pid/);
  assert.match(power,/setTimeout\(resolve, 1500\)/);
  assert.match(power,/setTimeout\(resolve, 500\)/);

  assert.equal(max(def(browserToolDefinitions,'browser_navigate'),'timeoutMs'),30000);
  assert.equal(max(def(browserToolDefinitions,'browser_wait'),'timeoutMs'),30000);
  assert.match(browserProcess,/timeoutMs=15000,startupTimeoutMs=15000/);
  assert.match(guiProcess,/timeoutMs = 15000/);
  assert.match(guiProcess,/startupTimeoutMs = 15000/);

  assert.match(standard,/Math\.min\(512 \* 1024/);
  assert.match(standard,/maxEntries \?\? 200\), 500\)/);
  assert.match(power,/maxBytes: \{ type: 'integer', minimum: 1, maximum: 262144 \}/);
});

test('CSDC-008 scope does not pretend storage stalls are solved',()=>{
  const register=read('docs/CHAT_SAFE_DURABLE_COMPLETION_REGISTER.md');
  assert.match(register,/CSDC-024[^\n]*Transient filesystem\/network-drive policy/);
});

test('turn-safe orchestration advertises bounded direct work and durable continuation',()=>{
  const server=read('src/server-v0.3.mjs');
  assert.match(server,/CHAT_STREAM_SAFE_DIRECT_CALL_BUDGET = 6/);
  assert.match(server,/rapidPollingAllowed: false/);
  assert.match(server,/longWorkMode: 'durable-background'/);
  assert.match(server,/use at most \$\{CHAT_STREAM_SAFE_DIRECT_CALL_BUDGET\} direct synchronous MCP tool calls/);
  assert.match(server,/unknown duration, persist\/continue it through durable workflows, Project Engine, or operation_start/);
});
