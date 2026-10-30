// V2 R0 preflight: metadata-only, read-only enrollment census for ONE OS user.
// Never reads YAML, .key or DPAPI contents; never emits profile names, paths,
// tunnel IDs, tokens or credential bytes. Not an OAuth or key usability test.
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

function fail(code) { throw Object.assign(new Error(code), { code }); }
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

async function scanDirectory(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    fail('V2_CENSUS_ABSOLUTE_ROOT_REQUIRED');
  let meta;
  try { meta = await lstat(root); }
  catch (e) {
    if (e?.code === 'ENOENT') return { exists: false, entries: [], unsafe: 0 };
    fail('V2_CENSUS_ROOT_UNREADABLE');
  }
  if (meta.isSymbolicLink() || !meta.isDirectory())
    fail('V2_CENSUS_UNTRUSTED_ROOT');
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { fail('V2_CENSUS_ROOT_UNREADABLE'); }
  // Never follow symlinks or recurse into credential/profile locations.
  return {
    exists: true,
    entries: entries.filter(x => x.isFile()).map(x => x.name),
    unsafe: entries.filter(x => x.isSymbolicLink()).length
  };
}

/**
 * Strict structural migration preflight for ONE native OS account only.
 * Roots must be native absolute paths; the result never contains filenames.
 * Credential usability, account ownership, enrollment and caller identity
 * remain UNVERIFIED until separate live/native acceptance.
 */
export async function censusV2EnrollmentScope({
  profileDir, credentialDir, platform = process.platform
} = {}) {
  if (!['win32', 'linux'].includes(platform))
    fail('V2_CENSUS_PLATFORM_UNSUPPORTED');
  const [profiles, credentials] = await Promise.all([
    scanDirectory(profileDir), scanDirectory(credentialDir)
  ]);
  const canon = n => platform === 'win32' ? n.toLowerCase() : n;
  const yaml = profiles.entries.filter(n => platform === 'win32' ? n.toLowerCase().endsWith('.yaml') : n.endsWith('.yaml'))
    .map(n => n.slice(0, -5));
  const names = yaml.filter(n => FILENAME.test(n));
  const invalid = yaml.length - names.length;
  const aliases = names.length - new Set(names.map(canon)).size;
  const expected = new Map();
  const matches = {
    currentUser: 0, localMachine: 0, linuxOwner: 0,
    bothWindowsScopes: 0, missing: 0
  };
  for (const name of names) {
    const suffixes = platform === 'win32'
      ? [['currentUser', name + '.dpapi'], ['localMachine', name + '.machine.dpapi']]
      : [['linuxOwner', name + '.key']];
    const present = [];
    for (const [scope, filename] of suffixes) {
      const token = canon(filename);
      // Keep references distinct: foo.machine.dpapi can be ambiguous
      // for profiles "foo" and "foo.machine".
      expected.set(token, (expected.get(token) || 0) + 1);
      if (credentials.entries.some(n => canon(n) === token)) {
        matches[scope]++;
        present.push(scope);
      }
    }
    if (present.length === 0) matches.missing++;
    if (platform === 'win32' && present.length === 2)
      matches.bothWindowsScopes++;
  }
  const credentialPattern = platform === 'win32' ? /\.dpapi$/i : /\.key$/;
  const relevant = credentials.entries.filter(n => credentialPattern.test(n));
  const discovered = relevant.map(canon);
  const duplicates = discovered.length - new Set(discovered).size;
  const unmatched = discovered.filter(n => !expected.has(n)).length;
  const ambiguousReferences = discovered.filter(n => (expected.get(n) || 0) > 1).length;
  const rootsPresent = profiles.exists && credentials.exists;
  const anomalies = invalid + aliases + duplicates + unmatched
    + ambiguousReferences + matches.missing + profiles.unsafe + credentials.unsafe;
  return Object.freeze({
    schema: 1,
    evidenceType: 'NONSECRET_FILESYSTEM_STRUCTURE_ONLY',
    scope: 'ONE_OS_USER_NOT_WHOLE_HOST',
    platform,
    rootsPresent,
    profileCount: names.length,
    credentialFileCount: relevant.length,
    credentialMatches: Object.freeze(matches),
    invalidProfileNameCount: invalid,
    caseCollisionCount: aliases + duplicates,
    ambiguousCredentialReferenceCount: ambiguousReferences,
    unmatchedCredentialFileCount: unmatched,
    symlinkEntryCount: profiles.unsafe + credentials.unsafe,
    structuralStatus: rootsPresent && !anomalies ? 'STRUCTURAL_MATCH' : 'BLOCKED_RECONCILIATION',
    credentialUsability: 'UNVERIFIED',
    chatIdentity: 'UNVERIFIED',
    safeForAutomaticMigration: false
  });
}

/**
 * Compare two NON-LIVE (staged/recovery) enrollment directories inside a
 * single trusted owner process. IDs remain inside this process; results are
 * anonymous counts/booleans only. It intentionally cannot approve a cutover.
 * Never use this to compare folders belonging to different OS identities.
 */
