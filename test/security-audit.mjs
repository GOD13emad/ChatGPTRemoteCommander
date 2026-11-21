import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout;
}

const patterns = [
  ['OpenAI-style secret key', new RegExp('s' + 'k-' + '[A-Za-z0-9_-]{20,}', 'i')],
  ['Tunnel identifier', new RegExp('tunnel' + '_' + '[0-9a-f]{32}')],
  ['Private key block', new RegExp('-----BEGIN ' + '(?:RSA |EC |OPENSSH )?' + 'PRIVATE KEY-----', 'i')],
  ['Bearer token literal', new RegExp('Bearer\\s+' + '[A-Za-z0-9._-]{20,}', 'i')],
  ['GitHub token', new RegExp('gh' + '[pousr]_' + '[A-Za-z0-9]{20,}', 'i')],
  ['Developer Windows path', /C:\\Users\\[^\\\r\n]+\\source\\repos\\ChatGPTRemoteCommander/i]
];
const tunnelPattern = patterns.find(([type]) => type === 'Tunnel identifier')[1];
if (!tunnelPattern.test('tunnel' + '_' + '0123456789abcdef'.repeat(2)) || tunnelPattern.test('tunnel_control_plane_fresh') || tunnelPattern.test('TUNNEL_HEALTH_UNKNOWN_LISTENER')) {
  throw new Error('Tunnel identifier audit pattern regression');
}

// Exactly two synthetic TLS fixture literals were added in this historical commit.
// They contain a literal "\\nfixture" string, never a PEM payload. Suppress only
// these exact diff additions in this exact commit/file; any other PEM marker still fails.
const knownSyntheticTlsFixture = Object.freeze({
  commit: 'd890bd978b07aa738ceeef97bd6af2782538bac1',
  path: 'test/v2-mcp-http-ingress.test.mjs'
});
const syntheticPemHeader = '-----BEGIN ' + 'PRIVATE KEY-----';
const syntheticFixturePrefix = "+  privateKeyPem:'" + syntheticPemHeader + String.raw`\\nfixture` + "'";
const knownSyntheticFixtureLines = new Set([
  syntheticFixturePrefix + ',',
  syntheticFixturePrefix + '});'
]);
// Only two literal, intentionally invalid PEM strings in this exact historical
// host test commit are permitted. Neither contains base64 PEM material.
const knownSyntheticHostFixture = Object.freeze({
  commit: 'f31392c127e682762988b5bee70164752208b176',
  path: 'test/v101-linux-v2-candidate-host.test.mjs'
});
const literalNewline = String.fromCharCode(92) + 'n';
const knownSyntheticHostFixtureLines = new Set([
  "+    privateKeyPem:'" + syntheticPemHeader + literalNewline +
    "synthetic-host-private-key" + literalNewline + "-----END PRIVATE KEY-----',",
  "+    privateKeyPem:'" + syntheticPemHeader + literalNewline +
    "synthetic" + literalNewline + "-----END PRIVATE KEY-----',"
]);
// Exact historical non-secret marker lines, keyed by immutable commit + path
// and SHA-256 of the entire diff line. These are synthetic fixture values,
// literal scanner code or a vendored PEM parser delimiter, never PEM payloads.
// A changed byte, different commit, or other path is NOT exempted.
const knownHistoricalLiteralDigests = new Map([
  ['e178bf9b4b4daa6bc2916c106d02b2ac8cf2fa91:tools/probe-owner-pair-mtls.mjs',
    new Set(['8a5ca2619de853c3de2425a35ddb6da0ebb0d0c19a307325113cabfac8ced74c'])],
  ['633acfa7d5251538bea86e9e2464820c37de50f8:tools/probe-owner-pair-mtls.mjs',
    new Set(['ced33ff6f5f0634aa3c38870bf116ec78e949d28a98131da7f9322e0dbf20ad9'])],
  ['07ce35da16a63b6d77883671320bccfb5b97c398:test/security-audit.mjs',
    new Set(['142b22e7160ef720e82c82a9836230b43027c590fab1e08297ce65525c8e411d'])],
  ['0bd13b5c443171e2829d84358a82c8af09f60c1d:test/security-audit.mjs',
    new Set(['142b22e7160ef720e82c82a9836230b43027c590fab1e08297ce65525c8e411d',
      '973aa672b7a5e891977e4fb9cc188aefa3ba25770f34254a7cbe7e095a78109e'])],
  ['c4978731c897a755f55b8610fc58be0497a636c4:test/security-audit.mjs',
    new Set(['5a498e6198fbf81554859c4cacf937ad72301adddcf214de6b580eea822a38b9'])],
  ['594e79ff16c66c770446a0a27f38bf1d6bb59191:vendor/jose/dist/webapi/key/import.js',
    new Set(['eddc42eb6b4e168d1ca5b05a8a6504e202295ce1b94a38cff6d97ad20acf189d'])],
  ['9d3808595c1795ad6f261369050bd51bbcef0f3d:test/security-audit.mjs',
    new Set(['12bac2d0f51dfbf0890fc8386970c961ee303e1138b720d19c20487b335d21db'])],
  ['a89f4815aef76fdc6631104f96b025123e955160:tools/v1-01/installed-g1-readonly-probe.mjs',
    new Set(['32d77491c9ad0b608aba7d04116b0cc3ca1721b303ebdd372395ddebf5bb791c'])],
  ['47e2494fd12c6512d197f78f04b375fa2ed41100:tools/v1-01/installed-g1-readonly-probe.mjs',
    new Set(['91ae298d777dd42bb29e483665c24d92de257590678239fa2f696341e9113e0f'])],
  ['7602330376070ca3681838e49bf7f932179a04d9:test/notion-mcp-engine.test.mjs',
    new Set(['a906565280785b337117ab1e99d3c8e434fc46b45ec1a880545da4e1bb1bc79d'])],
  ['7b28ae4ffbfc3094c70647fd1ad8c4c491ba7bf5:test/notion-mcp-engine.test.mjs',
    new Set(['78a9e0660822161db13e986bb101ac0fe7cf07eda1ba575af36149f6b7e7f6f0'])]
]);
function scanSyntheticFixtureException(line, commit, path) {
  const trimmed = line.replace(/\r?\n$/, '');
  const allowed = commit === knownSyntheticTlsFixture.commit &&
      path === knownSyntheticTlsFixture.path ? knownSyntheticFixtureLines :
    commit === knownSyntheticHostFixture.commit &&
      path === knownSyntheticHostFixture.path ? knownSyntheticHostFixtureLines : null;
  if (allowed?.has(trimmed))
    return { line: line.replace(syntheticPemHeader, '[SYNTHETIC_TLS_FIXTURE]'), excepted: true };
  const digest=createHash('sha256').update(trimmed,'utf8').digest('hex');
  if (knownHistoricalLiteralDigests.get(commit+':'+path)?.has(digest))
    return { line: '[PINNED_NON_SECRET_HISTORY_LITERAL]\n', excepted: true };
  return { line, excepted: false };
}

