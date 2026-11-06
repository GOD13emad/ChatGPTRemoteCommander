#!/usr/bin/env node
// Read-only native broker preflight. This is a host capability check, not an
// OS elevation request or a declaration that a profile is fully enrolled.
import { requestPrivilegeBroker } from '../src/privilege-client.mjs';
import { assessAccessStatus } from '../src/full-access-status.mjs';

const proof = await requestPrivilegeBroker('os.probe');
const status = assessAccessStatus({
  capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:true},
  powerMode:{enabled:true}
},proof,{platform:process.platform});
console.log(JSON.stringify({
  platform:process.platform,
  privilegedBrokerVerified:status.broker.verified,
  identity:status.broker.privilegeIdentity,
  fixedActionsOnly:!status.broker.unrestrictedAdminShell,
  effectiveTierOfSampleFullPowerProfile:status.effectiveTier,
  code:status.broker.code
}));
if (!status.broker.verified) process.exitCode=2;
