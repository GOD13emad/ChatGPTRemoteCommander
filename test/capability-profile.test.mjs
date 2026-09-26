import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateCapabilityConfig, compareCapabilityState, deriveCapabilitySet } from '../src/capability-profile.mjs';

const defaults = () => ({
  host:'127.0.0.1',port:47831,allowedRoots:['X'],allowedPrograms:['git'],
  powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
    guiControl:{enabled:false,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true},
    browserControl:{enabled:false,allowNavigate:true,allowInput:true,allowScreenshot:true}},
  durableWorkflows:{enabled:true,directory:'C:\\state\\wf',executionTools:['system_status']}
});
const full = () => ({
  ...defaults(),
  powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:true,
    blockedShellPatterns:[],guiControl:{enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true},
    browserControl:{enabled:true,allowNavigate:true,allowInput:true,allowScreenshot:true}},
  durableWorkflows:{enabled:true,directory:'C:\\state\\wf',executionTools:['system_status','write_text']}
});
function assertStandardDenials(result) {
  assert.equal(result.profile.tier,'STANDARD');
  assert.equal(result.profile.autoEnableNewCapabilities,false);
  assert.equal(result.preservedExplicitAuthority,false);
  for(const field of ['enabled','fullFilesystem','allowShell','allowProcessControl','allowPermanentDelete']) {
    assert.equal(result.config.powerMode[field],false,field);
  }
  assert.equal(result.config.powerMode.guiControl.enabled,false);
  assert.equal(result.config.powerMode.browserControl.enabled,false);
  for(const cap of ['filesystem.full','filesystem.permanent_delete','shell.execute','shell.unrestricted',
    'process.control','process.terminate','terminal.persistent','gui.screenshot','gui.mouse','gui.keyboard','gui.window_focus',
    'browser.background','browser.navigate','browser.input','browser.screenshot']) {
    assert.equal(result.profile.grantedCapabilities.includes(cap),false,cap);
    assert.equal(deriveCapabilitySet(result.config).includes(cap),false,cap);
  }
}

test('legacy explicit full power is preserved across update without flags',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:full(),profileId:'default'});
  assert.equal(r.config.powerMode.allowPermanentDelete,true);
  assert.equal(r.config.powerMode.guiControl.enabled,true);
  assert.deepEqual(r.config.powerMode.blockedShellPatterns,[]);
  assert.equal(r.profile.tier,'FULL_POWER');
  assert.equal(r.profile.explicitlyAuthorized,true);
  assert.equal(r.preservedExplicitAuthority,true);
  assert.equal(r.config.durableWorkflows.scheduler.enabled,true);
  assert.equal(r.config.durableWorkflows.continuation.blindMutationReplay,false);
  assert.equal(r.config.durableDelivery.enforceDirectMutations,true);
});
test('new standard install remains standard',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:null});
  assert.equal(r.config.powerMode.enabled,false);
  assert.equal(r.profile.tier,'STANDARD');
  assert.equal(r.config.durableDelivery.enforceDirectMutations,true);
});
test('explicit full power enables every known capability by default',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:null,requestPower:true,requestGui:true,workflowDirectory:'C:\\state\\wf'});
  assert.equal(r.config.powerMode.enabled,true);
  assert.equal(r.config.powerMode.allowPermanentDelete,true);
  assert.equal(r.config.powerMode.guiControl.enabled,true);
  assert.equal(r.config.powerMode.browserControl.enabled,true);
  assert.equal(r.config.powerMode.browserControl.allowNavigate,true);
  assert.equal(r.config.powerMode.browserControl.allowInput,true);
  assert.equal(r.config.powerMode.browserControl.allowScreenshot,true);
  for(const cap of ['browser.background','browser.navigate','browser.input','browser.screenshot']) assert.ok(r.profile.grantedCapabilities.includes(cap),cap);
  assert.equal(r.profile.explicitlyAuthorized,true);
  assert.equal(r.profile.autoEnableNewCapabilities,true);
  assert.deepEqual(r.profile.disabledCapabilities,[]);
  assert.equal(r.config.durableDelivery.enforceDirectMutations,true);
});
test('explicit standard downgrade is possible and explicit',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:full(),requestStandard:true});
  assert.equal(r.config.powerMode.enabled,false);
  assert.equal(r.config.powerMode.allowPermanentDelete,false);
  assert.equal(r.profile.tier,'STANDARD');
  assert.equal(r.profile.explicitlyAuthorized,true);
});

