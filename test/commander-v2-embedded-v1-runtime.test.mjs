import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verify} from '../tools/verify-commander-v2-embedded-v1-runtime.mjs';

function qaRoot(){
 const local=process.platform==='win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'CommanderV2','QA','official-cos-tag2150-sparse-20261104')
  : path.join(os.homedir(),'.local','state','CommanderV2','QA','cos2150-unified-rebuild-20261104');
 return path.join(local,'release','commander-v2-qa',process.platform==='win32'?'win-unpacked':'linux-unpacked');
}

test('rejects arbitrary root before any runtime spawn or data mutation',async()=>{
 await assert.rejects(()=>verify(path.join(os.tmpdir(),'wrong-embedded-core')),
  /COMMANDER_V2_EMBEDDED_CORE_QA_QA_PRODUCT_DIRECTORY/);
});

test('one packaged Commander V2 executable runs pinned V1 MCP with owner-private persistence and no installed-service effects',async(t)=>{
 if(!['linux','win32'].includes(process.platform))return t.skip('Windows/Linux only');
 const root=qaRoot();
 if(!fs.existsSync(path.join(root,'resources','commander-v1-core','MANIFEST.json')) ||
  !fs.existsSync(path.join(root,process.platform==='win32'?'Commander V2.exe':'commander-v2')))
  return t.skip('Native packaged QA source not present on this CI host');
 const x=await verify(root);
 assert.equal(x.gate,'COMMANDER_V2_EMBEDDED_V1_RUNTIME_QA_PASS');
 assert.equal(x.methods,64);
 assert.equal(x.addedNativeGapMethods,4);
 assert.equal(x.electronNodeInternal,true);
 for(const field of ['requestIdIdempotent','restartPersistent','secondOwnerIsolated','sourceUnchanged'])
  assert.equal(x[field],true,field);
 for(const field of ['productionServiceStarted','installed','ownerAccountsUsed','fullPowerGranted','liveGuiVerified'])
  assert.equal(x[field],false,field);
});