// Scan complete Git history without buffering the entire potentially multi-GB patch.
// Lines are bounded; anything above the bound fails closed instead of being skipped.
function makeHistoryScanner(rules) {
  const hits = new Set();
  let pending = '', preceding = '', currentCommit = '', currentPath = '', exceptions = 0;
  const limit = 16 * 1024 * 1024;
  function scanLine(line) {
    const commitMatch = /^commit ([0-9a-f]{40})\r?\n?$/.exec(line);
    if (commitMatch) { currentCommit = commitMatch[1]; currentPath = ''; }
    const pathMatch = /^diff --git a\/(.+) b\/(.+)\r?\n?$/.exec(line);
    if (pathMatch) currentPath = pathMatch[1] === pathMatch[2] ? pathMatch[1] : '';
    const filtered = scanSyntheticFixtureException(line, currentCommit, currentPath);
    if (filtered.excepted) exceptions += 1;
    const sample = preceding + filtered.line;
    for (const [name, pattern] of rules) {
      pattern.lastIndex = 0;
      if (pattern.test(sample)) hits.add(name);
    }
    preceding = sample.slice(-512);
  }
  return {
    write(text) {
      pending += text;
      for (;;) {
        const at = pending.indexOf('\n');
        if (at < 0) break;
        scanLine(pending.slice(0, at + 1));
        pending = pending.slice(at + 1);
      }
      if (pending.length > limit) throw new Error('SECURITY_AUDIT_HISTORY_LINE_TOO_LONG');
    },
    finish() {
      if (pending) { scanLine(pending); pending = ''; }
      return { hits, exceptions };
    }
  };
}
const boundaryProbe = makeHistoryScanner(patterns);
boundaryProbe.write('tunnel' + '_0123456789abcdef');
boundaryProbe.write('0123456789abcdef\nBearer \n');
boundaryProbe.write('A'.repeat(25) + '\n');
const probed = boundaryProbe.finish().hits;
if (!probed.has('Tunnel identifier') || !probed.has('Bearer token literal')) {
  throw new Error('SECURITY_AUDIT_STREAM_SCANNER_REGRESSION');
}
async function scanCompleteHistory() {
  const args = ['log', '--all', '-p', '--no-color', '--no-ext-diff'];
  const child = spawn('git', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const scanner = makeHistoryScanner(patterns);
  const decoder = new StringDecoder('utf8');
  let stderr = '', bytes = 0;
  const errors = (async () => {
    for await (const chunk of child.stderr) stderr = (stderr + chunk.toString('utf8')).slice(-4096);
  })();
  try {
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      scanner.write(decoder.write(chunk));
    }
    scanner.write(decoder.end());
    const done = await closed;
    await errors;
    if (done.code !== 0 || done.signal) {
      throw new Error('git log --all -p failed: ' + stderr.slice(-1024));
    }
    return { ...scanner.finish(), bytes };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    await closed.catch(() => {});
    await errors.catch(() => {});
    throw error;
  }
}

