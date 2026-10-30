import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { censusV2EnrollmentScope, compareV2EnrollmentStructure } from '../tools/v2-enrollment-census.mjs';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'v2-census-'));
  const profileDir = path.join(root, 'profiles');
  const credentialDir = path.join(root, 'credentials');
  await mkdir(profileDir);
  await mkdir(credentialDir);
  try { await fn({ root, profileDir, credentialDir }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function f(root, name, content = 'opaque-credentials-should-never-be-read') {
  await writeFile(path.join(root, name), content);
}
test('Windows DPAPI dual scopes preserve three enrolled profiles and never emit identity/secrets', async () => {
  await fixture(async ({ root, profileDir: p, credentialDir: c }) => {
    for (const n of ['primary', 'other', 'third']) await f(p, n + '.yaml');
    for (const n of ['primary.dpapi', 'primary.machine.dpapi',
      'other.machine.dpapi', 'third.dpapi']) await f(c, n);
    const out = await censusV2EnrollmentScope({ profileDir:p, credentialDir:c, platform:'win32' });
    assert.equal(out.profileCount, 3);
    assert.equal(out.credentialFileCount, 4);
    assert.equal(out.credentialMatches.bothWindowsScopes, 1);
    assert.equal(out.credentialMatches.missing, 0);
    assert.equal(out.structuralStatus, 'STRUCTURAL_MATCH');
    assert.equal(out.credentialUsability, 'UNVERIFIED');
    assert.equal(out.safeForAutomaticMigration, false);
    const printed = JSON.stringify(out);
    for (const secret of ['primary', 'other', 'third', 'opaque-credentials', root]) {
      // The test's temp root path is inaccessible outside this fixture.
      if (secret !== root) assert.equal(printed.includes(secret), false);
    }
  });
});
test('Linux uses per-owner key references without credential byte reads', async () => {
  await fixture(async ({profileDir:p, credentialDir:c}) => {
    await f(p, 'linux-one.yaml'); await f(p, 'linux-two.yaml');
    await f(c, 'linux-one.key'); await f(c, 'linux-two.key');
    const out = await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'linux'});
    assert.equal(out.credentialMatches.linuxOwner, 2);
    assert.equal(out.structuralStatus, 'STRUCTURAL_MATCH');
    assert.equal(out.chatIdentity, 'UNVERIFIED');
  });
});
test('missing owner credential, orphan, missing root and invalid profile block migration', async () => {
  await fixture(async ({profileDir:p,credentialDir:c,root}) => {
    await f(p,'have.yaml'); await f(p,'missing.yaml'); await f(c,'have.dpapi');
    await f(c,'orphan.dpapi');
    const a=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'win32'});
    assert.equal(a.credentialMatches.missing,1);
    assert.equal(a.unmatchedCredentialFileCount,1);
    assert.equal(a.structuralStatus,'BLOCKED_RECONCILIATION');
    const b=await censusV2EnrollmentScope({profileDir:path.join(root,'absent'),credentialDir:c,platform:'win32'});
    assert.equal(b.rootsPresent,false);
    assert.equal(b.safeForAutomaticMigration,false);
    await f(p,'bad name.yaml');
    const d=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'win32'});
    assert.equal(d.invalidProfileNameCount,1);
  });
});
test('ambiguous foo.machine credential scope is fail-closed instead of silently merged', async () => {
  await fixture(async ({profileDir:p,credentialDir:c}) => {
    await f(p,'foo.yaml'); await f(p,'foo.machine.yaml');
    await f(c,'foo.machine.dpapi');
    const out=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'win32'});
    assert.equal(out.ambiguousCredentialReferenceCount,1);
    assert.equal(out.structuralStatus,'BLOCKED_RECONCILIATION');
  });
});
test('Windows case collisions cannot become ambiguous profile identities', {skip:process.platform==='win32'}, async () => {
  await fixture(async ({profileDir:p,credentialDir:c}) => {
    await f(p,'Alice.yaml');await f(p,'alice.yaml');await f(c,'Alice.dpapi');
    const out=await censusV2EnrollmentScope({profileDir:p,credentialDir:c,platform:'win32'});
    assert.equal(out.caseCollisionCount,1);
    assert.equal(out.structuralStatus,'BLOCKED_RECONCILIATION');
  });
});
test('root symlinks are never followed (Linux native only)', {skip:process.platform==='win32'}, async () => {
  await fixture(async ({root,profileDir:p,credentialDir:c}) => {
    const alias=path.join(root,'alias');
    await symlink(p,alias,'dir');
    await assert.rejects(censusV2EnrollmentScope({profileDir:alias,credentialDir:c,platform:'linux'}),
      {code:'V2_CENSUS_UNTRUSTED_ROOT'});
  });
});
test('relative roots and unsupported OS are rejected without reading data', async () => {
  await assert.rejects(censusV2EnrollmentScope({profileDir:'relative',credentialDir:'relative',platform:'win32'}),
    {code:'V2_CENSUS_ABSOLUTE_ROOT_REQUIRED'});
  await assert.rejects(censusV2EnrollmentScope({profileDir:'/tmp/a',credentialDir:'/tmp/b',platform:'plan9'}),
    {code:'V2_CENSUS_PLATFORM_UNSUPPORTED'});
});

