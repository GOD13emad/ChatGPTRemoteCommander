import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

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
// A separate V2 test branch contains two known *invalid* PEM header strings
// with no matching key footer or encoded key. Their exact immutable source
// lines were inspected without printing any potential credentials.
// Only these 2 exact added diff lines at this exact Git commit/path are exempt;
// all other key headers, including other lines in the same file, remain findings.
const KNOWN_INVALID_PEM_FIXTURE = Object.freeze({
  commit: 'd890bd978b07aa738ceeef97bd6af2782538bac1',
  path: 'test/v2-mcp-http-ingress.test.mjs',
  fingerprints: new Set(['c5a00fec5ba8ec5e','642666ec0adf94ef'])
});
function lineFingerprint(line) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(line, 'utf8')) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16,'0');
}
function knownInvalidPemFixture(type, line, commit, file) {
  return type === 'Private key block' &&
    commit === KNOWN_INVALID_PEM_FIXTURE.commit &&
    file === KNOWN_INVALID_PEM_FIXTURE.path &&
    line.startsWith('+  privateKeyPem:') &&
    KNOWN_INVALID_PEM_FIXTURE.fingerprints.has(lineFingerprint(line));
}

// Scan complete Git history without buffering the entire potentially multi-GB patch.
// Lines are bounded; anything above the bound fails closed instead of being skipped.
function makeHistoryScanner(rules) {
  const hits = new Set();
  let pending = '', preceding = '', currentCommit = '', currentFile = '';
  const limit = 16 * 1024 * 1024;
  function scanLine(line) {
    if (/^commit [a-f0-9]{40}(?:\\r?\\n)?$/.test(line)) {
      currentCommit = line.slice(7,47);
      currentFile = '';
    } else if (line.startsWith('diff --git a/')) {
      const marker = line.indexOf(' b/');
      currentFile = marker >= 0 ? line.slice(marker+3).trim() : '';
    }
    const sample = preceding + line;
    for (const [name, pattern] of rules) {
      pattern.lastIndex = 0;
      if (pattern.test(sample) && !knownInvalidPemFixture(name, line, currentCommit, currentFile)) hits.add(name);
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
      return hits;
    }
  };
}
// In-memory negative controls: arbitrary key headers are still rejected.
const privateKeyMarker = '-----BEGIN ' + 'PRIVATE KEY-----';
const fakeLine = "+  privateKeyPem:'" + privateKeyMarker + "'\n";
const negativeScanner = makeHistoryScanner(patterns);
negativeScanner.write('commit ' + 'f'.repeat(40) + '\n');
negativeScanner.write('diff --git a/test/other.test.mjs b/test/other.test.mjs\n');
negativeScanner.write(fakeLine);
if (!negativeScanner.finish().has('Private key block')) {
  throw new Error('SECURITY_AUDIT_PRIVATE_KEY_NEGATIVE_CONTROL_FAILED');
}
if (knownInvalidPemFixture('Private key block', fakeLine,
    KNOWN_INVALID_PEM_FIXTURE.commit, KNOWN_INVALID_PEM_FIXTURE.path)) {
  throw new Error('SECURITY_AUDIT_FIXTURE_EXEMPTION_TOO_BROAD');
}

const boundaryProbe = makeHistoryScanner(patterns);
boundaryProbe.write('tunnel' + '_0123456789abcdef');
boundaryProbe.write('0123456789abcdef\nBearer \n');
boundaryProbe.write('A'.repeat(25) + '\n');
const probed = boundaryProbe.finish();
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
    return { hits: scanner.finish(), bytes };
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
console.log('SECURITY_AUDIT_HISTORY_BYTES ' + historyScan.bytes);
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
