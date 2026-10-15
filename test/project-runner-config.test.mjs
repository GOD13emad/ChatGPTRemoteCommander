import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyProjectRunnerConfig, discoverQualifiedProjectProvider, mergeExplicitOwnerRunnerPolicy } from '../src/project-runner-config.mjs';
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
  assert.equal(result.status,'WORK_CREDITS_PROVIDER_BLOCKED');
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
  assert.equal(result.config.durableWorkflows.runner.autoTick,false);
  assert.deepEqual(result.config.durableWorkflows.runner.provider,{kind:'disabled',reason:'WORK_CREDITS_PROVIDER_BLOCKED'});
});

test('legacy top-level runner kind=codex is migrated fail-closed', () => {
  const cfg=base({runner:{enabled:false,autoTick:false,kind:'codex',model:'legacy-model',maxPlannerCalls:7}});
  const result=applyProjectRunnerConfig(cfg,{platform:'linux'});
  assert.equal(result.status,'CODEX_FORBIDDEN');
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
  assert.equal(result.config.durableWorkflows.runner.autoTick,false);
  assert.equal(result.config.durableWorkflows.runner.kind,'disabled');
  assert.deepEqual(result.config.durableWorkflows.runner.provider,{kind:'disabled',reason:'NO_CODEX_VIA_COMMANDER'});
  assert.equal(result.config.durableWorkflows.runner.maxPlannerCalls,7);
});

test('Codex executable is forbidden even if disguised as command provider', () => {
  const cfg=base({runner:{
    enabled:true,autoTick:true,
    provider:{kind:'command',executable:'C:\\state\\tools\\codex-cli\\0.156.1\\bin\\codex.exe'}
  }});
  const result=applyProjectRunnerConfig(cfg,{platform:'win32'});
  assert.equal(result.status,'WORK_CREDITS_PROVIDER_BLOCKED');
  assert.equal(result.config.durableWorkflows.runner.enabled,false);
});

