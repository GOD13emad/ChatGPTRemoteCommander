import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from '../tools/stage-commander-v2-core-supervisor-qa.mjs';
import {verify} from '../tools/verify-commander-v2-branded-package.mjs';
function nativeQa(){
 const windows=process.platform==='win32';
 const base=windows
  ? path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'CommanderV2','QA','official-cos-tag2150-sparse-20261104')
  : path.join(os.homedir(),'.local','state','CommanderV2','QA','cos2150-unified-rebuild-20261104');
 return {base,unpacked:path.join(base,'release','commander-v2-authqa',windows?'win-unpacked':'linux-unpacked')};
}
test('supervisor QA rejects unrelated roots and never creates state for them',()=>{
 assert.throws(()=>run('verify',path.join(os.tmpdir(),'not-commander-v2-qa')),
  /COMMANDER_V2_QA_SUPERVISOR_NOT_ISOLATED_SOURCE/);
});
test('pinned new CoS QA sources contain only an explicitly opt-in Core controller',t=>{
 if(!['linux','win32'].includes(process.platform))return t.skip('Not Windows or Linux');
 const q=nativeQa();
 if(!fs.existsSync(path.join(q.base,'.commander-v2-core-supervisor-qa-backup','MANIFEST.json')))
  return t.skip('No approved, disposable QA source fixture');
 const proof=run('verify',q.base);
 assert.equal(proof.gate,'COMMANDER_V2_EMBEDDED_CORE_SUPERVISOR_SOURCE_QA_PASS');
 assert.equal(proof.files,3);
 assert.equal(proof.autoEnabled,false);
 assert.equal(proof.productionInstalled,false);
 assert.equal(proof.activeV1Touched,false);
 assert.throws(()=>run('stage',q.base),/NOT_FRESH_QA_STAGE/);
});
test('actual unpacked native Commander V2 package has exact dormant supervisor, R18 and V1 components',t=>{
 if(!['linux','win32'].includes(process.platform))return t.skip('Not Windows or Linux');
 const q=nativeQa();
 if(!fs.existsSync(path.join(q.unpacked,'resources','app.asar')))
  return t.skip('QA native package has not been built on this host');
 const proof=verify(q.unpacked);
 assert.equal(proof.gate,'COMMANDER_V2_BRANDED_NATIVE_QA_PASS');
 assert.equal(proof.supervisorCompiled,true);
 assert.equal(proof.supervisorAutoEnabled,false);
 assert.equal(proof.coreMcpProcessCapabilityAuth,true);
 assert.equal(proof.ownerAccountAuthVerified,false);
 assert.equal(proof.v1Files,75);
 for(const key of ['installed','v1RuntimeActivated','accountAuthenticated','workerEffectsVerified','signedRelease'])
  assert.equal(proof[key],false,key);
});
