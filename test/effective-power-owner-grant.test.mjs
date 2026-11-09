import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {effectivePowerMode} from '../src/effective-power-mode.mjs';
import {runShell} from '../src/power-tools-v0.3.mjs';

function config(tier, explicitlyAuthorized, disabledCapabilities = []) {
  return {
    powerMode: {
      enabled: true, fullFilesystem: true, allowShell: true,
      allowProcessControl: true, maxCommandMs: 4000,
      maxOutputBytes: 4096, blockedShellPatterns: []
    },
    capabilityProfile: {tier, explicitlyAuthorized, disabledCapabilities}
  };
}

test('raw FULL flags cannot execute Shell in STANDARD or without owner grant', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rc-effective-power-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  for (const cfg of [config('STANDARD', false), config('STANDARD', true),
    config('FULL_POWER', false), config('FULL_POWER', true, ['shell.execute'])]) {
    assert.equal(effectivePowerMode(cfg).allowShell, false);
    await assert.rejects(
      runShell({roots: [dir], config: cfg}, {
        command: 'echo SHOULD_NOT_RUN', cwd: dir, timeoutMs: 2000
      }),
      /shell execution is disabled|Power Mode is disabled/i
    );
  }
});

test('a separately authorized owner FULL_POWER grant executes only harmless local echo', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rc-effective-grant-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const cfg = config('FULL_POWER', true);
  assert.equal(effectivePowerMode(cfg).allowShell, true);
  const result = await runShell({roots: [dir], config: cfg},
    {command: 'echo OWNER_GRANTED_TEST', cwd: dir, timeoutMs: 3000});
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /OWNER_GRANTED_TEST/);
});

test('explicit capability revocation restricts filesystem, process and browser independently', () => {
  const cfg = config('FULL_POWER', true, [
    'filesystem.full', 'process.control', 'browser.background'
  ]);
  cfg.powerMode.browserControl = {enabled: true, allowInput: true};
  const effective = effectivePowerMode(cfg);
  assert.equal(effective.fullFilesystem, false);
  assert.equal(effective.allowProcessControl, false);
  assert.equal(effective.allowPersistentTerminal, false);
  assert.equal(effective.browserControl.enabled, false);
  assert.equal(effective.browserControl.allowInput, true);
});
