import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateCapabilityConfig, compareCapabilityState, deriveCapabilitySet } from '../src/capability-profile.mjs';

const defaults = () => ({
  host:'127.0.0.1',port:47831,allowedRoots:['X'],allowedPrograms:['git'],
  powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,
    guiControl:{enabled:false,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true}},
  durableWorkflows:{enabled:true,directory:'C:\\state\\wf',executionTools:['system_status']}
});
const full = () => ({
  ...defaults(),
  powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:true,
    blockedShellPatterns:[],guiControl:{enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true}},
  durableWorkflows:{enabled:true,directory:'C:\\state\\wf',executionTools:['system_status','write_text']}
});

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
});
test('new standard install remains standard',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:null});
  assert.equal(r.config.powerMode.enabled,false);
  assert.equal(r.profile.tier,'STANDARD');
});
test('explicit full power enables every known capability by default',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:null,requestPower:true,requestGui:true,workflowDirectory:'C:\\state\\wf'});
  assert.equal(r.config.powerMode.enabled,true);
  assert.equal(r.config.powerMode.allowPermanentDelete,true);
  assert.equal(r.config.powerMode.guiControl.enabled,true);
  assert.equal(r.profile.explicitlyAuthorized,true);
  assert.equal(r.profile.autoEnableNewCapabilities,true);
  assert.deepEqual(r.profile.disabledCapabilities,[]);
});
test('explicit standard downgrade is possible and explicit',()=>{
  const r=migrateCapabilityConfig({defaultConfig:defaults(),existingConfig:full(),requestStandard:true});
  assert.equal(r.config.powerMode.enabled,false);
  assert.equal(r.config.powerMode.allowPermanentDelete,false);
  assert.equal(r.profile.tier,'STANDARD');
  assert.equal(r.profile.explicitlyAuthorized,true);
});
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
