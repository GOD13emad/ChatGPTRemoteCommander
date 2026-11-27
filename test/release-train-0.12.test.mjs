import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {parseReleaseVersion,compareReleaseVersions} from '../tools/semver-release.mjs';

const manifest=JSON.parse(readFileSync(new URL('../docs/release-train-0.12.json',import.meta.url),'utf8'));
const corePkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const guiPkg=JSON.parse(readFileSync(new URL('../packaging/unified/package.json',import.meta.url),'utf8'));
test('0.12 development train has one valid NoPromote identity and a pinned source base',()=>{
 assert.equal(manifest.train,'0.12');
 assert.equal(manifest.firstStable,'0.12.0','0.12 is the first target operational stable baseline');
 assert.equal(manifest.majorTarget,'1.0.0','major product maturity remains a later milestone');
 assert.equal(manifest.fleetCoverage.scope,'all-known-commander1-connectors');
 assert.equal(manifest.fleetCoverage.expectedHostIds.length,8);
 assert.deepEqual(manifest.fleetCoverage.acceptedHostIds,[]);
 assert.equal(manifest.fleetCoverage.mappingVerified,false);
 assert.equal(manifest.fleetCoverage.bootLoginAndRollbackVerified,false);
 assert.equal(manifest.sourceVersion,corePkg.version);
 assert.equal(manifest.sourceVersion,guiPkg.version);
 assert.match(manifest.sourceVersion,/^0\.12\.0-dev\.[1-9][0-9]*$/);
 assert.equal(compareReleaseVersions(manifest.sourceVersion,'0.12.0-dev.24'),1,
   'qualified successor advances existing QA dev.24 without reusing its package identity');
 assert.equal(compareReleaseVersions('0.12.0',manifest.sourceVersion),1,'must remain development, never Stable');
 assert.equal(manifest.status,'INTEGRATION_CANDIDATE_NOT_FINAL');
 assert.equal(manifest.sourceBaseSha,'40256873627780cc7b62359935e43bac5ef856b3');
 assert.equal(manifest.isStable,false);
 assert.equal(manifest.publishApproved,false);
 assert.equal(manifest.autoupdateApproved,false);
 assert.equal(manifest.installedPromotionApproved,false);
 assert.ok(manifest.components.length>=1);
 assert.ok(manifest.components.every(x=>x.required===true&&x.verified===false));
 assert.ok(Object.values(manifest.acceptance).every(x=>x===false));
 const sourceCheckout=existsSync(new URL('../.git',import.meta.url));
 const ignore=new URL('../.npmignore',import.meta.url);
 const privateOutputs=new URL('../outputs/',import.meta.url);
 if(sourceCheckout){
  assert.ok(existsSync(ignore),'Git source must retain the packaging exclusion policy');
  assert.match(readFileSync(ignore,'utf8'),/^outputs\/$/m);
 }else{
  assert.equal(existsSync(privateOutputs),false,'installed package must not carry private QA outputs');
 }
});
test('0.12.0-dev.9 advances every 0.11 release and rejects noncanonical leading zero',()=>{
 assert.equal(parseReleaseVersion('0.12.0-dev.9').revision,9n);
 for(const old of ['0.11.0-dev.105','0.11.0-dev.23','0.11.0-dev.19','0.11.0','0.11.1'])
  assert.equal(compareReleaseVersions('0.12.0-dev.9',old),1,old);
 assert.equal(compareReleaseVersions('0.12.0-dev.9','0.12.0-dev.8'),1,'dev.9 upgrades installed dev.8');
 assert.throws(()=>parseReleaseVersion('0.12.0-dev.01'),/RC_VERSION_INVALID/);
});

test('0.12 development candidate preserves the historically owner-confirmed eight-host / 19-profile identity map without promoting deployment',()=>{
 const mapping=manifest.migration;
 assert.ok(mapping,'historically approved migration identity map must not disappear during branch integration');
 assert.equal(mapping.id,'V012-FLEET-ACCOUNT-MAPPING-20261110');
 assert.equal(mapping.ownerConfirmed,true);
 assert.equal(mapping.targetVersion,manifest.sourceVersion);
 assert.equal(mapping.targetTier,'FULL_ACCESS');
 assert.equal(mapping.tierEnrollmentStatus,'requires-native-os-acceptance-per-host');
 assert.equal(mapping.noCrossAccountCredentialMoves,true);
 assert.equal(mapping.noProfileDataOverwrite,true);
 assert.equal(mapping.deploymentStatus,'NOT_DEPLOYED');
 assert.equal(mapping.hosts.length,8);
 const expected={
  Emad_Labtop:[['default','Emad',48831],['MMZ','MMZ',47910],['saeed-emad','Saeid',47920]],
  Emad_PC_LIte:[['default','Emad',47831]],
  MMZ_Labtop:[['default','MMZ',47831],['emad-mmz','Emad',47921],['saeid-mmz','Saeid',47922]],
  Emad_PC_Ultimate:[['default','Emad',48834],['MMZ','MMZ',47836],['saeed-emad','Saeid',47834]],
  Emad_Server:[['default','Emad',48833],['MMZ','MMZ',47835],['saeid-secondary','Saeid',48931]],
  Server_Amirreza:[['default','Emad',48831],['MMZ','MMZ',47835],['saeid-secondary','Saeid',48931]],
  Saeid_PC:[['default','Saeid',47831],['Emad','Emad',47834]],
  Server_103:[['default','Emad',48831]]
 };
 assert.deepEqual(mapping.hosts.map(h=>h.host).sort(),Object.keys(expected).sort());
 for(const host of mapping.hosts){
  assert.ok(['desktop','headless'].includes(host.mode),host.host+' mode');
  const actual=host.profiles.map(p=>[p.legacyProfile,p.account,p.sourcePort]);
  assert.deepEqual(actual,expected[host.host],host.host+' profile identity map');
  assert.ok(host.profiles.every(p=>p.targetProfile===p.account),host.host+' canonical target names');
  assert.equal(new Set(host.profiles.map(p=>p.account)).size,host.profiles.length,host.host+' no duplicate account target');
 }
 assert.equal(mapping.hosts.reduce((n,h)=>n+h.profiles.length,0),19);
 assert.equal(manifest.fleetCoverage.mappingVerified,false,'historical identity confirmation is not current host verification');
 assert.equal(manifest.fleetCoverage.bootLoginAndRollbackVerified,false);
 assert.deepEqual(manifest.fleetCoverage.acceptedHostIds,[]);
 assert.equal(manifest.installedPromotionApproved,false);
 assert.equal(manifest.autoupdateApproved,false);
 assert.equal(manifest.publishApproved,false);
});
