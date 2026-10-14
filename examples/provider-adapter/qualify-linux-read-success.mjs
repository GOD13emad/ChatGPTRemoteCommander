// Linux-only opt-in authorized read_text end-to-end qualification of native Commander.
// Exactly one read-only tool in a unique temporary root; no production workflow enrolment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createWorkflowTools } from '../../src/workflow-tools.mjs';
import { createCommandPlanner } from '../../src/project-planner.mjs';
import { validateJsonSchema } from '../../src/schema-validator.mjs';
import { readText } from '../../src/tools-v0.3.mjs';

if (process.platform !== 'linux' || process.argv.slice(2).join(' ') !== '--live') {
  process.stderr.write('EXPLICIT_LINUX_LIVE_FLAG_REQUIRED\n');
  process.exit(2);
}
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'linux-local-qwen3.sh');
const tmp = fs.realpathSync.native(os.tmpdir());
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(tmp, 'rc-mmz-read-success-')));
const name = 'inspection.txt';
const fixture = 'MMZ_AUTHORIZED_READ_ONLY_RECEIPT=R1\nThis is a synthetic fixture. No production file is authorized.\n';
const expectedHash = createHash('sha256').update(fixture).digest('hex');
fs.writeFileSync(path.join(root, name), fixture, { flag: 'wx', mode: 0o600 });
const config = {
  allowedRoots: [root], maxReadBytes: 8192, maxWriteBytes: 8192,
  durableWorkflows: {
    enabled: true, directory: path.join(root, 'state'),
    executionTools: ['read_text'],
    runner: {
      enabled: true, autoTick: false, allowedTools: ['read_text'],
      maxActions: 1, maxPlannerCalls: 1, maxDurationMs: 60000
    }
  }
};
let api;
let dispatchCount = 0;
let matchedPath = false;
let created = false;
try {
  const planner = createCommandPlanner({
    kind: 'command', executable: '/bin/sh', args: [script],
    timeoutMs: 30000, maxOutputBytes: 4096, model: 'rc-qwen3-4b:q4km'
  });
  const definition = {
    name: 'read_text', description: 'Read the single synthetic inspection.txt fixture inside the temporary isolated root. This is explicitly permitted.',
    inputSchema: {
      type: 'object', properties: { path: { type: 'string' } },
      required: ['path'], additionalProperties: false
    }
  };
  const ctx = { roots: [root], config, auditLog: path.join(root, 'audit.jsonl') };
  api = createWorkflowTools({
    config, roots: [root], device: 'mmz-linux-read-success-fixture',
    configSha256: '6'.repeat(64), planner, validateSchema: validateJsonSchema,
    lookup: key => key === 'read_text' ? definition : undefined,
    dispatch: async (tool, args) => {
      dispatchCount++;
      matchedPath = tool === 'read_text' && args.path === name;
      if (!matchedPath) throw new Error('UNEXPECTED_OR_UNAUTHORIZED_TOOL_OR_PATH');
      return readText(ctx, args);
    }
  });
  const state = await api.execute('workflow_create', {
    id: 'mmz-native-allowed-read', root,
    goal: 'Use the single explicitly authorized read_text tool to inspect inspection.txt, then let the independent verifier confirm the unchanged fixture hash.',
    acceptance: ['The synthetic inspection.txt has the exact original SHA-256 after read-only inspection.'],
    steps: [{ id: 'inspect', title: 'Perform exactly one authorized read_text call with arguments path inspection.txt, no other tool. The file already exists. It is safe to read and no writes are permitted.' }]
  });
  created = true;
  await api.execute('workflow_run_start', {
    id: 'mmz-native-allowed-read', runId: 'mmz-allowed-read-run',
    expectedRevision: state.state.revision,
    checks: [{ criterion: 0, type: 'file_sha256', path: name, sha256: expectedHash }]
  });
  const t0 = performance.now();
  const first = await api.execute('workflow_run_tick', { runId: 'mmz-allowed-read-run' });
  let second;
  if (first?.status === 'QUEUED' && dispatchCount === 1) {
    second = await api.execute('workflow_run_tick', { runId: 'mmz-allowed-read-run' });
  }
  const recorded = await api.execute('workflow_run_status', { runId: 'mmz-allowed-read-run' });
  const workflow = await api.execute('workflow_get', { id: 'mmz-native-allowed-read' });
  const observed = fs.readFileSync(path.join(root, name));
  const afterHash = createHash('sha256').update(observed).digest('hex');
  const successful = first?.status === 'QUEUED' && (first?.lastCode === 'PROJECT_STEP_RECORDED')
    && second?.status === 'COMPLETED' && recorded?.status === 'COMPLETED'
    && dispatchCount === 1 && matchedPath && afterHash === expectedHash
    && workflow?.state?.steps?.[0]?.status !== 'draft';
  process.stdout.write(JSON.stringify({
    result: successful ? 'NATIVE_ALLOWED_READ_E2E_PASS' : 'NATIVE_ALLOWED_READ_E2E_UNPROVEN',
    firstStatus: first?.status ?? null, firstCode: first?.lastCode ?? null,
    secondStatus: second?.status ?? null, recordedStatus: recorded?.status ?? null,
    dispatchedTools: dispatchCount, exactReadPath: matchedPath,
    originalFixtureSHA256: expectedHash, unchangedFixture: afterHash === expectedHash,
    finalStepStatus: workflow?.state?.steps?.[0]?.status ?? null,
    elapsedMs: Math.round(performance.now() - t0), autoTick: false
  }) + '\n');
  if (!successful) process.exitCode = 1;
} catch (error) {
  process.stderr.write(JSON.stringify({
    result: 'NATIVE_ALLOWED_READ_E2E_ERROR', stage: created ? 'run' : 'setup',
    code: error?.projectCode ?? error?.workflowCode ?? error?.code ?? 'UNKNOWN'
  }) + '\n');
  process.exitCode = 1;
} finally {
  await api?.close();
  if (path.dirname(root) !== tmp || !path.basename(root).startsWith('rc-mmz-read-success-')) {
    process.stderr.write('TEMP_ROOT_OWNERSHIP_MISMATCH\n');
    process.exitCode = 1;
  } else {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
