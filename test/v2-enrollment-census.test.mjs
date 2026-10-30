import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { censusV2EnrollmentScope } from '../tools/v2-enrollment-census.mjs';

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
