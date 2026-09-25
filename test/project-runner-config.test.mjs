import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { enableProjectRunner } from '../src/runner-config.mjs';
import { createCommandPlanner } from '../src/project-planner.mjs';

test('runner config preserves historical configured timeout while planner execution stays bounded', () => {
  const config = { durableWorkflows: { enabled: true } };
  const runner = enableProjectRunner(config, {
    executable: 'placeholder', kind: 'command', timeoutMs: 120000, maxOutputBytes: 2 * 1024 * 1024
  });
  assert.equal(runner.provider.timeoutMs, 120000);
  const planner = createCommandPlanner(runner.provider);
  assert.equal(planner.describe().timeoutMs, 30000);
});

test('cross-platform runner configurator enables automatic project execution without rewriting valid timeout', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-runner-config-'));
  try {
    const configPath = path.join(temp, 'config.json');
    const provider = path.join(temp, process.platform === 'win32' ? 'provider.exe' : 'provider');
    await fs.writeFile(provider, 'provider');
    await fs.writeFile(configPath, JSON.stringify({ durableWorkflows: { enabled: true, directory: path.join(temp, 'workflows') } }, null, 2));
    const run = spawnSync(process.execPath, [
      fileURLToPath(new URL('../tools/configure-project-runner.mjs', import.meta.url)),
      '--config', configPath,
      '--provider-executable', provider,
      '--timeout-ms', '120000',
      '--max-output-bytes', String(2 * 1024 * 1024)
    ], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const updated = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.equal(updated.durableWorkflows.runner.enabled, true);
    assert.equal(updated.durableWorkflows.runner.autoTick, true);
    assert.equal(updated.durableWorkflows.runner.provider.timeoutMs, 120000);
    assert.equal(updated.durableWorkflows.runner.provider.maxOutputBytes, 2 * 1024 * 1024);
    assert.deepEqual(updated.durableWorkflows.runner.allowedTools,
      ['list_directory','read_text','file_info','write_text','create_directory']);
    assert.equal(updated.durableWorkflows.runner.team.workers.length, 2);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('candidate config migration preserves a valid historical runner timeout', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-runner-migrate-'));
  try {
    const defaultPath = fileURLToPath(new URL('../config.json', import.meta.url));
    const defaults = JSON.parse(await fs.readFile(defaultPath, 'utf8'));
    const existing = structuredClone(defaults);
    existing.durableWorkflows = {
      enabled: true,
      directory: path.join(temp, 'old-workflows'),
      runner: {
        enabled: true,
        autoTick: true,
        provider: { kind: 'codex', executable: path.join(temp, 'codex'), timeoutMs: 120000, maxOutputBytes: 2 * 1024 * 1024 }
      }
    };
    const existingPath = path.join(temp, 'existing.json');
    const outputPath = path.join(temp, 'candidate.json');
    await fs.writeFile(existingPath, JSON.stringify(existing, null, 2));
    const run = spawnSync(process.execPath, [
      fileURLToPath(new URL('../tools/build-candidate-config.mjs', import.meta.url)),
      '--default', defaultPath,
      '--existing', existingPath,
      '--output', outputPath,
      '--profile-id', 'default',
      '--port', '49001',
      '--state-dir', path.join(temp, 'state'),
      '--workflow-dir', path.join(temp, 'workflows'),
      '--mode', 'preserve'
    ], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const migrated = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.equal(migrated.durableWorkflows.runner.provider.timeoutMs, 120000);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
