import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyProjectRunnerConfig, discoverQualifiedProjectProvider } from '../src/project-runner-config.mjs';
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
function makeCommand(root, platform='linux') {
  const file=path.join(root,platform==='win32'?'planner.exe':'planner');
  fs.writeFileSync(file,'stub');
  if(platform!=='win32') fs.chmodSync(file,0o755);
  return file;
}

test('automatic model provider discovery is permanently forbidden', () => {
  const result=discoverQualifiedProjectProvider();
  assert.equal(result.status,'FORBIDDEN');
  assert.equal(result.kind,'codex');
  assert.equal(result.executable,null);
  assert.equal(result.reason,'NO_CODEX_VIA_COMMANDER');
});

test('Full Power does not auto-configure a model runner', () => {
  const result=applyProjectRunnerConfig(base(),{platform:'linux'});
  assert.equal(result.status,'NO_AUTOMATIC_MODEL_PROVIDER');
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
  assert.equal(result.config.durableWorkflows.runner.autoTick,false);
  assert.equal(result.config.durableWorkflows.runner.provider.kind,'disabled');
});

test('legacy Codex runner is migrated fail-closed', () => {
  const cfg=base({runner:{
    enabled:true,autoTick:true,
    provider:{kind:'codex',executable:'/state/tools/codex-cli/0.156.1/bin/codex',timeoutMs:30000}
  }});
  const result=applyProjectRunnerConfig(cfg,{platform:'linux'});
  assert.equal(result.status,'CODEX_FORBIDDEN');
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
  assert.equal(result.config.durableWorkflows.runner.autoTick,false);
  assert.deepEqual(result.config.durableWorkflows.runner.provider,{kind:'disabled',reason:'NO_CODEX_VIA_COMMANDER'});
});

test('Codex executable is forbidden even if disguised as command provider', () => {
  const cfg=base({runner:{
    enabled:true,autoTick:true,
    provider:{kind:'command',executable:'C:\\state\\tools\\codex-cli\\0.156.1\\bin\\codex.exe'}
  }});
  const result=applyProjectRunnerConfig(cfg,{platform:'win32'});
  assert.equal(result.status,'CODEX_FORBIDDEN');
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
});

test('explicit non-Codex command runner may be preserved but is never auto-created', () => {
  const root=temp();
  try {
    const executable=makeCommand(root,'linux');
    const cfg=base({runner:{enabled:true,autoTick:false,provider:{kind:'command',executable,timeoutMs:120000,maxOutputBytes:2*1024*1024}}});
    const result=applyProjectRunnerConfig(cfg,{platform:'linux'});
    assert.equal(result.status,'PRESERVED_EXPLICIT_NON_CODEX_PROVIDER');
    assert.equal(result.config.durableWorkflows.runner.enabled,true);
    assert.equal(result.config.durableWorkflows.runner.autoTick,false);
    assert.equal(result.config.durableWorkflows.runner.provider.kind,'command');
    assert.equal(result.config.durableWorkflows.runner.provider.timeoutMs,30000);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Standard authority disables an inherited runner', () => {
  const cfg=base({runner:{enabled:true,autoTick:true,provider:{kind:'command',executable:'C:/old/planner.exe',timeoutMs:30000}}});
  cfg.capabilityProfile.tier='STANDARD';
  cfg.capabilityProfile.explicitlyAuthorized=true;
  const result=applyProjectRunnerConfig(cfg,{platform:'win32'});
  assert.equal(result.status,'AUTHORITY_DISABLED');
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
  assert.equal(result.config.durableWorkflows.runner.autoTick,false);
});

test('explicit workflow.project_engine opt-out is preserved', () => {
  const cfg=base();
  cfg.capabilityProfile.disabledCapabilities=['workflow.project_engine'];
  const result=applyProjectRunnerConfig(cfg,{platform:'linux'});
  assert.equal(result.status,'EXPLICITLY_DISABLED');
  assert.notEqual(result.config.durableWorkflows.runner?.enabled,true);
});

test('project engine capability represents authority independently of provider readiness', () => {
  const result=applyProjectRunnerConfig(base(),{platform:'linux'});
  result.config.capabilityProfile=normalizeCapabilityProfile(result.config.capabilityProfile,result.config,{id:'default',legacyExplicit:true});
  assert.ok(result.config.capabilityProfile.grantedCapabilities.includes('workflow.project_engine'));
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
  result.config.capabilityProfile.disabledCapabilities=['workflow.project_engine'];
  const optedOut=normalizeCapabilityProfile(result.config.capabilityProfile,result.config,{id:'default',legacyExplicit:true});
  assert.equal(optedOut.grantedCapabilities.includes('workflow.project_engine'),false);
});
