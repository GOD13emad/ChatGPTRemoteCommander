import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {effectivePowerMode} from '../src/effective-power-mode.mjs';
import {assessAccessStatus} from '../src/full-access-status.mjs';
import {runShell} from '../src/power-tools-v0.3.mjs';

function accessStatus(cfg, effectiveUid = 1000) {
  return assessAccessStatus(cfg, null, {platform:'linux',effectiveUid});
}
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
    assert.equal(effectivePowerMode(cfg, {accessStatus:accessStatus(cfg)}).allowShell, false);
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
  const status = accessStatus(cfg);
  assert.equal(effectivePowerMode(cfg, {accessStatus:status}).allowShell, true);
  const result = await runShell({roots: [dir], config: cfg, accessStatus:status},
    {command: 'echo OWNER_GRANTED_TEST', cwd: dir, timeoutMs: 3000});
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /OWNER_GRANTED_TEST/);
});

test('explicit capability revocation restricts filesystem, process and browser independently', () => {
  const cfg = config('FULL_POWER', true, [
    'filesystem.full', 'process.control', 'browser.background'
  ]);
  cfg.powerMode.browserControl = {enabled: true, allowInput: true};
  const effective = effectivePowerMode(cfg, {accessStatus:accessStatus(cfg)});
  assert.equal(effective.fullFilesystem, false);
  assert.equal(effective.allowProcessControl, false);
  assert.equal(effective.allowPersistentTerminal, false);
  assert.equal(effective.browserControl.enabled, false);
  assert.equal(effective.browserControl.allowInput, false);
});

test('STANDARD and FULL_POWER never inherit elevated host tokens; V102 FULL_ACCESS requires broker/session proof', () => {
  const power = config('FULL_POWER', true);
  const full = config('FULL_ACCESS', true);
  const standard = config('STANDARD', true);
  const powerAsRoot = accessStatus(power, 0);
  const fullAsOwner = accessStatus(full, 1000);
  const fullAsRoot = accessStatus(full, 0);
  assert.equal(powerAsRoot.effectiveTier, 'STANDARD');
  assert.equal(effectivePowerMode(power, {accessStatus:powerAsRoot}).enabled, false);
  assert.equal(fullAsOwner.effectiveTier, 'FULL_POWER');
  assert.equal(effectivePowerMode(full, {accessStatus:fullAsOwner}).enabled, true);
  assert.equal(effectivePowerMode(full, {accessStatus:fullAsOwner}).allowShell, true);
  assert.equal(fullAsRoot.effectiveTier, 'STANDARD');
  assert.equal(fullAsRoot.nativeRoot.verified, true);
  assert.equal(fullAsRoot.fullAccessBlocker, 'V102_PRIVILEGED_BROKER_NOT_VERIFIED');
  assert.equal(effectivePowerMode(full, {accessStatus:fullAsRoot}).enabled, false);
  assert.equal(effectivePowerMode(standard, {accessStatus:accessStatus(standard)}).enabled, false);
});


test('Windows token tiers are distinct and STANDARD never inherits an elevated Administrator token', () => {
  const standardToken = {ok:true,isAdmin:false,isSystem:false,elevation:'standard',source:'local-process-token'};
  const elevatedToken = {ok:true,isAdmin:true,isSystem:false,elevation:'high',source:'local-process-token'};
  const power = config('FULL_POWER', true);
  const full = config('FULL_ACCESS', true);
  const standard = config('STANDARD', true);
  const powerStatus = assessAccessStatus(power, null, {platform:'win32',adminToken:standardToken});
  const powerAsAdmin = assessAccessStatus(power, null, {platform:'win32',adminToken:elevatedToken});
  const fullStatus = assessAccessStatus(full, null, {platform:'win32',adminToken:elevatedToken});
  const standardStatus = assessAccessStatus(standard, null, {platform:'win32',adminToken:elevatedToken});
  assert.equal(powerStatus.effectiveTier, 'FULL_POWER');
  assert.equal(powerAsAdmin.effectiveTier, 'STANDARD');
  assert.equal(effectivePowerMode(power, {accessStatus:powerAsAdmin}).enabled, false);
  assert.equal(fullStatus.effectiveTier, 'STANDARD');
  assert.equal(fullStatus.nativeAdmin.verified, true);
  assert.equal(fullStatus.fullAccessActive, false);
  assert.equal(fullStatus.fullAccessBlocker, 'V102_PRIVILEGED_BROKER_NOT_VERIFIED');
  assert.equal(standardStatus.effectiveTier, 'STANDARD');
  assert.equal(effectivePowerMode(standard, {accessStatus:standardStatus}).enabled, false);
});

test('FULL_ACCESS cannot fall back to FULL_POWER when its shell policy is restricted', () => {
  const cfg = config('FULL_ACCESS', true);
  cfg.powerMode.blockedShellPatterns = ['rm'];
  const status = accessStatus(cfg, 0);
  assert.equal(status.effectiveTier, 'STANDARD');
  assert.equal(status.fullAccessBlocker, 'V102_PRIVILEGED_BROKER_NOT_VERIFIED');
  assert.equal(effectivePowerMode(cfg, {accessStatus:status}).enabled, false);
});


test('V102 recognizes only complete broker plus owner-session attestation on an ordinary owner Worker', () => {
  // This is a mocked future attestation shape, NOT evidence that the host
  // currently has this broker or can authorize privileged operations.
  const cfg=config('FULL_ACCESS', true);
  const userStatus=accessStatus(cfg, 1000);
  assert.equal(userStatus.effectiveTier, 'FULL_POWER');
  const accepted={
    ...userStatus,
    configuredTier:'FULL_ACCESS',
    effectiveTier:'FULL_ACCESS',
    operationalFullAccess:true,
    broker:{
      verified:true,
      operationalFullAccess:true,
      nativeProfileBindingVerified:true,
      privilegedActionRouteVerified:true
    },
    ownerSession:{verified:true}
  };
  assert.equal(effectivePowerMode(cfg,{accessStatus:accepted}).enabled,true);
  assert.equal(effectivePowerMode(cfg,{accessStatus:accepted}).allowShell,true);
  for(const field of [
    ['broker','verified'],['broker','operationalFullAccess'],
    ['broker','nativeProfileBindingVerified'],['broker','privilegedActionRouteVerified'],
    ['ownerSession','verified']
  ]){
    const invalid=structuredClone(accepted);
    invalid[field[0]][field[1]]=false;
    assert.equal(effectivePowerMode(cfg,{accessStatus:invalid}).enabled,false,
      field.join('.')+' cannot be omitted');
  }
  const noGrant=config('FULL_ACCESS', false);
  assert.equal(effectivePowerMode(noGrant,{accessStatus:accepted}).enabled,false);
});

test('missing, mismatched or stale host access status fails closed', () => {
  const cfg = config('FULL_POWER', true);
  assert.equal(effectivePowerMode(cfg).enabled, false);
  assert.equal(effectivePowerMode(cfg, {accessStatus:{configuredTier:'FULL_ACCESS',effectiveTier:'FULL_ACCESS',operationalFullAccess:true,nativeRoot:{verified:true}}}).enabled, false);
  assert.equal(effectivePowerMode(cfg, {accessStatus:{configuredTier:'FULL_POWER',effectiveTier:'FULL_POWER'}}).enabled, false);
});