const findings = [];
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
for (const file of tracked) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { continue; }
  for (const [type, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push({ scope: 'CURRENT', type, location: file });
  }
}

for (const forbidden of ['config.local.json', '.env', 'connections.local.json']) {
  if (tracked.includes(forbidden)) findings.push({ scope: 'CURRENT', type: 'Forbidden tracked file', location: forbidden });
}
for (const expectedIgnored of ['config.local.json', '.env', 'connections.local.json', 'credentials/example.dpapi', 'downloads/example.zip']) {
  const ignored = spawnSync('git', ['check-ignore', '-q', '--', expectedIgnored]);
  if (ignored.status !== 0) findings.push({ scope: 'CURRENT', type: 'Expected ignore missing', location: expectedIgnored });
}

const historyScan = await scanCompleteHistory();
for (const type of historyScan.hits) {
  findings.push({ scope: 'HISTORY', type, location: 'git log --all -p' });
}

const safeFixtureProbe = makeHistoryScanner(patterns);
safeFixtureProbe.write('commit ' + knownSyntheticTlsFixture.commit + '\n');
safeFixtureProbe.write('diff --git a/' + knownSyntheticTlsFixture.path +
  ' b/' + knownSyntheticTlsFixture.path + '\n');
for (const fixtureLine of knownSyntheticFixtureLines) safeFixtureProbe.write(fixtureLine + '\n');
const approvedFixture = safeFixtureProbe.finish();
if (approvedFixture.hits.has('Private key block') || approvedFixture.exceptions !== 2) {
  throw new Error('SECURITY_AUDIT_KNOWN_FIXTURE_REGRESSION');
}
// Audit exemptions must be bound to the immutable host test commit, file and
// exact invalid test literals. Any changed payload or foreign context still fails.
const hostFixtureProbe = makeHistoryScanner(patterns);
hostFixtureProbe.write('commit ' + knownSyntheticHostFixture.commit + '\n');
hostFixtureProbe.write('diff --git a/' + knownSyntheticHostFixture.path +
  ' b/' + knownSyntheticHostFixture.path + '\n');
for (const fixtureLine of knownSyntheticHostFixtureLines) hostFixtureProbe.write(fixtureLine + '\n');
const approvedHostFixture = hostFixtureProbe.finish();
if (approvedHostFixture.hits.has('Private key block') ||
    approvedHostFixture.exceptions !== 2) {
  throw new Error('SECURITY_AUDIT_KNOWN_HOST_FIXTURE_REGRESSION');
}
for (const [commit, file] of [
  ['0'.repeat(40), knownSyntheticHostFixture.path],
  [knownSyntheticHostFixture.commit, knownSyntheticTlsFixture.path]
]) {
  const mismatched = makeHistoryScanner(patterns);
  mismatched.write('commit ' + commit + '\n');
  mismatched.write('diff --git a/' + file + ' b/' + file + '\n');
  mismatched.write([...knownSyntheticHostFixtureLines][0] + '\n');
  if (!mismatched.finish().hits.has('Private key block')) {
    throw new Error('SECURITY_AUDIT_HOST_SCOPE_MUST_FAIL');
  }
}
const forgedHostPayload = makeHistoryScanner(patterns);
forgedHostPayload.write('commit ' + knownSyntheticHostFixture.commit + '\n');
forgedHostPayload.write('diff --git a/' + knownSyntheticHostFixture.path +
  ' b/' + knownSyntheticHostFixture.path + '\n');
