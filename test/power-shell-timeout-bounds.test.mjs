import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {boundedPowerShellTimeout} from '../src/shell-timeout-limits.mjs';
import {assessAccessStatus} from '../src/full-access-status.mjs';
import {prepareShellCommand} from '../src/power-tools-v0.3.mjs';
import {runShell as legacyRunShell} from '../src/power-tools.mjs';

function context(root, maxCommandMs = 4000, authorized = true) {
  const config = {
    capabilityProfile: {tier: 'FULL_POWER', explicitlyAuthorized: true, disabledCapabilities: []},
    powerMode: {
      enabled: true, fullFilesystem: true, allowShell: true,
      maxCommandMs, maxOutputBytes: 4096, blockedShellPatterns: []
    }
  };
  // Synthetic test status only; production authorization is separate.
  return {roots: [root], config,
    ...(authorized ? {accessStatus: assessAccessStatus(config, null,
      {platform: 'linux', effectiveUid: 1000})} : {})};
}

test('shared Power Shell timeout validation rejects coercion, non-finite and out-of-range durations', () => {
  for (const invalid of [-1, 0, 0.5, NaN, Infinity, -Infinity,
    3_600_001, 2 ** 31, '3000', true, [], {}]) {
    assert.throws(() => boundedPowerShellTimeout(invalid, 4000),
      /POWER_SHELL_TIMEOUT_INVALID/);
  }
  let coerced = false;
  const trap = {valueOf() {coerced = true; throw Error('VALUE_OF_USED'); }};
  assert.throws(() => boundedPowerShellTimeout(trap, 4000),
    /POWER_SHELL_TIMEOUT_INVALID/);
  assert.equal(coerced, false);
  for (const policy of [-1, 0, 500, NaN, Infinity, '4000', 3_600_001]) {
    assert.throws(() => boundedPowerShellTimeout(1000, policy),
      /POWER_SHELL_TIMEOUT_POLICY_INVALID/);
  }
  assert.equal(boundedPowerShellTimeout(undefined, 4000), 4000);
  assert.equal(boundedPowerShellTimeout(null, 4000), 4000);
  assert.equal(boundedPowerShellTimeout(100, 4000), 1000);
  assert.equal(boundedPowerShellTimeout(5000, 4000), 4000);
  assert.equal(boundedPowerShellTimeout(4000, 4000), 4000);
});

test('both authorized Power Shell routes reject invalid timers before spawning', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-timeout-guard-'));
  const ctx = context(root);
  const command = "Write-Output 'NO_EXECUTION'";
  try {
    for (const invalid of [NaN, Infinity, 2 ** 31, -1, 0.5, '3000']) {
      await assert.rejects(prepareShellCommand(ctx, {command, cwd: root, timeoutMs: invalid}),
        /POWER_SHELL_TIMEOUT_INVALID/);
      await assert.rejects(legacyRunShell(ctx, {command, cwd: root, timeoutMs: invalid}),
        /POWER_SHELL_TIMEOUT_INVALID/);
    }
    for (const policy of [NaN, Infinity, '4000', 3_600_001]) {
      const invalidCtx = context(root, policy);
      await assert.rejects(prepareShellCommand(invalidCtx, {command, cwd: root, timeoutMs: 1000}),
        /POWER_SHELL_TIMEOUT_POLICY_INVALID/);
      await assert.rejects(legacyRunShell(invalidCtx, {command, cwd: root, timeoutMs: 1000}),
        /POWER_SHELL_TIMEOUT_POLICY_INVALID/);
    }
    await assert.rejects(prepareShellCommand(context(root, 4000, false),
      {command, cwd: root, timeoutMs: Infinity}), /Power Mode is disabled/);
    await assert.rejects(legacyRunShell(context(root, 4000, false),
      {command, cwd: root, timeoutMs: Infinity}), /Power Mode is disabled/);
    const valid = await prepareShellCommand(ctx, {command, cwd: root, timeoutMs: 6000});
    assert.equal(valid.timeoutMs, 4000);
    assert.deepEqual(fs.readdirSync(root), [], 'rejected inputs must not spawn or write any files');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
