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

// Reject every real private-key marker, except this precisely known V2 test
// placeholder (a JavaScript string containing the literal backslash-n and
// the word "fixture"; it is not a PEM or a credential). This exception applies
// to individual marker occurrences, including those in git history. It must
// never suppress a separate PEM marker anywhere in the same file or commit.
const mockPemHeader = '-----BEGIN ' + 'PRIVATE KEY-----';
const mockPemLiteral = mockPemHeader + String.raw`\\nfixture`;
// This fixed human-readable mock is present in an immutable V2 test commit.
// Never allowlist variable tokens, suffixes or other Bearer values.
const mockBearerLiteral = 'Bearer ' + 'verified-' + 'test-bearer';
// Earlier committed V2 capability-gap test used a fixed synthetic bearer-looking
// string. Preserve immutable Git provenance while excluding *only* that exact
// generated fixture, never arbitrary credentials, suffixes or adjacent tokens.
const mockGapTestBearerLiteral = 'Bearer ' + 'dummy-' + 'super-' + 'secret-12345';

// Thirteen exact, historically committed source-code *literals*, not PEM payloads.
// Independently reviewed: synthetic non-base64 test values, scanner fixtures and
// a vendor PKCS8 header comparison. Pin commit, Git path AND whole diff line.
// Never suppress a modified line, another commit/file or a second marker.
const HISTORY_NONKEY_SOURCE_LINE_PINS=new Set([
 // One known whole-source aggregation commit repeats the exact previously vetted non-key lines.
 // Do not generalize this to other commits, files or modified lines.
 "eea2acb9b1c24e6417692b0cac23f32a5298e271|test/security-audit.mjs|6ddf937084740cde5222705897656ac2c41fdc84e77f6baec6533668e4a3e029",
 "eea2acb9b1c24e6417692b0cac23f32a5298e271|test/v101-linux-v2-candidate-host.test.mjs|7cebd60574fa2d40fdf124f8fdc3814daae2067f40f26e3f905d1d5281f6e6fc",
 "eea2acb9b1c24e6417692b0cac23f32a5298e271|test/v101-linux-v2-candidate-host.test.mjs|fa4687719919ae2be8e863786f86d72e619add8ee647cc85e08c7799fd373586",
 "eea2acb9b1c24e6417692b0cac23f32a5298e271|vendor/jose/dist/webapi/key/import.js|ab506fa93dea915497ad0dec31c667a6802c4335f56c80bb55dfc3f11e5c5959",
 "f31392c127e682762988b5bee70164752208b176|test/v101-linux-v2-candidate-host.test.mjs|7cebd60574fa2d40fdf124f8fdc3814daae2067f40f26e3f905d1d5281f6e6fc",
 "f31392c127e682762988b5bee70164752208b176|test/v101-linux-v2-candidate-host.test.mjs|fa4687719919ae2be8e863786f86d72e619add8ee647cc85e08c7799fd373586",
 "07ce35da16a63b6d77883671320bccfb5b97c398|test/security-audit.mjs|6ddf937084740cde5222705897656ac2c41fdc84e77f6baec6533668e4a3e029",
 "0bd13b5c443171e2829d84358a82c8af09f60c1d|test/security-audit.mjs|6ddf937084740cde5222705897656ac2c41fdc84e77f6baec6533668e4a3e029",
 "0bd13b5c443171e2829d84358a82c8af09f60c1d|test/security-audit.mjs|ea3616cd33653fb14a2ed2b2de2a2eabb97b0ffc6bd588cfb69363a4bb4dec7a",
 "c4978731c897a755f55b8610fc58be0497a636c4|test/security-audit.mjs|6cb159b32535fb8bf9e4416ac8d24b52e0f7353b7b3ef15a4797d5019117a794",
 "594e79ff16c66c770446a0a27f38bf1d6bb59191|vendor/jose/dist/webapi/key/import.js|ab506fa93dea915497ad0dec31c667a6802c4335f56c80bb55dfc3f11e5c5959",
 "6e83e5b1c807b1b7dcbb6a56aa56f2966e984d8b|test/v2-mcp-http-ingress.test.mjs|c49aa9b0b75874639e877d5e93309645d7a707cfa424e7bc21625f44b666dcd1",
 "6e83e5b1c807b1b7dcbb6a56aa56f2966e984d8b|test/v2-mcp-http-ingress.test.mjs|9f84d8855fd0961d29ec6543bcae795c8fb36816ac68102dd029424068a450a1",
]);