for(const requestStandard of [false,true]) test(`${requestStandard?'explicit':'default'} fresh Standard stays denied across repeated preserve migrations`,()=>{
  let result=migrateCapabilityConfig({defaultConfig:defaults(),requestStandard});
  for(let update=0;update<3;update++) {
    assertStandardDenials(result);
    assert.equal(result.profile.explicitlyAuthorized,requestStandard);
    assert.deepEqual(result.config.durableWorkflows.executionTools,['system_status']);
    // Even broader incoming defaults cannot override the persisted Standard choice.
    result=migrateCapabilityConfig({defaultConfig:update===1?full():defaults(),existingConfig:result.config});
  }
  assertStandardDenials(result);
  assert.deepEqual(result.config.durableWorkflows.executionTools,['system_status']);
});

test('Full Power downgrade and persistent opt-outs survive repeated preserve migrations',()=>{
  const disabled=['filesystem.permanent_delete','gui.mouse'];
  let result=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:full(),requestStandard:true,disableCapabilities:disabled});
  for(let update=0;update<3;update++) {
    assertStandardDenials(result);
    assert.equal(result.profile.explicitlyAuthorized,true);
    assert.deepEqual(result.profile.disabledCapabilities,disabled);
    result=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:result.config});
  }
  assertStandardDenials(result);
  assert.deepEqual(result.profile.disabledCapabilities,disabled);
});

for(const explicitlyAuthorized of [false,true]) test(`persisted Standard tier overrides contradictory power flags (explicit=${explicitlyAuthorized})`,()=>{
  const existing=full();
  existing.capabilityProfile={tier:'STANDARD',explicitlyAuthorized,persistAcrossUpdates:true,autoEnableNewCapabilities:true,
    disabledCapabilities:['filesystem.permanent_delete','gui.mouse']};
  const result=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:existing});
  assertStandardDenials(result);
  assert.equal(result.profile.explicitlyAuthorized,explicitlyAuthorized);
  assert.deepEqual(result.profile.disabledCapabilities,existing.capabilityProfile.disabledCapabilities);
  assertStandardDenials(migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:result.config}));
});

test('an explicit later Power request upgrades Standard and preserves current Full Power thereafter',()=>{
  const standard=migrateCapabilityConfig({defaultConfig:defaults(),requestStandard:true});
  let result=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:standard.config,requestPower:true});
  assert.equal(result.preservedExplicitAuthority,false);
  for(let update=0;update<3;update++) {
    assert.equal(result.profile.tier,'FULL_POWER');
    assert.equal(result.profile.explicitlyAuthorized,true);
    assert.equal(result.profile.autoEnableNewCapabilities,true);
    assert.equal(result.config.powerMode.fullFilesystem,true);
    assert.equal(result.config.powerMode.allowShell,true);
    assert.equal(result.config.powerMode.allowPermanentDelete,true);
    assert.equal(result.config.powerMode.guiControl.enabled,true);
    result=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:result.config});
    assert.equal(result.preservedExplicitAuthority,true);
  }
});

test('a legacy partial-power configuration without a persisted Standard choice retains its existing scope',()=>{
  const existing=full();existing.powerMode.fullFilesystem=false;existing.powerMode.allowPermanentDelete=false;
  const expectedCapabilities=deriveCapabilitySet(existing);
  let current=existing;
  for(let update=0;update<3;update++) {
    const result=migrateCapabilityConfig({defaultConfig:full(),existingConfig:current,continuationDefaults:false});
    assert.equal(result.profile.tier,'STANDARD');
    assert.equal(result.profile.explicitlyAuthorized,false);
    assert.equal(result.profile.autoEnableNewCapabilities,false);
    assert.equal(result.preservedExplicitAuthority,false);
    assert.equal(result.config.powerMode.enabled,true);
    assert.equal(result.config.powerMode.fullFilesystem,false);
    assert.equal(result.config.powerMode.allowPermanentDelete,false);
    assert.equal(result.config.powerMode.allowShell,true);
    assert.deepEqual(deriveCapabilitySet(result.config),expectedCapabilities);
    assert.deepEqual(result.config.durableWorkflows.executionTools,existing.durableWorkflows.executionTools);
    current=result.config;
  }
});

