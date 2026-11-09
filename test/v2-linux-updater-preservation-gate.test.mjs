import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {censusV2EnrollmentScope} from '../tools/v2-enrollment-census.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upgrader=path.join(root,'auto-update-linux.sh');
async function fixture(fn){
  const d=await mkdtemp(path.join(os.tmpdir(),'v2-restart-'));
  const p=path.join(d,'profiles'),c=path.join(d,'credentials');
  await mkdir(p);await mkdir(c);
  try{await fn(p,c);}finally{await rm(d,{recursive:true,force:true});}
}
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
test('missing owner key rejects Linux restart-safety without exposing profile identity',async()=>{
  await fixture(async(p,c)=>{
    await writeFile(path.join(p,'present.yaml'),'config');
    await writeFile(path.join(p,'missing.yaml'),'config');
    await writeFile(path.join(c,'present.key'),'opaque-value');
    const out=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'linux'});
    assert.equal(out.structuralStatus,'BLOCKED_RECONCILIATION');
    assert.equal(out.credentialMatches.missing,1);
    assert.equal(out.safeForAutomaticMigration,false);
    const publicReport=JSON.stringify(out);
    for(const secret of ['present.yaml','missing.yaml','opaque-value',p,c])
      assert.equal(publicReport.includes(secret),false);
  });
});
test('matching Linux owner key passes structure but does NOT approve cutover',async()=>{
  await fixture(async(p,c)=>{
    await writeFile(path.join(p,'one.yaml'),'config');
    await writeFile(path.join(c,'one.key'),'opaque-value');
    const out=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'linux'});
    assert.equal(out.structuralStatus,'STRUCTURAL_MATCH');
    assert.equal(out.safeForAutomaticMigration,false);
    assert.equal(out.credentialUsability,'UNVERIFIED');
    assert.equal(out.chatIdentity,'UNVERIFIED');
  });
});
