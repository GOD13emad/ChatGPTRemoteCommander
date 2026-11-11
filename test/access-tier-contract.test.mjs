import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ACCESS_TIER_CONTRACT_ID, ACCESS_TIER_DEFINITIONS,
  accessTierContractSnapshot
} from '../src/access-tier-contract.mjs';
import { assessAccessStatus } from '../src/full-access-status.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const src=file=>readFileSync(resolve(root,file),'utf8');

test('V102 defines exactly one canonical, immutable three-tier contract',()=>{
  const snapshot=accessTierContractSnapshot();
  assert.equal(ACCESS_TIER_CONTRACT_ID,'V102-OWNER-ACCESS-TIER-SEMANTICS-20261109');
  assert.equal(snapshot.id,ACCESS_TIER_CONTRACT_ID);
  assert.deepEqual(Object.keys(snapshot.definitions),['STANDARD','FULL_POWER','FULL_ACCESS']);
  assert.equal(snapshot.policyOnly,true);
  assert.equal(snapshot.configuredTierIsNotEffectiveTier,true);
  assert.equal(snapshot.effectiveOsPrivilegeIsIndependent,true);
  assert.equal(snapshot.ownerAccountBoundaryEnforced,true);
  assert.equal(Object.isFrozen(ACCESS_TIER_DEFINITIONS),true);
  assert.equal(Object.isFrozen(ACCESS_TIER_DEFINITIONS.FULL_ACCESS),true);
});

test('STANDARD is one persisted browser profile with revocable scoped computer grants',()=>{
  const s=ACCESS_TIER_DEFINITIONS.STANDARD;
  assert.equal(s.browserProfiles,'one-persistent-dedicated');
  assert.equal(s.filesystemAndApplications,'scope-specific-owner-grant');
  assert.match(s.descriptionEn,/one-time or durable/i);
  assert.match(s.descriptionEn,/revocable/i);
});

test('FULL_POWER means all same-owner user-level GUI and browser profiles, with native per-action elevation',()=>{
  const s=ACCESS_TIER_DEFINITIONS.FULL_POWER;
  assert.equal(s.browserProfiles,'all-existing-same-owner');
  assert.equal(s.ownerGui,'same-owner-session');
  assert.equal(s.nativeOsPrivilege,'ordinary-owner-token');
  assert.equal(s.privilegedActions,'native-approval-per-elevated-operation');
});

test('FULL_ACCESS requires persistent privileged broker with paired same-owner interactive worker',()=>{
  const s=ACCESS_TIER_DEFINITIONS.FULL_ACCESS;
  assert.equal(s.nativeOsPrivilege,'persistent-native-admin-or-root-broker');
  assert.equal(s.ownerGui,'same-owner-interactive-worker');
  assert.equal(s.browserProfiles,'all-existing-same-owner');
  assert.equal(s.privilegedActions,'one-time-native-enrollment-for-covered-actions');
});

test('policy is exposed by both actual Commander status interfaces, not copied as separate prose',()=>{
  const server=src('src/server-v0.3.mjs');
  const power=src('src/power-tools-v0.3.mjs');
  assert.match(server,/import \{ accessTierContractSnapshot \} from '\.\/access-tier-contract\.mjs'/);
  assert.match(power,/import \{ accessTierContractSnapshot \} from '\.\/access-tier-contract\.mjs'/);
  assert.match(server,/accessTierContract: accessTierContractSnapshot\(\)/);
  assert.match(power,/accessTierContract: accessTierContractSnapshot\(\)/);
});

test('a policy declaration or root broker probe alone does not silently grant FULL_ACCESS',()=>{
  const configured={
    capabilityProfile:{tier:'FULL_ACCESS',explicitlyAuthorized:true},
    powerMode:{enabled:true,fullFilesystem:true,allowShell:true,
      allowProcessControl:true,blockedShellPatterns:[]}
  };
  const probed=assessAccessStatus(configured,{ok:true,action:'os.probe',
    root:true,effectiveUid:0},{platform:'linux',effectiveUid:1000});
  assert.equal(probed.broker.verified,true);
  assert.equal(probed.fullAccessActive,false);
  assert.notEqual(probed.effectiveTier,'FULL_ACCESS');
  assert.equal(probed.broker.unrestrictedAdminShell,false);
});
