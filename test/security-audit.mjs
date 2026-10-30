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
// Scan complete Git history without buffering the entire potentially multi-GB patch.
// Lines are bounded; anything above the bound fails closed instead of being skipped.
function makeHistoryScanner(rules) {
  const hits = new Set();
  let pending = '', preceding = '', patchPath = '';
  const limit = 16 * 1024 * 1024;
  const inertFixtureFile = 'test/v2-mcp-http-ingress.test.mjs';
  const inertFixturePrefix = "privateKeyPem:'" + '-----BEGIN ' + 'PRIVATE KEY-----' + String.raw`\\nfixture'`;
  function scanLine(line) {
    if (line.startsWith('diff --git a/')) {
      patchPath = line.slice('diff --git a/'.length).split(' b/')[0];
    }
    // Match only the exact inert test literals, never a real or truncated PEM.
    if (patchPath === inertFixtureFile && /^[+-]/.test(line)) {
      const fragment = line.slice(1).trim();
      if (fragment === inertFixturePrefix + ',' || fragment === inertFixturePrefix + '});') {
        line = line.replace('-----BEGIN ' + 'PRIVATE KEY-----', '[INERT TEST FIXTURE]');
      }
    }
    const sample = preceding + line;
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
      return hits;
    }
  };
}
const syntheticFile = 'test/v2-mcp-http-ingress.test.mjs';
const inertHeader = '-----BEGIN ' + 'PRIVATE KEY-----';
const inertValue = "privateKeyPem:'" + inertHeader + String.raw`\\nfixture'`;
const fake = makeHistoryScanner(patterns);
fake.write('diff --git a/' + syntheticFile + ' b/' + syntheticFile + '\n');
fake.write('+   ' + inertValue + ',\n');
fake.write('+   ' + inertValue + '});\n');
if (fake.finish().has('Private key block')) {
  throw new Error('SECURITY_AUDIT_SYNTHETIC_FIXTURE_FALSE_POSITIVE');
}
for (const testPath of ['src/untrusted.mjs', syntheticFile]) {
  const leaked = makeHistoryScanner(patterns);
  leaked.write('diff --git a/' + testPath + ' b/' + testPath + '\n');
  leaked.write('+  privateKeyPem: "' + inertHeader + '\n');
  leaked.write('+  MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n');
  leaked.write('+  -----END ' + 'PRIVATE KEY-----";\n');
  if (!leaked.finish().has('Private key block')) {
    throw new Error('SECURITY_AUDIT_REAL_PEM_DETECTION_REGRESSION');
  }
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