// Only exact reviewed, whole-diff-line history instances. Never suppress a
// different source line, commit, file, actual standalone key or live tunnel.
const HISTORY_NONKEY_TASK_FRAGMENT_PINS=new Set([
 'facd1048a264ebac9ee81f92d5de0115d6638218|integrations/saeid-r80-local-owner-enrollment/source-k-e/staged-finalization-j/PARENT_CONTRACT_B.json|dea43762dfb3563f5e5587d972fada41a0f15381bff676533363a422a71a5fdf',
 'cfaaf8add1ad98198c256dbcb21787bd876b6da8|integrations/saeid-r80-local-owner-enrollment/source-i/bootstrap/G_HANDOFF.md|28820993672e583e8f9cedd295f6333e61e7e17a2d7230cadad9d71b2640c1e1',
 'cfaaf8add1ad98198c256dbcb21787bd876b6da8|integrations/saeid-r80-local-owner-enrollment/source-i/bootstrap/HANDOFF.md|6911b7dfd9204267bd4680baafdf10532a06fef33b6929f0f20ac3b9c2f72846',
 'cfaaf8add1ad98198c256dbcb21787bd876b6da8|integrations/saeid-r80-local-owner-enrollment/source-i/bootstrap/H_HANDOFF.md|6911b7dfd9204267bd4680baafdf10532a06fef33b6929f0f20ac3b9c2f72846',
 'cfaaf8add1ad98198c256dbcb21787bd876b6da8|integrations/saeid-r80-local-owner-enrollment/source-i/evidence/TASK_XML_IN_MEMORY_COM_RECEIPT.json|2475a900da7578546909117d756404bb1f1ba1c00ef4db7d914c8d0fa3f094dd',
 'cfaaf8add1ad98198c256dbcb21787bd876b6da8|integrations/saeid-r80-local-owner-enrollment/source-i/reviews/independent/PRIMARY_CONTRACTS.md|31ef82a5a72cf36762ff45540ec49c458af7d5eaadbd1a2b58c254c5d66bdd9a',
]);
const HISTORY_NONKEY_TUNNEL_LITERAL_PINS=new Set([
 'e178bf9b4b4daa6bc2916c106d02b2ac8cf2fa91|tools/probe-owner-pair-mtls.mjs|325978daa233c1300ade15a78ef4b8e7b6507235c9f6669655a0e07e35260652',
 '633acfa7d5251538bea86e9e2464820c37de50f8|tools/probe-owner-pair-mtls.mjs|95c52ff96644caf6a63d1c8204fa8be953138f5d2d274fc4c7b006f07d57c93c',
]);

const PEM_HEADER_HISTORICAL='-----BEGIN '+'PRIVATE KEY-----';

function secretPatternMatches(type,pattern,text) {
  let sample=text;
  if(type==='Private key block')
    sample=sample.replaceAll(mockPemLiteral,'[MOCK_V2_TLS_KEY_PLACEHOLDER]');
  if(type==='Bearer token literal')
    sample=sample.replaceAll(
      new RegExp(mockBearerLiteral+'(?![A-Za-z0-9._-])','g'),
      '[MOCK_V2_BEARER_FIXTURE]');
  if(type==='Bearer token literal')
    sample=sample.replaceAll(
      new RegExp(mockGapTestBearerLiteral+'(?![A-Za-z0-9._-])','g'),
      '[MOCK_V2_GAP_TEST_BEARER_FIXTURE]');
  pattern.lastIndex=0;
  return pattern.test(sample);
}
const bearerPattern=patterns.find(([type])=>type==='Bearer token literal')[1];
if(secretPatternMatches('Bearer token literal',bearerPattern,mockBearerLiteral)||
   !secretPatternMatches('Bearer token literal',bearerPattern,mockBearerLiteral+'-different')||
   !secretPatternMatches('Bearer token literal',bearerPattern,'Bearer '+'Z'.repeat(25))||
   !secretPatternMatches('Bearer token literal',bearerPattern,mockBearerLiteral+' '+'Bearer '+'Z'.repeat(25)))
  throw new Error('Mock bearer token exception regression');
