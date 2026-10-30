import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {censusV2EnrollmentScope} from '../tools/v2-enrollment-census.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upgrader=path.join(repo,'auto-update-windows.ps1');

async function fixture(fn){
 const root=await mkdtemp(path.join(os.tmpdir(),'rc-v2-win-updater-'));
 const p=path.join(root,'profiles'), c=path.join(root,'credentials');
 await mkdir(p); await mkdir(c);
 try{await fn(p,c);}finally{await rm(root,{recursive:true,force:true});}
}
test('Windows updater blocks missing DPAPI after candidate NoPromote and before any route switch',async()=>{
 const s=await readFile(upgrader,'utf8');
 const noPromoteExit=s.lastIndexOf('AUTO_UPDATE_CANDIDATE_PASS');
 const guard=s.lastIndexOf('AUTO_UPDATE_PROFILE_CREDENTIAL_PRESERVATION_BLOCK');
 const routerStep=s.lastIndexOf('$routerBootstrapDeferred=@()');
 const switchStep=s.lastIndexOf('Switch-Route $t $c');
 assert.ok(noPromoteExit>0 && guard>noPromoteExit && guard<routerStep);
 assert.ok(switchStep>guard);
 assert.ok(s.includes("tools\\v2-enrollment-census.mjs"));
 assert.ok(s.includes('--profile-dir $ProfileDir --credential-dir $credentialDir | Out-Null'));
 assert.match(s,/AUTO_UPDATE_PROFILE_CREDENTIAL_GUARD_UNAVAILABLE/);
});
test('missing Windows protected key blocks preflight even if original tunnel is live',async()=>{
 await fixture(async(p,c)=>{
  await writeFile(path.join(p,'running.yaml'),'never-read');
  await writeFile(path.join(p,'needs-recovery.yaml'),'never-read');
  await writeFile(path.join(c,'running.dpapi'),'opaque-key');
  const v=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'win32'});
  assert.equal(v.credentialMatches.missing,1);
  assert.equal(v.structuralStatus,'BLOCKED_RECONCILIATION');
  assert.equal(v.safeForAutomaticMigration,false);
  const publicValue=JSON.stringify(v);
  for(const item of ['running.yaml','needs-recovery.yaml','opaque-key',p,c])assert.ok(!publicValue.includes(item));
 });
});
test('both CurrentUser and LocalMachine references are kept distinct and not collapsed',async()=>{
 await fixture(async(p,c)=>{
  await writeFile(path.join(p,'owner.yaml'),'config-not-inspected');
  await writeFile(path.join(c,'owner.dpapi'),'protected');
  await writeFile(path.join(c,'owner.machine.dpapi'),'protected');
  const v=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'win32'});
  assert.equal(v.structuralStatus,'STRUCTURAL_MATCH');
  assert.equal(v.credentialMatches.currentUser,1);
  assert.equal(v.credentialMatches.localMachine,1);
  assert.equal(v.credentialMatches.bothWindowsScopes,1);
  assert.equal(v.credentialUsability,'UNVERIFIED');
  assert.equal(v.safeForAutomaticMigration,false);
 });
});
