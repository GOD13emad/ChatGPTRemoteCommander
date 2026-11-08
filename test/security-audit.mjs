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
  ['Private key block', new RegExp('-----BEGIN ' + '(RSA |EC |OPENSSH |DSA |ENCRYPTED )?' + 'PRIVATE KEY-----\\r?\\n' + '(?:(?:Proc-Type:|DEK-Info:)[^\\r\\n]*\\r?\\n)*' + '(?:[A-Za-z0-9+/=]{8,}\\r?\\n){2,}' + '-----END \\1PRIVATE KEY-----', 'im')],
  ['Bearer token literal', new RegExp('Bearer\\s+' + '[A-Za-z0-9._-]{20,}', 'i')],
  ['GitHub token', new RegExp('gh' + '[pousr]_' + '[A-Za-z0-9]{20,}', 'i')],
  ['Developer Windows path', /C:\\Users\\[^\\\r\n]+\\source\\repos\\ChatGPTRemoteCommander/i]
];
const tunnelPattern = patterns.find(([type]) => type === 'Tunnel identifier')[1];
if (!tunnelPattern.test('tunnel' + '_' + '0123456789abcdef'.repeat(2)) || tunnelPattern.test('tunnel_control_plane_fresh') || tunnelPattern.test('TUNNEL_HEALTH_UNKNOWN_LISTENER')) {
  throw new Error('Tunnel identifier audit pattern regression');
}
function makeHistoryScanner(rules) {
  const hits = new Set();
  let pending = '', preceding = '', pem = null;
  const limit = 16 * 1024 * 1024;
  const newline = String.fromCharCode(10);
  function scanPrivateKeyLine(line) {
    const raw = line.trimEnd();
    const side = raw[0];
    if (!['+', '-', ' '].includes(side)) { pem = null; return; }
    const content = raw.slice(1).trim();
    const header = content.match(/^-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----$/i);
    if (header) { pem = { side, label: header[1] ?? '', bodyChars: 0 }; return; }
    if (!pem || pem.side !== side) { pem = null; return; }
    const footer = content.match(/^-----END (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----$/i);
    if (footer) {
      if ((footer[1] ?? '') === pem.label && pem.bodyChars >= 32) hits.add('Private key block');
      pem = null;
      return;
    }
    if (/^[A-Za-z0-9+/=]{8,}$/.test(content)) { pem.bodyChars += content.length; return; }
    if (pem.bodyChars === 0 && /^(?:Proc-Type:|DEK-Info:)/i.test(content)) return;
    pem = null;
  }
  function scanLine(line) {
    scanPrivateKeyLine(line);
    const sample = preceding + line;
    for (const [name, pattern] of rules) {
      if (name === 'Private key block') continue;
      pattern.lastIndex = 0;
      if (pattern.test(sample)) hits.add(name);
    }
    preceding = sample.slice(-512);
  }
  return {
    write(text) {
      pending += text;
      for (;;) {
        const at = pending.indexOf(newline);
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
// A PEM header literal is common in parsers and negative fixtures; only a
// complete, well-formed BEGIN/body/END block is a private-key finding.
const newline = String.fromCharCode(10);
const privateKeyMarker = '-----BEGIN ' + 'PRIVATE KEY-----';
const currentTreePrivateKeyPattern = patterns.find(([type]) => type === 'Private key block')[1];
const syntheticPemBody = [
  'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
  'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='
];
function makeSyntheticPem(label, footerLabel = label, bodyLines = syntheticPemBody, lineEnding = newline) {
  return '-----BEGIN ' + label + 'PRIVATE KEY-----' + lineEnding +
    bodyLines.join(lineEnding) + lineEnding +
    '-----END ' + footerLabel + 'PRIVATE KEY-----';
}
for (const label of ['', 'RSA ', 'EC ', 'OPENSSH ', 'DSA ', 'ENCRYPTED ']) {
  currentTreePrivateKeyPattern.lastIndex = 0;
  if (!currentTreePrivateKeyPattern.test(makeSyntheticPem(label))) {
    throw new Error('SECURITY_AUDIT_CURRENT_TREE_PEM_POSITIVE_CONTROL_FAILED:' + (label || 'PRIVATE'));
  }
}
const currentTreeNegativeControls = [
  privateKeyMarker,
  makeSyntheticPem('', 'RSA '),
  makeSyntheticPem('', '', ['!!!!!!!!!!', '!!!!!!!!!!'])
];
for (let index = 0; index < currentTreeNegativeControls.length; index++) {
  currentTreePrivateKeyPattern.lastIndex = 0;
  if (currentTreePrivateKeyPattern.test(currentTreeNegativeControls[index])) {
    throw new Error('SECURITY_AUDIT_CURRENT_TREE_PEM_NEGATIVE_CONTROL_FAILED:' + index);
  }
}
currentTreePrivateKeyPattern.lastIndex = 0;
if (!currentTreePrivateKeyPattern.test(makeSyntheticPem('OPENSSH ', 'OPENSSH ', syntheticPemBody, '\r\n'))) {
  throw new Error('SECURITY_AUDIT_CURRENT_TREE_PEM_CRLF_CONTROL_FAILED');
}

const markerOnlyProbe = makeHistoryScanner(patterns);
markerOnlyProbe.write('commit ' + 'f'.repeat(40) + newline);
markerOnlyProbe.write('diff --git a/vendor/jose/import.js b/vendor/jose/import.js' + newline);
markerOnlyProbe.write("+const marker = '" + privateKeyMarker + "';" + newline);
if (markerOnlyProbe.finish().has('Private key block')) {
  throw new Error('SECURITY_AUDIT_PRIVATE_KEY_MARKER_FALSE_POSITIVE');
}
const fakeBlock = [
  '+-----BEGIN PRIVATE KEY-----',
  '+QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
  '+QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
  '+-----END PRIVATE KEY-----'
].join(newline) + newline;
const negativeScanner = makeHistoryScanner(patterns);
negativeScanner.write('commit ' + 'f'.repeat(40) + newline);
negativeScanner.write('diff --git a/test/other.test.mjs b/test/other.test.mjs' + newline);
negativeScanner.write(fakeBlock);
if (!negativeScanner.finish().has('Private key block')) {
  throw new Error('SECURITY_AUDIT_PRIVATE_KEY_NEGATIVE_CONTROL_FAILED');
}

for (const decorated of [false,true]) {
  const probe = makeHistoryScanner(patterns);
  probe.write('commit ' + 'f'.repeat(40) +
    (decorated ? ' (HEAD -> a-feature)' + newline : newline));
  probe.write('diff --git a/test/other.test.mjs b/test/other.test.mjs' + newline);
  probe.write(fakeBlock);
  if (!probe.finish().has('Private key block')) {
    throw new Error('SECURITY_AUDIT_DECORATED_COMMIT_NEGATIVE_CONTROL_FAILED');
  }
}

const boundaryProbe = makeHistoryScanner(patterns);
boundaryProbe.write('tunnel' + '_0123456789abcdef');
boundaryProbe.write('0123456789abcdef' + newline + 'Bearer ' + newline);
boundaryProbe.write('A'.repeat(25) + newline);
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
