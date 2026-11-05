import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const native = process.platform === 'win32';
const script = fileURLToPath(new URL('../tools/v2-owner-peercred-windows.ps1',import.meta.url));
function probe(...args){
 const r=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',script,...args],{
  encoding:'utf8',timeout:8000,maxBuffer:65536,windowsHide:true
 });
 assert.equal(r.error,undefined,String(r.error));
 return r;
}
test('real native Windows IPC verifies connected owner SID, never grants MCP or admin', {skip:!native},()=>{
 const r=probe('-SelfTest');
 assert.equal(r.status,0,r.stderr);
 const v=JSON.parse(r.stdout.trim());
 assert.equal(v.gate,'CMDV2_WIN_NATIVE_OWNER_PIPE_QA_PASS');
 assert.equal(v.currentUserOnly,true);
 assert.equal(v.actualConnectedOwnerSidMatches,true);
 assert.equal(v.syntheticGrant,false);
 assert.equal(v.chatAccountAuthenticated,false);
 assert.equal(v.mcpAuthorized,false);
 assert.equal(v.adminGranted,false);
 assert.equal(v.installed,false);
 assert.equal(/S-1-5|Aa\.Emad|Administrator/i.test(r.stdout),false);
});
test('synthetic expected owner SID mismatch is explicitly refused, not other-user login proof',{skip:!native},()=>{
 const r=probe('-SelfTest','-NegativeSidCheck');
 assert.equal(r.status,0,r.stderr);
 const v=JSON.parse(r.stdout.trim());
 assert.equal(v.gate,'CMDV2_WIN_OWNER_SID_MISMATCH_DENIED_QA_PASS');
 assert.equal(v.syntheticExpectedSidMismatch,true);
 assert.equal(v.crossUserClientActuallyTested,false);
 assert.equal(v.mcpAuthorized,false);
});
test('native helper without QA-only switch refuses to create any pipe', {skip:!native},()=>{
 const r=probe();
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/CMDV2_OWNER_PIPE_QA_ONLY/);
});
