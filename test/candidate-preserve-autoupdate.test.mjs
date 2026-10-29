import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('candidate preserve mode keeps existing profile auto-update disabled', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-autoupdate-preserve-'));
  try {
    const defaults = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    defaults.autoUpdate = { enabled: true, zeroDowntime: true, channel: 'stable', intervalMinutes: 15 };
    const existing = structuredClone(defaults);
    existing.autoUpdate = { enabled: false, zeroDowntime: false, channel: 'stable', intervalMinutes: 60 };
    const original = path.join(tmp, 'prior.json');
    const baseline = path.join(tmp, 'default.json');
    const output = path.join(tmp, 'candidate.json');
    fs.writeFileSync(baseline, JSON.stringify(defaults));
    fs.writeFileSync(original, JSON.stringify(existing));
    const run = spawnSync(process.execPath, [
      'tools/build-candidate-config.mjs', '--default', baseline,
      '--existing', original, '--output', output, '--profile-id', 'test-profile',
      '--port', '49123', '--state-dir', path.join(tmp, 'state'), '--mode', 'preserve'
    ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 12000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const candidate = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(candidate.autoUpdate.enabled, false);
    assert.equal(candidate.autoUpdate.zeroDowntime, false);
    assert.equal(candidate.autoUpdate.intervalMinutes, 60);
    assert.equal(candidate.port, 49123);
    assert.equal(candidate.instance.profile, 'test-profile');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
