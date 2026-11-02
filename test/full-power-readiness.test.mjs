import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessFullPowerReadiness } from '../src/full-power-readiness.mjs';

const full=()=>({
  capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:true,disabledCapabilities:[]},
  powerMode:{enabled:true,guiControl:{enabled:true},browserControl:{enabled:true}}
});

test('FULL_POWER never implies Windows elevation or multi-profile approval',()=>{
  const v=assessFullPowerReadiness({config:full(),platform:'win32',uid:null,
    workflowStatus:{runnerConfigured:false,automaticExecution:false}});
  assert.equal(v.capabilitiesConfigured,true);
  assert.equal(v.schema,2);
  assert.equal(v.allCapabilitiesConfigured,true);
  assert.equal(v.allCapabilitiesEnabled,false,'configuration never proves native runtime privileges');
  assert.equal(v.operationalStatus,'UNVERIFIED');
  assert.ok(v.unmetGates.includes('NATIVE_OS_ELEVATION'));
  assert.ok(v.unmetGates.includes('GUI_BACKGROUND_CONTROL_E2E'));
  assert.ok(v.unmetGates.includes('BROWSER_SAME_SESSION_E2E'));
  assert.deepEqual(v.osPrivilege,{level:'NOT_VERIFIED',elevated:null,nativeVerificationRequired:true});
  assert.equal(v.userSessions.everyProfileAuthorized,'NOT_VERIFIED');
  assert.equal(v.gui.backgroundControlProven,'NOT_VERIFIED');
  assert.equal(v.workflow.configured,false);
  assert.equal(v.fleetReady,false);
});

test('Linux nonroot FULL_POWER is not root and retains intentional safety blocks',()=>{
  const c=full();
  c.capabilityProfile.disabledCapabilities=['shell.unrestricted','shell.unrestricted'];
  const v=assessFullPowerReadiness({config:c,platform:'linux',uid:1000,
    workflowStatus:{runnerConfigured:true,automaticExecution:false}});
  assert.equal(v.osPrivilege.level,'USER');
  assert.equal(v.osPrivilege.elevated,false);
  assert.deepEqual(v.disabledCapabilities,['shell.unrestricted']);
  assert.equal(v.allCapabilitiesConfigured,false);
  assert.ok(v.unmetGates.includes('DISABLED_APPLICATION_CAPABILITIES'));
  assert.equal(v.operationalStatus,'BLOCKED');
  assert.equal(v.allCapabilitiesEnabled,false);
  assert.equal(v.workflow.configured,true);
  assert.equal(v.workflow.automaticExecution,false);
});

test('Linux uid0 is recognized narrowly, not as permission across other sessions',()=>{
  const v=assessFullPowerReadiness({config:full(),platform:'linux',uid:0});
  assert.equal(v.osPrivilege.level,'ROOT');
  assert.equal(v.osPrivilege.elevated,true);
  assert.equal(v.userSessions.everyProfileAuthorized,'NOT_VERIFIED');
  assert.equal(v.fleetReady,false);
});

test('STANDARD and disabled power cannot be described as configured Full Power',()=>{
  for(const c of [
    {capabilityProfile:{tier:'STANDARD',explicitlyAuthorized:false},powerMode:{enabled:false}},
    {...full(),powerMode:{enabled:false}},
    {...full(),capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:false}}
  ]){
    const v=assessFullPowerReadiness({config:c,platform:'linux',uid:1000});
    assert.equal(v.capabilitiesConfigured,false);
    assert.equal(v.allCapabilitiesEnabled,false);
  }
});

test('system_status exposes readiness separately from the capability profile',()=>{
  const s=readFileSync(new URL('../src/server-v0.3.mjs',import.meta.url),'utf8');
  assert.match(s,/fullPowerReadiness: assessFullPowerReadiness\(\{ config, workflowStatus \}\)/);
  assert.match(s,/capabilityProfile: config\.capabilityProfile/);
});

test('even effective Linux root is not automatically all-session/full-application operational',()=>{
  const c=full();
  const v=assessFullPowerReadiness({config:c,platform:'linux',uid:0,
    workflowStatus:{runnerConfigured:true,automaticExecution:true}});
  assert.equal(v.allCapabilitiesConfigured,true);
  assert.equal(v.osPrivilege.elevated,true);
  assert.equal(v.allCapabilitiesEnabled,false);
  assert.equal(v.operationalStatus,'UNVERIFIED');
  assert.ok(v.unmetGates.includes('PER_USER_SESSION_AUTHORIZATION'));
  assert.equal(v.fleetReady,false);
});