test('paired migration with exact profile and credential references is structural-only, never authorized', async () => {
  await fixture(async ({root,profileDir,credentialDir}) => {
    const after={profileDir:path.join(root,'after-profiles'),credentialDir:path.join(root,'after-credentials')};
    await mkdir(after.profileDir);await mkdir(after.credentialDir);
    for(const name of ['first.yaml','second.yaml']){
      await f(profileDir,name);await f(after.profileDir,name);
    }
    for(const name of ['first.dpapi','first.machine.dpapi','second.machine.dpapi']){
      await f(credentialDir,name);await f(after.credentialDir,name);
    }
    const result=await compareV2EnrollmentStructure({
      before:{profileDir,credentialDir},after,platform:'win32'
    });
    assert.equal(result.status,'STRUCTURAL_PRESERVATION_UNVERIFIED');
    assert.equal(result.profileIdentitySetPreserved,true);
    assert.equal(result.credentialReferenceSetPreserved,true);
    assert.equal(result.safeForAutomaticMigration,false);
    const output=JSON.stringify(result);
    for(const word of ['first','second','after-profiles','opaque-credentials'])
      assert.equal(output.includes(word),false);
  });
});
test('same counts with changed profile names cannot be declared preserved', async () => {
  await fixture(async ({root,profileDir,credentialDir}) => {
    const after={profileDir:path.join(root,'after-profiles'),credentialDir:path.join(root,'after-credentials')};
    await mkdir(after.profileDir);await mkdir(after.credentialDir);
    await f(profileDir,'alice.yaml');await f(credentialDir,'alice.dpapi');
    await f(after.profileDir,'bob.yaml');await f(after.credentialDir,'bob.dpapi');
    const r=await compareV2EnrollmentStructure({before:{profileDir,credentialDir},after,platform:'win32'});
    assert.equal(r.profileCountBefore,r.profileCountAfter);
    assert.equal(r.credentialCountBefore,r.credentialCountAfter);
    assert.equal(r.status,'BLOCKED_RECONCILIATION');
    assert.equal(r.profileIdentitySetPreserved,false);
  });
});
test('same profile but changed DPAPI scope must not be admitted', async () => {
  await fixture(async ({root,profileDir,credentialDir}) => {
    const after={profileDir:path.join(root,'after-profiles'),credentialDir:path.join(root,'after-credentials')};
    await mkdir(after.profileDir);await mkdir(after.credentialDir);
    await f(profileDir,'owner.yaml');await f(after.profileDir,'owner.yaml');
    await f(credentialDir,'owner.dpapi');await f(after.credentialDir,'owner.machine.dpapi');
    const r=await compareV2EnrollmentStructure({before:{profileDir,credentialDir},after,platform:'win32'});
    assert.equal(r.profileIdentitySetPreserved,true);
    assert.equal(r.credentialReferenceSetPreserved,false);
    assert.equal(r.status,'BLOCKED_RECONCILIATION');
  });
});
test('same live root and missing paired roots never qualify migration', async () => {
  await fixture(async ({root,profileDir,credentialDir}) => {
    const before={profileDir,credentialDir};
    let r=await compareV2EnrollmentStructure({before,after:before,platform:'linux'});
    assert.equal(r.status,'SAME_LOCATION_NOT_MIGRATION');
    assert.equal(r.safeForAutomaticMigration,false);
    const after={profileDir:path.join(root,'absent-p'),credentialDir:path.join(root,'absent-c')};
    r=await compareV2EnrollmentStructure({before,after,platform:'linux'});
    assert.equal(r.status,'BLOCKED_RECONCILIATION');
    assert.equal(r.credentialUsability,'UNVERIFIED');
  });
});
test('Linux case-sensitive profile identity changes are detected', async () => {
  await fixture(async ({root,profileDir,credentialDir}) => {
    const after={profileDir:path.join(root,'after-profiles'),credentialDir:path.join(root,'after-credentials')};
    await mkdir(after.profileDir);await mkdir(after.credentialDir);
    await f(profileDir,'Alice.yaml');await f(credentialDir,'Alice.key');
    await f(after.profileDir,'alice.yaml');await f(after.credentialDir,'alice.key');
    const r=await compareV2EnrollmentStructure({before:{profileDir,credentialDir},after,platform:'linux'});
    assert.equal(r.status,'BLOCKED_RECONCILIATION');
  });
});
test('Windows uppercase YAML extension is considered a valid enrollment', async () => {
  await fixture(async ({profileDir,credentialDir}) => {
    await f(profileDir,'owner.YAML');await f(credentialDir,'owner.dpapi');
    const r=await censusV2EnrollmentScope({profileDir,credentialDir,platform:'win32'});
    assert.equal(r.profileCount,1);
    assert.equal(r.structuralStatus,'STRUCTURAL_MATCH');
  });
});
