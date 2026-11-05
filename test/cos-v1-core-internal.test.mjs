import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {run} from '../tools/stage-cos-v1-core-internal.mjs';
import {verify} from '../tools/verify-cos-v1-core-packaged.mjs';
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function qaPaths(){
 const win=process.platform==='win32';
 const base=win
  ? path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local'),'CommanderV2','QA','official-cos-tag2150-sparse-20261104')
  : path.join(os.homedir(),'.local','state','CommanderV2','QA','cos2150-unified-rebuild-20261104');
 const source=win
  ? path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local'),'ChatGPTRemoteCommander','qa','v1-dev23-capgap-bridge')
  : path.join(os.homedir(),'.local','state','CommanderV2','QA','v1-dev23-capgap-bridge');
 const unpacked=path.join(base,'release','v1core-qa',win?'win-unpacked':'linux-unpacked');
 return {base,source,unpacked};
}
test('CoS single QA package embeds owner-independent V1 dev23 core as inert internal resource; duplicate staging fails closed',t=>{
 const q=qaPaths();
 if(!fs.existsSync(path.join(q.base,'resources','commander-v1-core','MANIFEST.json'))||
    !fs.existsSync(path.join(q.source,'.v1-dev23-capgap-disposable-qa')))
  return t.skip('Pinned, disposable CoS and V1 QA native fixtures are not present on this runner');
 const builder=path.join(q.base,'electron-builder.yml');
 const before=sha(builder);
 const r=run('verify',q.base,q.source);
 assert.equal(r.status,'COS_V1_INTERNAL_RESOURCE_VERIFIED');
 assert.equal(r.fileCount,75);
 assert.equal(r.activeV1Modified,false);
 assert.equal(r.productInstalled,false);
 assert.throws(()=>run('stage',q.base,q.source),/COS_V1_BUNDLE_ALREADY_STAGED/);
 assert.equal(sha(builder),before);
});
test('extracted Electron QA package contains exact R18, V1 dev23 core and no implied production authority',t=>{
 const q=qaPaths();
 if(!fs.existsSync(path.join(q.unpacked,'resources','commander-v1-core','MANIFEST.json')))
  return t.skip('Pinned unpacked QA candidate not built on this runner');
 const r=verify(q.unpacked);
 assert.equal(r.gate,'COS_V1_CORE_IN_ELECTRON_UNPACKED_QA_PASS');
 assert.equal(r.sourceFileCount,75);
 assert.equal(r.electronAppPresent,true);
 assert.equal(r.backendComponent,'INERT_NOT_STARTED');
 for(const flag of ['installed','serviceMigrated','authVerified','nativeWorkerVerified','publisherSigned','oneHostInstallAcceptance'])
  assert.equal(r[flag],false,flag);
});
test('package verifier rejects untrusted root and cannot mistake source-only staging for an installed app',()=>{
 assert.throws(()=>verify(path.join(os.tmpdir(),'nonexistent-v1-core-co-s-qa')),
   /COS_V1_PACKAGED_UNPACKED_PLATFORM_ROOT_INVALID/);
});
