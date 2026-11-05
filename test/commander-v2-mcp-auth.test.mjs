import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execute} from '../tools/stage-commander-v2-mcp-auth-qa.mjs';
import {verify} from '../tools/verify-commander-v2-mcp-auth-runtime.mjs';
const root=()=>{
 const windows=process.platform==='win32';
 return windows?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),
 'CommanderV2','QA','official-cos-tag2150-sparse-20261104'):
 path.join(os.homedir(),'.local','state','CommanderV2','QA','cos2150-unified-rebuild-20261104');
};
test('rejects unauthenticated MCP patch against any non-QA root',()=>{
 assert.throws(()=>execute('verify',path.join(os.tmpdir(),'different-untrusted-root')),
  /CMDV2_MCP_AUTH_QA_UNRELATED_ROOT/);
});
test('verified staged QA server derives only from pinned original V1 and preserves installed runtime',t=>{
 if(!['win32','linux'].includes(process.platform))return t.skip('Windows/Linux only');
 const q=root();
 if(!fs.existsSync(path.join(q,'.commander-v2-mcp-auth-qa-backup','MANIFEST.json')))
  return t.skip('No exact disposable QA source fixture on runner');
 const result=execute('verify',q);
 assert.equal(result.gate,'CMDV2_QA_MCP_BEARER_SOURCE_PASS');
 assert.equal(result.files,75);
 assert.equal(result.auth,'QA_PROCESS_BEARER');
 assert.equal(result.ownerLoginVerified,false);
 assert.equal(result.oldV1ServiceTouched,false);
 assert.throws(()=>execute('stage',q),/CMDV2_MCP_AUTH_QA_REQUIRE_FRESH_STAGE/);
});
test('real packaged Core denies unauthorized MCP, accepts bearer, rotates it and prevents cross-origin effects',async t=>{
 if(!['win32','linux'].includes(process.platform))return t.skip('Windows/Linux only');
 const q=root();
 if(!fs.existsSync(path.join(q,'release','commander-v2-authqa',
  process.platform==='win32'?'win-unpacked':'linux-unpacked','resources','commander-v1-core','MANIFEST.json')))
  return t.skip('Actual auth QA package not built here');
 const result=await verify(q,true);
 assert.equal(result.gate,'COMMANDER_V2_MCP_PROCESS_CAPABILITY_NATIVE_QA_PASS');
 assert.equal(result.packaged,true);
 assert.equal(result.coreMethods,64);
 for(const key of ['unauthenticatedRejected','wrongTokenRejected','hostSpoofRejected',
   'originSpoofRejected','mutationRejectedBeforeDispatch','bearerRotatesOnRestart',
   'missingEnvFailsClosed','healthMinimized'])
  assert.equal(result[key],true,key);
 for(const key of ['ownerAuthenticated','oauthImplemented','elevated','liveV1Touched','installed'])
  assert.equal(result[key],false,key);
});