test('unknown external or generic command runner is rejected even when owner has FULL_POWER', () => {
  const root=temp();
  try {
    const executable=makeCommand(root,'linux');
    const cfg=base({runner:{enabled:true,autoTick:false,provider:{kind:'command',executable,timeoutMs:120000}}});
    const result=applyProjectRunnerConfig(cfg,{platform:'linux'});
    assert.equal(result.status,'WORK_CREDITS_PROVIDER_BLOCKED');
    assert.equal(result.config.durableWorkflows.runner.enabled,false);
    assert.equal(result.config.durableWorkflows.runner.autoTick,false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('trusted local Qwen command runner defaults to one direct planner without hidden team', {skip:process.platform!=='linux'},()=>{
  const root=path.resolve('examples/provider-adapter');
  const script=path.join(root,'linux-local-qwen3.sh');
  const adapter=path.join(root,'adapter.mjs');
  const hex=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const cfg=base({runner:{
    enabled:true,autoTick:true,allowedTools:['read_text'],maxActions:2,maxPlannerCalls:3,maxDurationMs:60000,
    provider:{kind:'command',executable:'/bin/sh',args:[script],adapterFile:adapter,
      scriptSha256:hex(script),adapterSha256:hex(adapter),
      endpoint:'http://127.0.0.1:18080/v1/chat/completions',localOnly:true,creditPolicy:'DENY_WORK_CREDITS'}
  }});
  const result=applyProjectRunnerConfig(cfg,{platform:'linux'});
  assert.equal(result.status,'PRESERVED_EXPLICIT_NON_CODEX_PROVIDER');
  assert.equal(result.config.durableWorkflows.runner.enabled,true);
  assert.equal(result.config.durableWorkflows.runner.autoTick,true);
  assert.equal(result.config.durableWorkflows.runner.team,undefined);
  assert.equal(result.config.durableWorkflows.runner.adaptive.enabled,false);
  assert.equal(result.config.durableWorkflows.runner.worker.enabled,false);
  const configManual=base({runner:{...cfg.durableWorkflows.runner,autoTick:undefined}});
  const manual=applyProjectRunnerConfig(configManual,{platform:'linux'});
  assert.equal(manual.status,'PRESERVED_EXPLICIT_NON_CODEX_PROVIDER');
  assert.equal(manual.config.durableWorkflows.runner.autoTick,false);
  assert.equal(manual.config.durableWorkflows.runner.adaptive.enabled,false);
  assert.equal(manual.config.durableWorkflows.runner.worker.enabled,false);
  assert.equal(manual.config.durableWorkflows.runner.team,undefined);
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


test('explicit owner-authorized provider remains blocked under no-Work policy', () => {
  const root=temp();
  try {
    const executable=path.join(root,process.platform==='win32'?'codex.exe':'codex');
    fs.writeFileSync(executable,'stub');
    if(process.platform!=='win32') fs.chmodSync(executable,0o755);
    const cfg=base({runner:{
      enabled:true,autoTick:true,
      provider:{kind:'codex',executable,timeoutMs:120000,maxOutputBytes:2*1024*1024}
    }});
    cfg.powerMode.codexControl={allowLaunch:true};
    const result=applyProjectRunnerConfig(cfg,{platform:process.platform});
    assert.equal(result.status,'WORK_CREDITS_PROVIDER_BLOCKED');
    assert.equal(result.config.durableWorkflows.runner.enabled,false);
    assert.equal(result.config.durableWorkflows.runner.autoTick,false);
    assert.equal(result.config.durableWorkflows.runner.provider.kind,'disabled');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('historical policy-disabled runner is not automatically recovered', () => {
  const root=temp();
  try {
    const executable=path.join(root,process.platform==='win32'?'codex.exe':'codex');
    fs.writeFileSync(executable,'stub');
    if(process.platform!=='win32') fs.chmodSync(executable,0o755);
    const active=base({runner:{enabled:false,autoTick:false,provider:{kind:'disabled',reason:'NO_CODEX_VIA_COMMANDER'},allowedTools:['read_text']}});
    active.runtimeState='active-runtime';
    active.powerMode.codexControl={allowLaunch:true};
    const canonical=base({runner:{enabled:true,autoTick:true,provider:{kind:'codex',executable,timeoutMs:120000,maxOutputBytes:2*1024*1024},allowedTools:['read_text','write_text']}});
    canonical.powerMode.codexControl={allowLaunch:true};
    canonical.runtimeState='canonical-runtime-must-not-overlay';
    const result=mergeExplicitOwnerRunnerPolicy(active,canonical,{platform:process.platform});
    assert.equal(result.merged,false);
    assert.equal(result.status,'CANONICAL_OWNER_RUNNER_NOT_AUTHORIZED');
    assert.equal(result.config.runtimeState,'active-runtime');
    assert.equal(result.config.durableWorkflows.runner.enabled,false);
    assert.deepEqual(result.config.durableWorkflows.runner.allowedTools,['read_text']);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('primary policy merge refuses unauthorized canonical runner and non-historical active disables', () => {
  const root=temp();
  try {
    const executable=path.join(root,process.platform==='win32'?'codex.exe':'codex');
    fs.writeFileSync(executable,'stub');
    if(process.platform!=='win32') fs.chmodSync(executable,0o755);
    const active=base({runner:{enabled:false,autoTick:false,provider:{kind:'disabled',reason:'NO_CODEX_VIA_COMMANDER'}}});
    active.powerMode.codexControl={allowLaunch:true};
    const canonical=base({runner:{enabled:true,autoTick:true,provider:{kind:'codex',executable}}});
    canonical.powerMode.codexControl={allowLaunch:false};
    const denied=mergeExplicitOwnerRunnerPolicy(active,canonical,{platform:process.platform});
    assert.equal(denied.merged,false);
    assert.equal(denied.status,'CANONICAL_OWNER_RUNNER_NOT_AUTHORIZED');
    assert.equal(denied.config.durableWorkflows.runner.enabled,false);

    const explicit=base({runner:{enabled:false,autoTick:false,provider:{kind:'disabled',reason:'EXPLICITLY_DISABLED'}}});
    explicit.powerMode.codexControl={allowLaunch:true};
    canonical.powerMode.codexControl={allowLaunch:true};
    const preserved=mergeExplicitOwnerRunnerPolicy(explicit,canonical,{platform:process.platform});
    assert.equal(preserved.merged,false);
    assert.equal(preserved.status,'ACTIVE_POLICY_PRESERVED');
    assert.equal(preserved.config.durableWorkflows.runner.provider.reason,'EXPLICITLY_DISABLED');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
