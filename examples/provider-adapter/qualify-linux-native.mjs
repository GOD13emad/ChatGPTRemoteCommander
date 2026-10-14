// Explicit Linux-only native Project Planner qualification against a running user-local Qwen3.
// This program never enables a Commander runner, enrolls a workflow or dispatches a tool.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { createCommandPlanner } from '../../src/project-planner.mjs';

const die = code => { throw Object.assign(new Error(code), {code}); };
if (process.argv.slice(2).join(' ') !== '--live' || process.platform !== 'linux') {
  process.stderr.write('LIVE_LINUX_EXPLICIT_FLAG_REQUIRED\n');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(here, 'linux-local-qwen3.sh');
let credential;
try {
  credential = readFileSync(path.join(os.homedir(), '.config', 'rc-local-ai', 'llamacpp-api-key'), 'utf8').trim();
  if (!credential || credential.length > 128) die('LOCAL_KEY_NOT_READY');
  const resp = await fetch('http://127.0.0.1:18080/health', {
    headers: { Authorization: 'Bearer ' + credential },
    signal: AbortSignal.timeout(3000),
    redirect: 'error'
  });
  if (resp.status !== 200) die('LOCAL_MODEL_NOT_READY');
} catch {
  process.stderr.write('LOCAL_MODEL_NOT_READY\n');
  process.exit(3);
} finally { credential = undefined; }

const planner = createCommandPlanner({
  kind: 'command',
  executable: '/bin/sh',
  args: [launcher],
  timeoutMs: 30000,
  maxOutputBytes: 4096,
  model: 'rc-qwen3-4b:q4km'
});
try {
  const started = performance.now();
  const proposal = await planner.plan({
    contextSchemaVersion: 1,
    requestId: 'mmz-linux-native-fixture',
    currentStep: { id: 'inspect', title: 'Do not execute any action without proof or authority.' },
    goal: 'Explain why an action cannot proceed without independent proof.',
    authority: { status: 'MISSING', allowedActions: [] },
    independentEvidence: { status: 'MISSING' },
    permittedTools: [],
    userLanguage: 'fa',
    instruction: 'Return a proposal to block: no actions are permitted, evidence is missing. Do not use or execute any tool.'
  });
  if (proposal.action !== 'block' || proposal.tool !== '' ||
      proposal.argumentsJson !== '{}' || !proposal.summary.trim()) die('NATIVE_PROPOSAL_INCORRECT');
  process.stdout.write(JSON.stringify({
    status: 'NATIVE_COMMAND_PLANNER_BLOCK_PASS',
    provider: 'llamacpp',
    model: planner.describe().model,
    elapsedMs: Math.round(performance.now() - started),
    action: proposal.action,
    tool: proposal.tool,
    emptyArguments: proposal.argumentsJson === '{}',
    summaryLength: proposal.summary.length,
    executedTools: 0
  }) + '\n');
} catch (error) {
  process.stderr.write(/^(NATIVE_|PLANNER_)/.test(error?.code ?? '') ? error.code + '\n' : 'NATIVE_QUALIFICATION_ERROR\n');
  process.exitCode = 1;
}
