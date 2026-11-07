import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseReleaseVersion,compareReleaseVersions} from '../tools/semver-release.mjs';

const manifest=JSON.parse(readFileSync(new URL('../docs/release-train-0.12.json',import.meta.url),'utf8'));
test('0.12 development train has one valid NoPromote identity and a pinned source base',()=>{
 assert.equal(manifest.train,'0.12');
 assert.equal(manifest.sourceVersion,'0.12.0-dev.1');
 assert.equal(manifest.status,'INTEGRATION_CANDIDATE_NOT_FINAL');
 assert.equal(manifest.sourceBaseSha,'40256873627780cc7b62359935e43bac5ef856b3');
 assert.equal(manifest.isStable,false);
 assert.equal(manifest.publishApproved,false);
 assert.equal(manifest.autoupdateApproved,false);
 assert.equal(manifest.installedPromotionApproved,false);
 assert.ok(manifest.components.length>=1);
 assert.ok(manifest.components.every(x=>x.required===true&&x.verified===false));
 assert.ok(Object.values(manifest.acceptance).every(x=>x===false));
 assert.match(readFileSync(new URL('../.npmignore',import.meta.url),'utf8'),/^outputs\/$/m);
});
test('0.12.0-dev.1 advances every 0.11 release and rejects noncanonical leading zero',()=>{
 assert.equal(parseReleaseVersion('0.12.0-dev.1').revision,1n);
 for(const old of ['0.11.0-dev.105','0.11.0-dev.23','0.11.0-dev.19','0.11.0','0.11.1'])
  assert.equal(compareReleaseVersions('0.12.0-dev.1',old),1,old);
 assert.throws(()=>parseReleaseVersion('0.12.0-dev.01'),/RC_VERSION_INVALID/);
});