for(const [explicitlyAuthorized,source] of [[true,'config-derived'],[false,'explicit-user-authorization']]) {
  test(`a persisted Standard restriction cannot masquerade as legacy partial scope (${source})`,()=>{
    const existing=full();existing.powerMode.fullFilesystem=false;
    existing.capabilityProfile={tier:'STANDARD',explicitlyAuthorized,source,autoEnableNewCapabilities:false};
    assertStandardDenials(migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:existing}));
  });
}
test('self-test reports missing authority as CONFIG_REGRESSION',()=>{
  const e=full(),a=full();a.powerMode.allowProcessControl=false;
  const c=compareCapabilityState(e,a);
  assert.equal(c.ok,false);assert.equal(c.code,'CONFIG_REGRESSION');
  assert.ok(c.missing.includes('process.control'));
});
test('capability derivation includes continuation capabilities',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:full()});
  const caps=deriveCapabilitySet(r.config);
  assert.ok(caps.includes('workflow.scheduler'));
  assert.ok(caps.includes('workflow.autonomous_resume'));
  assert.ok(caps.includes('workflow.execution_profile_persistence'));
});

test('explicit capability opt-out survives later full-power migration',()=>{
  const first=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:null,requestPower:true,requestGui:true,workflowDirectory:'C:\\state\\wf',disableCapabilities:['filesystem.permanent_delete','gui.mouse']});
  assert.equal(first.config.powerMode.allowPermanentDelete,false);assert.equal(first.config.powerMode.guiControl.allowMouse,false);
  assert.deepEqual(first.profile.disabledCapabilities,['filesystem.permanent_delete','gui.mouse']);
  const second=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:first.config,workflowDirectory:'C:\\state\\wf'});
  assert.equal(second.config.powerMode.allowPermanentDelete,false);assert.equal(second.config.powerMode.guiControl.allowMouse,false);
  assert.deepEqual(second.profile.disabledCapabilities,['filesystem.permanent_delete','gui.mouse']);
});

test('explicit GUI opt-out is persisted across Full Power updates',()=>{
  const first=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:null,requestPower:true,requestGui:false,workflowDirectory:'C:\\state\\wf'});
  assert.equal(first.config.powerMode.guiControl.enabled,false);
  for(const cap of ['gui.screenshot','gui.mouse','gui.keyboard','gui.window_focus'])assert.ok(first.profile.disabledCapabilities.includes(cap),cap);
  const second=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:first.config,workflowDirectory:'C:\\state\\wf'});
  assert.equal(second.config.powerMode.guiControl.enabled,false);
  for(const cap of ['gui.screenshot','gui.mouse','gui.keyboard','gui.window_focus'])assert.ok(second.profile.disabledCapabilities.includes(cap),cap);
  const third=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:second.config,requestGui:true,workflowDirectory:'C:\\state\\wf'});
  assert.equal(third.config.powerMode.guiControl.enabled,true);
  for(const cap of ['gui.screenshot','gui.mouse','gui.keyboard','gui.window_focus'])assert.equal(third.profile.disabledCapabilities.includes(cap),false,cap);
});

test('desktop interaction safety invariant survives Full Power migration',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:full(),profileId:'default'});
  const g=r.config.powerMode.guiControl;
  assert.equal(g.interactionPolicy,'explicit-current-request-only');
  assert.equal(g.defaultSessionMode,'observe');
  assert.equal(g.backgroundPreferred,true);
  assert.equal(g.workflowTakeoverAllowed,false);
});

test('explicit browser input opt-out survives later Full Power migration while background read/navigation remain available',()=>{
  const first=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:null,requestPower:true,workflowDirectory:'C:\\state\\wf',disableCapabilities:['browser.input']});
  assert.equal(first.config.powerMode.browserControl.enabled,true);
  assert.equal(first.config.powerMode.browserControl.allowNavigate,true);
  assert.equal(first.config.powerMode.browserControl.allowInput,false);
  assert.ok(first.profile.disabledCapabilities.includes('browser.input'));
  const second=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:first.config,workflowDirectory:'C:\\state\\wf'});
  assert.equal(second.config.powerMode.browserControl.enabled,true);
  assert.equal(second.config.powerMode.browserControl.allowInput,false);
  assert.ok(second.profile.disabledCapabilities.includes('browser.input'));
});

test('background browser safety invariant survives Full Power migration',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:full(),profileId:'default'});
  const b=r.config.powerMode.browserControl;
  assert.equal(b.backgroundFirst,true);
  assert.equal(b.allowForegroundFallback,true);
  assert.equal(b.foregroundFallback,'explicit-current-request-only');
  assert.equal(b.workflowBrowserAllowed,false);
  assert.equal(b.userBrowserProfileReuse,false);
  assert.equal(b.savedPasswordExtraction,false);
});
