import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=x=>fs.readFileSync(path.join(root,x),'utf8');
const contract=JSON.parse(read('installer/universal-install-contract.json'));
const release=JSON.parse(read('docs/release-train-0.12.json'));
const engine=read('tools/universal-install/engine.mjs');

test('one package contract covers both operating systems and all nine accepted components',()=>{
  assert.equal(contract.schema,'rc-unified-installer-v1');
  assert.deepEqual(Object.keys(contract.platforms),['windows','linux']);
  assert.equal(contract.sourceTrain,'0.12');
  assert.equal(new Set(contract.commonComponents).size,9);
  for(const c of contract.commonComponents)
    assert.ok(release.components.find(x=>x.id===c && x.required===true),c);
  assert.deepEqual(contract.commonActions,['package','verify','install','upgrade','rollback','status']);
  for(const p of contract.requiredSourceFiles)
    assert.ok(fs.existsSync(path.join(root,p)),p);
});

test('an exact-source installer QA pass cannot authorize v0.12 stable or all-account Full Power',()=>{
  assert.equal(release.publishApproved,false);
  assert.equal(release.installedPromotionApproved,false);
  assert.equal(contract.releaseAdmission.stablePublished,false);
  assert.equal(contract.presentation.crossOsVisualParityAccepted,false);
  assert.equal(contract.profile.fullPowerIsNotOsElevation,true);
  assert.equal(contract.profile.independentAccountTunnel,true);
  assert.match(engine,/realServicesStarted:false,ownerConsentGranted:false/u);
  assert.match(engine,/productionInstallEnabled:false/u);
  assert.match(engine,/releasePath\(target,state\.previous\)/u);
  assert.match(engine,/core\.autocrlf=false/u);
  assert.match(engine,/core\.eol=lf/u);
  assert.doesNotMatch(engine,/systemctl|schtasks|reg\.exe|sudo|winget|npm\s+install/u);
});
