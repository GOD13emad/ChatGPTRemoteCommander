import test from 'node:test';
import assert from 'node:assert/strict';
import { readEffectiveOsPrivilege } from '../src/os-privilege.mjs';
import { powerStatus } from '../src/power-tools-v0.3.mjs';

test('POSIX effective root is authoritative, not a sudo-group assumption', () => {
  const root = readEffectiveOsPrivilege({ platform:'linux', effectiveUid:0 });
  const user = readEffectiveOsPrivilege({ platform:'linux', effectiveUid:1000 });
  assert.equal(root.elevated, true);
  assert.equal(root.authority, 'root');
  assert.equal(user.elevated, false);
  assert.equal(user.nativeAuthorizationRequired, true);
  assert.equal(user.crossUserSessionAccess, 'not-established');
});
test('Missing POSIX identity fails closed without inventing root', () => {
  const r=readEffectiveOsPrivilege({platform:'linux',effectiveUid:null});
  assert.equal(r.elevated,null);
});
const win = (administrator, system=false, sessionId=1) =>
  () => ({status:0,stdout:JSON.stringify({administrator,system,sessionId})});
test('Windows medium token is not considered elevated merely by username', () => {
  const r=readEffectiveOsPrivilege({platform:'win32',runProbe:win(false,false),systemRoot:'C:\\Windows'});
  assert.equal(r.elevated,false);
  assert.equal(r.nativeAuthorizationRequired,true);
});
test('Windows elevated Administrator is reported without granting cross-session access', () => {
  const r=readEffectiveOsPrivilege({platform:'win32',runProbe:win(true,false,2),systemRoot:'C:\\Windows'});
  assert.equal(r.authority,'administrator');
  assert.equal(r.sessionId,2);
  assert.equal(r.crossUserSessionAccess,'not-established');
});
test('Windows SYSTEM token reports system authority', () => {
  const r=readEffectiveOsPrivilege({platform:'win32',runProbe:win(true,true,0),systemRoot:'C:\\Windows'});
  assert.equal(r.authority,'system');
  assert.equal(r.elevated,true);
});
test('Windows probe errors, malformed JSON and missing identity are unknown', () => {
  for (const runProbe of [() => ({error:new Error('denied')}),()=>({status:0,stdout:'{}'}),()=>{throw new Error('blocked')}]){
    const r=readEffectiveOsPrivilege({platform:'win32',runProbe});
    assert.equal(r.elevated,null);
    assert.equal(r.nativeAuthorizationRequired,null);
  }
});
test('Power status exposes native OS privilege separately from Full Power flags', async () => {
  const ctx={ config:{powerMode:{enabled:true,allowShell:true,fullFilesystem:true,allowProcessControl:true,
    backupRetentionSnapshots:8}}, roots:[process.cwd()] };
  const r=await powerStatus(ctx);
  assert.equal(r.enabled,true);
  assert.equal(r.allowShell,true);
  assert.ok(r.osPrivilege);
  assert.ok([true,false,null].includes(r.osPrivilege.elevated));
  assert.equal(r.osPrivilege.crossUserSessionAccess,'not-established');
});