if(secretPatternMatches('Bearer token literal',bearerPattern,mockGapTestBearerLiteral)||
  !secretPatternMatches('Bearer token literal',bearerPattern,mockGapTestBearerLiteral+'-other')||
  !secretPatternMatches('Bearer token literal',bearerPattern,mockGapTestBearerLiteral+' '+'Bearer '+'Z'.repeat(25)))
  throw new Error('Gap test mock bearer exception regression');
const pemHeaderPattern=patterns.find(([type])=>type==='Private key block')[1];
if(secretPatternMatches('Private key block',pemHeaderPattern,mockPemLiteral)
  ||!secretPatternMatches('Private key block',pemHeaderPattern,mockPemHeader+'\\nACTUAL-KEY')
  ||!secretPatternMatches('Private key block',pemHeaderPattern,mockPemLiteral+' '+'-----BEGIN '+'PRIVATE KEY-----'))
  throw new Error('Private-key pattern exception regression');

const tunnelPattern = patterns.find(([type]) => type === 'Tunnel identifier')[1];
if (!tunnelPattern.test('tunnel' + '_' + '0123456789abcdef'.repeat(2)) || tunnelPattern.test('tunnel_control_plane_fresh') || tunnelPattern.test('TUNNEL_HEALTH_UNKNOWN_LISTENER')) {
  throw new Error('Tunnel identifier audit pattern regression');
}
// Scan complete Git history without buffering the entire potentially multi-GB patch.
// Lines are bounded; anything above the bound fails closed instead of being skipped.
function makeHistoryScanner(rules,historyContext=false) {
  const hits = new Set();
  let pending = '', preceding = '', commit = '', file = '';
  const limit = 16 * 1024 * 1024;
  function scanLine(line) {
    if(historyContext) {
      const cm=/^commit ([a-f0-9]{40})\r?\n?$/.exec(line);
      if(cm){commit=cm[1];file='';}
      const fm=/^diff --git a\/[^\n]+ b\/([^\n]+)\r?\n?$/.exec(line);
      if(fm)file=fm[1].replace(/\r$/,'');
      if(line.includes(PEM_HEADER_HISTORICAL)){
        const digest=createHash('sha256').update(line).digest('hex');
        if(HISTORY_NONKEY_SOURCE_LINE_PINS.has(commit+'|'+file+'|'+digest))
          line=line.replaceAll(PEM_HEADER_HISTORICAL,'[KNOWN_NONKEY_SOURCE_LITERAL]');
      }
      // A scanner expression can find 'sk-' inside a longer *task-* identifier.
      // Only the six exact reviewed history lines may suppress this fragment.
      if(line.includes('sk-')){
        const digest=createHash('sha256').update(line).digest('hex');
        if(HISTORY_NONKEY_TASK_FRAGMENT_PINS.has(commit+'|'+file+'|'+digest)){
          const fragments=[...line.matchAll(new RegExp('s'+'k-'+'[A-Za-z0-9_-]{20,}','gi'))];
          if(fragments.length!==1 ||
            line.slice(fragments[0].index-2,fragments[0].index)!=='ta')
            throw new Error('SECURITY_AUDIT_TASK_PIN_SHAPE_DRIFT');
          const frag=fragments[0];
          line=line.slice(0,frag.index)+'[KNOWN_TASK_IDENTIFIER_FRAGMENT]'+
            line.slice(frag.index+frag[0].length);
        }
      }
      // The two exact source lines each carry only a fixed synthetic hex ID.
      // No other tunnel marker is excluded, even in the same commit/file.
      if(line.includes('tunnel_')){
        const digest=createHash('sha256').update(line).digest('hex');
        if(HISTORY_NONKEY_TUNNEL_LITERAL_PINS.has(commit+'|'+file+'|'+digest)){
          const marker='tunnel_'+'0123456789abcdef'.repeat(2);
          const fragments=[...line.matchAll(/tunnel_[0-9a-f]{32}/g)];
          if(fragments.length!==1 || fragments[0][0]!==marker)
            throw new Error('SECURITY_AUDIT_TUNNEL_PIN_SHAPE_DRIFT');
          line=line.replace(marker,'[KNOWN_SYNTHETIC_TUNNEL_LITERAL]');
        }
      }
    }
    const sample = preceding + line;
    for (const [name, pattern] of rules) {
      if (secretPatternMatches(name,pattern,sample)) hits.add(name);
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
// Reuse of any pinned source line outside its exact patch context still flags.
const hostileHistoryProbe=makeHistoryScanner(patterns,true);
hostileHistoryProbe.write('commit '+'f31392c127e682762988b5bee70164752208b176'+'\n');
hostileHistoryProbe.write('diff --git a/test/unrelated.mjs b/test/unrelated.mjs\\n');
hostileHistoryProbe.write('+  privateKeyPem:\''+PEM_HEADER_HISTORICAL+'\nACTUAL-KEY\n');
if(!hostileHistoryProbe.finish().has('Private key block'))
  throw new Error('HISTORY_NONKEY_SOURCE_PIN_SCOPE_REGRESSION');
// Even an allowlisted aggregation commit must not mask a newly introduced PEM
// marker in a different path or changed line. Never suppress by commit alone.
const aggregationHostileProbe=makeHistoryScanner(patterns,true);
aggregationHostileProbe.write('commit '+'eea2acb9b1c24e6417692b0cac23f32a5298e271'+'\n');
aggregationHostileProbe.write('diff --git a/test/forged-review.mjs b/test/forged-review.mjs\n');
aggregationHostileProbe.write('+  const privateKey = \''+PEM_HEADER_HISTORICAL+'\';\n');
if(!aggregationHostileProbe.finish().has('Private key block'))
  throw new Error('HISTORY_SOURCE_AGGREGATION_PIN_SCOPE_REGRESSION');
// Adversarial regression: identical pinned commit and path, *changed line*
// with a standalone key or different tunnel ID must still fail.
const taskIdChangedProbe=makeHistoryScanner(patterns,true);
taskIdChangedProbe.write('commit '+'facd1048a264ebac9ee81f92d5de0115d6638218'+'\n');
taskIdChangedProbe.write('diff --git a/integrations/saeid-r80-local-owner-enrollment/source-k-e/staged-finalization-j/PARENT_CONTRACT_B.json b/integrations/saeid-r80-local-owner-enrollment/source-k-e/staged-finalization-j/PARENT_CONTRACT_B.json\n');
taskIdChangedProbe.write('+'+'task-'+ 'A'.repeat(27)+' '+'sk-'+'B'.repeat(28)+'\n');
if(!taskIdChangedProbe.finish().has('OpenAI-style secret key'))
  throw new Error('SECURITY_AUDIT_TASK_PIN_CHANGED_LINE_BYPASS');
const tunnelIdChangedProbe=makeHistoryScanner(patterns,true);
tunnelIdChangedProbe.write('commit '+'633acfa7d5251538bea86e9e2464820c37de50f8'+'\n');
tunnelIdChangedProbe.write('diff --git a/tools/probe-owner-pair-mtls.mjs b/tools/probe-owner-pair-mtls.mjs\n');
tunnelIdChangedProbe.write('+'+'tunnel_'+'f'.repeat(32)+'\n');
if(!tunnelIdChangedProbe.finish().has('Tunnel identifier'))
  throw new Error('SECURITY_AUDIT_TUNNEL_PIN_CHANGED_LINE_BYPASS');
const sameCommitWrongFileProbe=makeHistoryScanner(patterns,true);
sameCommitWrongFileProbe.write('commit '+'633acfa7d5251538bea86e9e2464820c37de50f8'+'\n');
sameCommitWrongFileProbe.write('diff --git a/test/other.mjs b/test/other.mjs\n');
sameCommitWrongFileProbe.write('+'+'tunnel_'+'0123456789abcdef'.repeat(2)+'\n');
if(!sameCommitWrongFileProbe.finish().has('Tunnel identifier'))
  throw new Error('SECURITY_AUDIT_TUNNEL_PIN_WRONG_FILE_BYPASS');

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
  const scanner = makeHistoryScanner(patterns,true);
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
    if (secretPatternMatches(type,pattern,text))
      findings.push({ scope: 'CURRENT', type, location: file });
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
