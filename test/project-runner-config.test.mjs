import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyProjectRunnerConfig, QUALIFIED_CODEX_VERSION } from '../src/project-runner-config.mjs';
import { normalizeCapabilityProfile } from '../src/capability-profile.mjs';

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rc-runner-config-')); }
function base(extra = {}) {
  return {
    powerMode: { enabled: true, fullFilesystem: true },
    durableWorkflows: { enabled: true, ...extra },
    capabilityProfile: {
      id: 'default', tier: 'FULL_POWER', explicitlyAuthorized: true,
      persistAcrossUpdates: true, autoEnableNewCapabilities: true,
      disabledCapabilities: []
    }
  };
}
function providerPath(root, platform, arch) {
  const parts = platform === 'win32'
    ? ['codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin','codex.exe']
    : arch === 'arm64'
      ? ['codex-linux-arm64','vendor','aarch64-unknown-linux-musl','bin','codex']
      : ['codex-linux-x64','vendor','x86_64-unknown-linux-musl','bin','codex'];
  return path.join(root,'tools','codex-cli',QUALIFIED_CODEX_VERSION,'node_modules','@openai',...parts);
}
function makeProvider(root, platform='linux', arch='x64') {
  const file=providerPath(root,platform,arch);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,'stub');
  if(platform!=='win32') fs.chmodSync(file,0o755);
  return file;
}

test('Full Power auto-configures the qualified Linux Codex provider', () => {
  const root=temp();
  try {
    const executable=makeProvider(root,'linux','x64');
    const result=applyProjectRunnerConfig(base(),{stateRoot:root,platform:'linux',arch:'x64'});
    assert.equal(result.status,'AUTO_CONFIGURED');
    assert.equal(result.config.durableWorkflows.runner.enabled,true);
    assert.equal(result.config.durableWorkflows.runner.autoTick,true);
    assert.equal(result.config.durableWorkflows.runner.provider.kind,'codex');
    assert.equal(result.config.durableWorkflows.runner.provider.executable,executable);
    assert.equal(result.config.durableWorkflows.runner.provider.timeoutMs,30_000);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Full Power auto-configures the qualified Windows Codex provider', () => {
  const root=temp();
  try {
    const executable=makeProvider(root,'win32','x64');
    const result=applyProjectRunnerConfig(base(),{stateRoot:root,platform:'win32',arch:'x64'});
    assert.equal(result.status,'AUTO_CONFIGURED');
    assert.equal(result.config.durableWorkflows.runner.provider.executable,executable);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('existing qualified runner is preserved and old transport timeout is clamped', () => {
  const root=temp();
  try {
    const executable=makeProvider(root,'linux','x64');
    const cfg=base({runner:{enabled:true,autoTick:true,provider:{kind:'codex',executable,timeoutMs:120_000,maxOutputBytes:2*1024*1024}}});
    const result=applyProjectRunnerConfig(cfg,{stateRoot:root,platform:'linux',arch:'x64'});
    assert.equal(result.status,'PRESERVED');
    assert.equal(result.config.durableWorkflows.runner.provider.timeoutMs,30_000);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Standard authority disables an inherited runner', () => {
  const cfg=base({runner:{enabled:true,autoTick:true,provider:{kind:'codex',executable:'C:/old/codex.exe',timeoutMs:30_000}}});
  cfg.capabilityProfile.tier='STANDARD';
  cfg.capabilityProfile.explicitlyAuthorized=true;
  const result=applyProjectRunnerConfig(cfg,{stateRoot:'C:/missing',platform:'win32',arch:'x64'});
  assert.equal(result.status,'AUTHORITY_DISABLED');
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
  assert.equal(result.config.durableWorkflows.runner.autoTick,false);
});

test('explicit workflow.project_engine opt-out is preserved', () => {
  const root=temp();
  try {
    makeProvider(root,'linux','x64');
    const cfg=base();
    cfg.capabilityProfile.disabledCapabilities=['workflow.project_engine'];
    const result=applyProjectRunnerConfig(cfg,{stateRoot:root,platform:'linux',arch:'x64'});
    assert.equal(result.status,'EXPLICITLY_DISABLED');
    assert.notEqual(result.config.durableWorkflows.runner?.enabled,true);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('missing provider fails closed without disabling durable workflow recovery', () => {
  const root=temp();
  try {
    const result=applyProjectRunnerConfig(base(),{stateRoot:root,platform:'linux',arch:'x64'});
    assert.equal(result.status,'PROVIDER_MISSING');
    assert.equal(result.config.durableWorkflows.enabled,true);
    assert.notEqual(result.config.durableWorkflows.runner?.enabled,true);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('project engine capability represents Full Power authority independently of provider readiness', () => {
  const root=temp();
  try {
    makeProvider(root,'linux','x64');
    const result=applyProjectRunnerConfig(base(),{stateRoot:root,platform:'linux',arch:'x64'});
    result.config.capabilityProfile=normalizeCapabilityProfile(result.config.capabilityProfile,result.config,{id:'default',legacyExplicit:true});
    assert.ok(result.config.capabilityProfile.grantedCapabilities.includes('workflow.project_engine'));
    result.config.durableWorkflows.runner.enabled=false;
    const normalized=normalizeCapabilityProfile(result.config.capabilityProfile,result.config,{id:'default',legacyExplicit:true});
    assert.ok(normalized.grantedCapabilities.includes('workflow.project_engine'));
    result.config.capabilityProfile.disabledCapabilities=['workflow.project_engine'];
    const optedOut=normalizeCapabilityProfile(result.config.capabilityProfile,result.config,{id:'default',legacyExplicit:true});
    assert.equal(optedOut.grantedCapabilities.includes('workflow.project_engine'),false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