export async function compareV2EnrollmentStructure({
  before, after, platform = process.platform
} = {}) {
  if (!['win32', 'linux'].includes(platform)) fail('V2_CENSUS_PLATFORM_UNSUPPORTED');
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object')
    fail('V2_CENSUS_PAIR_REQUIRED');
  const fields = ['profileDir', 'credentialDir'];
  for (const x of [before, after]) {
    for (const field of fields) {
      if (typeof x[field] !== 'string' || !path.isAbsolute(x[field]))
        fail('V2_CENSUS_ABSOLUTE_ROOT_REQUIRED');
    }
  }
  const canon = value => platform === 'win32' ? value.toLowerCase() : value;
  const sameRoots = fields.some(k => canon(path.resolve(before[k])) === canon(path.resolve(after[k])));
  if (sameRoots) return Object.freeze({
    schema: 1, status: 'SAME_LOCATION_NOT_MIGRATION',
    profileCountBefore: null, profileCountAfter: null,
    credentialCountBefore: null, credentialCountAfter: null,
    profileIdentitySetPreserved: false, credentialReferenceSetPreserved: false,
    credentialUsability: 'UNVERIFIED', ownerIdentity: 'UNVERIFIED',
    tunnelIdentity: 'UNVERIFIED', safeForAutomaticMigration: false
  });
  const get = async directories => {
    const [p,c] = await Promise.all([
      scanDirectory(directories.profileDir),
      scanDirectory(directories.credentialDir)
    ]);
    const prof = p.entries.filter(n => platform === 'win32'
      ? n.toLowerCase().endsWith('.yaml') : n.endsWith('.yaml'))
      .map(n => canon(n.slice(0,-5)));
    const cred = c.entries.filter(n => platform === 'win32'
      ? n.toLowerCase().endsWith('.dpapi') : n.endsWith('.key')).map(canon);
    const nameSet = new Set(prof), credSet = new Set(cred);
    const expected = new Map();
    let missing=0;
    for (const name of prof) {
      const suffixes = platform === 'win32'
        ? [name + '.dpapi', name + '.machine.dpapi'] : [name + '.key'];
      for (const x of suffixes) expected.set(x,(expected.get(x)||0)+1);
      if (!suffixes.some(x => credSet.has(x))) missing++;
    }
    const bad = prof.some(n=>!FILENAME.test(n)) ||
      nameSet.size !== prof.length || credSet.size !== cred.length ||
      cred.some(n=>!expected.has(n) || expected.get(n)>1) ||
      missing!==0 || p.unsafe!==0 || c.unsafe!==0;
    return { valid:p.exists && c.exists && !bad, prof, cred };
  };
  const [a,b] = await Promise.all([get(before), get(after)]);
  const equal=(u,v)=>u.length===v.length &&
    [...u].sort().every((x,i)=>x===[...v].sort()[i]);
  const profilesSame=equal(a.prof,b.prof);
  const credentialsSame=equal(a.cred,b.cred);
  const matched=a.valid && b.valid && profilesSame && credentialsSame;
  return Object.freeze({
    schema: 1,
    status:matched?'STRUCTURAL_PRESERVATION_UNVERIFIED':'BLOCKED_RECONCILIATION',
    profileCountBefore:a.prof.length,profileCountAfter:b.prof.length,
    credentialCountBefore:a.cred.length,credentialCountAfter:b.cred.length,
    profileIdentitySetPreserved:a.valid && b.valid && profilesSame,
    credentialReferenceSetPreserved:a.valid && b.valid && credentialsSame,
    credentialUsability:'UNVERIFIED',ownerIdentity:'UNVERIFIED',
    tunnelIdentity:'UNVERIFIED',safeForAutomaticMigration:false
  });
}

function defaults() {
  if (process.platform === 'win32') {
    if (!process.env.APPDATA || !process.env.LOCALAPPDATA)
      fail('V2_CENSUS_USER_ENV_REQUIRED');
    return {
      profileDir: path.join(process.env.APPDATA, 'tunnel-client'),
      credentialDir: path.join(process.env.LOCALAPPDATA, 'ChatGPTRemoteCommander', 'credentials')
    };
  }
  if (process.platform === 'linux') {
    const root = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return {
      profileDir: path.join(root, 'tunnel-client'),
      credentialDir: path.join(root, 'chatgpt-remote-commander', 'credentials')
    };
  }
  fail('V2_CENSUS_PLATFORM_UNSUPPORTED');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const a = process.argv.slice(2);
    let opts;
    if (!a.length) opts = defaults();
    else if (a.length === 4 && a[0] === '--profile-dir' && a[2] === '--credential-dir')
      opts = { profileDir: a[1], credentialDir: a[3] };
    else fail('V2_CENSUS_ARGUMENTS_INVALID');
    const report = await censusV2EnrollmentScope(opts);
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.structuralStatus !== 'STRUCTURAL_MATCH') process.exitCode = 2;
  } catch (e) {
    process.stderr.write((String(e?.code || '').startsWith('V2_CENSUS_')
      ? e.code : 'V2_CENSUS_UNKNOWN_FAILURE') + '\n');
    process.exitCode = 2;
  }
}
