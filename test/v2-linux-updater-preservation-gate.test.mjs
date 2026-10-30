import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upgrader=path.join(root,'auto-update-linux.sh');
const census=path.join(root,'tools/v2-enrollment-census.mjs');
function probe(p,c){return spawnSync(process.execPath,[census,'--profile-dir',p,'--credential-dir',c],{encoding:'utf8',timeout:6000});}
async function fixture(fn){const d=await mkdtemp(path.join(os.tmpdir(),'v2-restart-'));const p=path.join(d,'profiles'),c=path.join(d,'credentials');await mkdir(p);await mkdir(c);try{await fn(p,c);}finally{await rm(d,{recursive:true,force:true});}}
test('Linux updater blocks missing-key promotion before route maintenance',async()=>{
 const s=await readFile(upgrader,'utf8');
 const guard=s.indexOf('AUTO_UPDATE_PROFILE_CREDENTIAL_PRESERVATION_BLOCK');
 const maintenance=s.indexOf('if [[ "$FORCE" != 1 && -f "$ROUTE" ]]; then');
 const switchIndex=s.indexOf('node "$STAGE_DIR/tools/router-switch.mjs"');
 assert.ok(guard>0&&guard<maintenance&&guard<switchIndex);
 assert.match(s,/NO_PROMOTE" != 1.*PROFILE_DIR.*CRED_DIR/);
 assert.match(s,/--profile-dir "\$PROFILE_DIR" --credential-dir "\$CRED_DIR"/);
 assert.ok(s.includes('CRED_DIR=')&&s.includes('chatgpt-remote-commander/credentials'));
});
test('missing owner key rejects restart-safety with no profile names leaked',async()=>{
 await fixture(async(p,c)=>{
  await writeFile(path.join(p,'present.yaml'),'config');
  await writeFile(path.join(p,'missing.yaml'),'config');
  await writeFile(path.join(c,'present.key'),'opaque-value');
  const r=probe(p,c);assert.equal(r.status,2);
  const out=JSON.parse(r.stdout);
  assert.equal(out.structuralStatus,'BLOCKED_RECONCILIATION');
  assert.equal(out.credentialMatches.missing,1);
  assert.equal(out.safeForAutomaticMigration,false);
  for(const secret of ['present','missing','opaque-value',p,c])assert.equal(r.stdout.includes(secret),false);
 });
});
test('matching credentials pass structural check but cannot approve cutover',async()=>{
 await fixture(async(p,c)=>{
  await writeFile(path.join(p,'one.yaml'),'config');
  await writeFile(path.join(c,'one.key'),'opaque-value');
  const r=probe(p,c);assert.equal(r.status,0);
  const out=JSON.parse(r.stdout);
  assert.equal(out.structuralStatus,'STRUCTURAL_MATCH');
  assert.equal(out.safeForAutomaticMigration,false);
  assert.equal(out.chatIdentity,'UNVERIFIED');
 });
});