forgedHostPayload.write([...knownSyntheticHostFixtureLines][0].replace('synthetic-host-private-key', 'real-sensitive-key') + '\n');
if (!forgedHostPayload.finish().hits.has('Private key block')) {
  throw new Error('SECURITY_AUDIT_HOST_PAYLOAD_MUST_FAIL');
}

// No path-wide or commit-wide exception: unknown values must still fail
// even when planted beside an otherwise approved historical line.
const scopedUnexpectedProbe=makeHistoryScanner(patterns);
scopedUnexpectedProbe.write('commit e178bf9b4b4daa6bc2916c106d02b2ac8cf2fa91\n');
scopedUnexpectedProbe.write('diff --git a/tools/probe-owner-pair-mtls.mjs b/tools/probe-owner-pair-mtls.mjs\n');
scopedUnexpectedProbe.write('+  ' + 'tunnel' + '_' + 'f'.repeat(32) + '\n');
scopedUnexpectedProbe.write('+  ' + 'Bearer ' + 'Z'.repeat(32) + '\n');
scopedUnexpectedProbe.write('+  ' + syntheticPemHeader + '\n');
const unexpectedHits=scopedUnexpectedProbe.finish();
if (!unexpectedHits.hits.has('Tunnel identifier') ||
    !unexpectedHits.hits.has('Bearer token literal') ||
    !unexpectedHits.hits.has('Private key block') ||
    unexpectedHits.exceptions!==0)
  throw Error('SECURITY_AUDIT_SCOPED_HISTORY_ALLOWLIST_MUST_FAIL_CLOSED');

const wrongCommitProbe = makeHistoryScanner(patterns);
wrongCommitProbe.write('commit ' + '0'.repeat(40) + '\n');
wrongCommitProbe.write('diff --git a/' + knownSyntheticTlsFixture.path +
  ' b/' + knownSyntheticTlsFixture.path + '\n');
wrongCommitProbe.write([...knownSyntheticFixtureLines][0] + '\n');
if (!wrongCommitProbe.finish().hits.has('Private key block')) {
  throw new Error('SECURITY_AUDIT_UNKNOWN_COMMIT_MUST_FAIL');
}
const realKeyProbe = makeHistoryScanner(patterns);
realKeyProbe.write('commit ' + knownSyntheticTlsFixture.commit + '\n');
realKeyProbe.write('diff --git a/' + knownSyntheticTlsFixture.path +
  ' b/' + knownSyntheticTlsFixture.path + '\n');
realKeyProbe.write('+  privateKeyPem:\'' + syntheticPemHeader + 'REAL_KEY_CONTENT' + '\n');
if (!realKeyProbe.finish().hits.has('Private key block')) {
  throw new Error('SECURITY_AUDIT_REAL_KEY_MUST_FAIL');
}

console.log('SECURITY_AUDIT_HISTORY_BYTES ' + historyScan.bytes);
console.log('SECURITY_AUDIT_EXACT_SYNTHETIC_FIXTURE_EXCEPTIONS ' + historyScan.exceptions);
const emails = [...new Set(git(['log', '--all', '--format=%ae%n%ce']).split(/\r?\n/).filter(Boolean))].sort();
if (emails.length) {
  console.log('COMMIT_EMAILS (public metadata, not credentials):');
  for (const email of emails) console.log(`  ${email}`);
}

if (findings.length) {
  console.error('SECURITY_AUDIT_FAIL');
  for (const finding of findings) console.error(JSON.stringify(finding));
  process.exit(1);
}
console.log('SECURITY_AUDIT_PASS');
console.log('No secret-key, tunnel-id, private-key, bearer-token, GitHub-token, tracked local-config, or developer-path finding detected.');
