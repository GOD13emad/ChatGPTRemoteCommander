import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builder = path.join(repo, 'tools', 'build-release-assets.ps1');
const pwsh = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh';
const canonicalRepository = 'https://github.com/GOD13emad/ChatGPTRemoteCommander';
const canonicalOrigin = `${canonicalRepository}.git`;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8', windowsHide: true, timeout: 120_000, ...options
  });
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function git(cwd, args) {
  return mustRun('git', args, { cwd });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function write(root, relative, data) {
  const target = path.join(root, relative);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, data);
}

function invokeBuilder(source, commit, output) {
  return run(pwsh, [
    '-NoLogo', '-NoProfile', '-File', builder,
    '-SourceRoot', source, '-ExpectedCommit', commit, '-OutputDirectory', output
  ], { cwd: repo });
}

function assertFailed(result, marker) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0, `builder unexpectedly passed\n${result.stdout}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(marker));
}

function assertNoStages(parent) {
  const leftovers = fs.readdirSync(parent).filter(name => name.startsWith('.release-assets-stage-'));
  assert.deepEqual(leftovers, [], `staging leftovers: ${leftovers.join(', ')}`);
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nSAAAAAASUVORK5CYII=',
  'base64'
);

test('release builder pins exact commit and emits a closed, hashed asset set', { timeout: 180_000 }, async () => {
  const contract = await fsp.readFile(builder, 'utf8');
  for (const marker of [
    'SOURCE_TREE_DIRTY', 'SOURCE_COMMIT_MISMATCH', 'INSTALL_PS1_PIN', 'INSTALL_SH_PIN',
    'INSTALL_PS1_EFFECTIVE_PIN_INVALID', 'INSTALL_SH_EFFECTIVE_PIN_INVALID',
    'CANONICAL_ORIGIN_MISMATCH', 'RELEASE_TAG_NOT_FOUND', 'PACKAGE_REPOSITORY_MISMATCH',
    'PLUGIN_IDENTITY_MISMATCH', 'INSTALL_PS1_DEFAULT_SOURCE_REF_INVALID', 'INSTALL_SH_DEFAULT_SOURCE_REF_INVALID',
    'POWERSHELL_PARSE_FAILED', 'BASH_PARSE_FAILED', 'ASSET_SET_MISSING', 'ASSET_SET_EXTRAS',
    'HASH_MANIFEST_MISMATCH', 'RELEASE_AUTHORITY_ASSET_SET_MISMATCH', 'PLUGIN_ZIP_HASH_MISMATCH',
    'PLUGIN_INSTALLER_EFFECTIVE_PIN_INVALID', 'PLUGIN_INSTALLER_LATEST_URL_REFUSED'
  ]) assert.ok(contract.includes(marker), `builder missing fail-closed marker ${marker}`);

  const parse = run(pwsh, ['-NoLogo', '-NoProfile', '-Command',
    `$e=$null;[Management.Automation.Language.Parser]::ParseFile('${builder.replaceAll("'", "''")}',[ref]$null,[ref]$e)>$null;if($e.Count){$e|% Message;exit 1}`
  ]);
  assert.equal(parse.status, 0, `${parse.stdout}\n${parse.stderr}`);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'remote-commander-release-assets-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  await fsp.mkdir(source, { recursive: true });
  try {
    await write(source, '.gitattributes', '*.sh text eol=lf\n*.ps1 text eol=lf\n*.json text eol=lf\n');
    await write(source, 'package.json', JSON.stringify({ name: 'chatgpt-remote-commander', version: '1.2.3', repository: canonicalRepository }, null, 2) + '\n');
    await write(source, 'install.ps1', "param([string]$SourceRef = 'v1.2.3',[string]$ExpectedCommit = '')\nWrite-Output 'fixture'\n");
    await write(source, 'install.sh', '#!/usr/bin/env bash\nset -euo pipefail\nSOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v1.2.3}"\nEXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"\nprintf "%s\\n" "$EXPECTED_COMMIT"\n');
    await write(source, 'install-work-plugin.ps1', await fsp.readFile(path.join(repo, 'install-work-plugin.ps1')));
    await write(source, 'install-work-plugin.sh', await fsp.readFile(path.join(repo, 'install-work-plugin.sh')));
    await write(source, 'START_HERE.md', '# Start\n');
    await write(source, 'WORK_SETUP.md', '# Work setup\n');
    await write(source, 'assets/plugin-icon.png', tinyPng);
    await write(source, 'assets/plugin-logo.png', tinyPng);
    await write(source, 'assets/plugin-icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\n');
    await write(source, 'plugin-template/plugin.json', JSON.stringify({ name: 'chatgpt-remote-commander', version: '1.2.3', repository: canonicalRepository, homepage: canonicalRepository }, null, 2) + '\n');
    await write(source, 'plugin-template/.app.json.example', '{"app_id":"fixture"}\n');
    await write(source, 'plugin-template/README.md', '# Plugin\n');
    await write(source, 'plugin-template/bind-app.ps1', "param()\nWrite-Output 'bind'\n");
    await write(source, 'plugin-template/bind-app.sh', '#!/usr/bin/env bash\nset -euo pipefail\nprintf "bind\\n"\n');
    await write(source, 'plugin-template/assets/icon.png', tinyPng);
    await write(source, 'plugin-template/assets/logo.png', tinyPng);
    await write(source, 'plugin-template/skills/remote-commander/SKILL.md', '# Skill\n');

    git(source, ['init']);
    git(source, ['config', 'user.name', 'Release Asset Test']);
    git(source, ['config', 'user.email', 'release-assets-test@users.noreply.github.com']);
    git(source, ['remote', 'add', 'origin', canonicalOrigin]);
    git(source, ['add', '.']);
    git(source, ['commit', '-m', 'fixture']);
    const commit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', 'v1.2.3']);
    assert.match(commit, /^[0-9a-f]{40}$/);

    const success = invokeBuilder(source, commit, output);
    assert.equal(success.error, undefined, success.error?.message);
    assert.equal(success.status, 0, `${success.stdout}\n${success.stderr}`);
    const result = JSON.parse(success.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(result.ok, true);
    assert.equal(result.commit, commit);
    assert.equal(result.version, '1.2.3');
    assert.equal(result.assetCount, 13);

    const expected = [
      'SHA256SUMS.txt', 'install-work-plugin.ps1', 'install-work-plugin.sh', 'install.ps1', 'install.sh',
      'plugin-icon.png', 'plugin-icon.svg', 'plugin-logo.png', 'plugin-template-v1.2.3.zip',
      'plugin-template.zip', 'release-authority.json', 'START_HERE.md', 'WORK_SETUP.md'
    ].sort((a, b) => a.localeCompare(b));
    const actual = fs.readdirSync(output).sort((a, b) => a.localeCompare(b));
    assert.deepEqual(actual, expected, 'release asset set must have no missing or extra files');
    assert.equal(new Set(actual.map(name => name.toLowerCase())).size, actual.length, 'asset names must be unique');

    const windowsInstaller = fs.readFileSync(path.join(output, 'install.ps1'), 'utf8');
    assert.equal(windowsInstaller.includes("[string]$ExpectedCommit = ''"), false);
    assert.equal((windowsInstaller.match(new RegExp(commit, 'g')) || []).length, 1);
    const linuxInstaller = fs.readFileSync(path.join(output, 'install.sh'), 'utf8');
    assert.equal(linuxInstaller.includes('EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"'), false);
    assert.equal(linuxInstaller.includes(`EXPECTED_COMMIT="\${REMOTE_COMMANDER_EXPECTED_COMMIT:-${commit}}"`), true);

    const manifestLines = fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
    assert.equal(manifestLines.length, 12, 'manifest covers every asset except itself');
    const manifest = new Map();
    for (const line of manifestLines) {
      const match = /^([0-9a-f]{64})  ([A-Za-z0-9._+-]+)$/.exec(line);
      assert.ok(match, `invalid manifest line: ${line}`);
      assert.equal(manifest.has(match[2].toLowerCase()), false, `duplicate manifest entry ${match[2]}`);
      manifest.set(match[2].toLowerCase(), match[1]);
      assert.equal(sha256(path.join(output, match[2])), match[1], `hash mismatch for ${match[2]}`);
    }
    assert.equal(manifest.has('sha256sums.txt'), false, 'manifest must explicitly exclude itself');
    for (const name of expected.filter(name => name !== 'SHA256SUMS.txt')) assert.ok(manifest.has(name.toLowerCase()), `manifest missing ${name}`);

    const authority = JSON.parse(fs.readFileSync(path.join(output, 'release-authority.json'), 'utf8'));
    assert.equal(authority.schema, 2);
    assert.equal(authority.repository, canonicalRepository);
    assert.equal(authority.tag, 'v1.2.3');
    assert.equal(authority.commit, commit);
    assert.match(authority.tree, /^[0-9a-f]{40}$/);
    assert.equal(authority.version, '1.2.3');
    assert.deepEqual(authority.installerDefaultPins.windows, { sourceRef: 'v1.2.3', expectedCommit: commit });
    assert.deepEqual(authority.installerDefaultPins.linux, { sourceRef: 'v1.2.3', expectedCommit: commit });
    assert.equal(authority.source.canonicalOrigin, canonicalOrigin);
    assert.equal(authority.source.tagPeeledToCommit, true);
    assert.equal(authority.reproducibility.crossRuntime, 'UNPROVEN');
    assert.equal(authority.pluginTemplate.releaseTag, 'v1.2.3');
    assert.equal(authority.assets.length, 11);
    assert.equal(new Set(authority.assets.map(item => item.name.toLowerCase())).size, authority.assets.length);
    for (const item of authority.assets) {
      assert.equal(item.sha256, sha256(path.join(output, item.name)));
      assert.equal(item.bytes, fs.statSync(path.join(output, item.name)).size);
    }
    assert.equal(sha256(path.join(output, 'plugin-template-v1.2.3.zip')), sha256(path.join(output, 'plugin-template.zip')));
    assert.equal(authority.pluginTemplate.sha256, sha256(path.join(output, 'plugin-template.zip')));
    assert.ok(Array.isArray(authority.pluginTemplate.files));

    for (const name of ['install-work-plugin.ps1', 'install-work-plugin.sh']) {
      const published = fs.readFileSync(path.join(output, name), 'utf8');
      assert.equal(published.includes('/releases/latest/download/plugin-template.zip'), false, `${name} must not use latest template`);
      assert.equal(published.includes('ChatGPTRemoteCommander/releases/download'), true);
      assert.equal(published.includes('v1.2.3'), true);
      assert.equal(published.includes(authority.pluginTemplate.sha256), true);
      assert.equal(published.includes('PLUGIN_TEMPLATE_SHA256_MISMATCH'), true);
      assert.equal(published.includes('PLUGIN_TEMPLATE_ENTRY_INVALID'), true);
      assert.equal(published.includes('PLUGIN_TEMPLATE_SET_MISMATCH'), true);
      assert.equal(published.includes('PLUGIN_TEMPLATE_ENTRY_HASH_MISMATCH'), true);
    }

    const extractedPlugin = path.join(root, 'plugin-extracted');
    const extract = run(pwsh, ['-NoLogo', '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${path.join(output, 'plugin-template.zip').replaceAll("'", "''")}' -DestinationPath '${extractedPlugin.replaceAll("'", "''")}'`
    ]);
    assert.equal(extract.status, 0, `${extract.stdout}\n${extract.stderr}`);
    assert.equal(fs.existsSync(path.join(extractedPlugin, '.app.json.example')), true, 'dot-prefixed plugin files must be packaged');
    assert.deepEqual(
      fs.readdirSync(path.join(extractedPlugin, 'assets')).sort(),
      ['icon.png', 'logo.png']
    );

    const maliciousZip = path.join(root, 'traversal.zip');
    const escapedMaliciousZip = maliciousZip.replaceAll("'", "''");
    const makeMaliciousZip = run(pwsh, ['-NoLogo', '-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem;$z=[IO.Compression.ZipFile]::Open('${escapedMaliciousZip}',[IO.Compression.ZipArchiveMode]::Create);try{$e=$z.CreateEntry('../escape.txt');$w=[IO.StreamWriter]::new($e.Open());try{$w.Write('escape')}finally{$w.Dispose()}}finally{$z.Dispose()}`
    ]);
    assert.equal(makeMaliciousZip.status, 0, `${makeMaliciousZip.stdout}\n${makeMaliciousZip.stderr}`);
    const maliciousData = Buffer.from('escape');
    const maliciousManifest = Buffer.from(JSON.stringify([{
      name: 'escape.txt', bytes: maliciousData.length,
      sha256: crypto.createHash('sha256').update(maliciousData).digest('hex')
    }])).toString('base64');
    const publishedPowerShell = fs.readFileSync(path.join(output, 'install-work-plugin.ps1'), 'utf8');
    const definitionsStart = publishedPowerShell.indexOf("$ErrorActionPreference = 'Stop'");
    const definitionsEnd = publishedPowerShell.indexOf('$ResolvedAppId =');
    assert.ok(definitionsStart >= 0 && definitionsEnd > definitionsStart, 'PowerShell validator definitions not found');
    const traversalDestination = path.join(root, 'traversal-output');
    const harness = path.join(root, 'validate-traversal.ps1');
    await fsp.writeFile(harness, `${publishedPowerShell.slice(definitionsStart, definitionsEnd)}\n` +
      `$PluginTemplateSha256='${sha256(maliciousZip)}'\n` +
      `$PluginTemplateManifestBase64='${maliciousManifest}'\n` +
      `New-Item -ItemType Directory -Path '${traversalDestination.replaceAll("'", "''")}' | Out-Null\n` +
      `try { Expand-VerifiedTemplateZip '${escapedMaliciousZip}' '${traversalDestination.replaceAll("'", "''")}'; throw 'TRAVERSAL_UNEXPECTED_PASS' } catch { if ($_.Exception.Message -notmatch 'PLUGIN_TEMPLATE_ENTRY_INVALID') { throw } }\n`);
    const traversal = run(pwsh, ['-NoLogo', '-NoProfile', '-File', harness]);
    assert.equal(traversal.status, 0, `${traversal.stdout}\n${traversal.stderr}`);
    assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false, 'traversal archive must not write outside destination');
    assertNoStages(root);

    const badCommitOutput = path.join(root, 'bad-commit-output');
    const wrongCommit = '0'.repeat(40) === commit ? '1'.repeat(40) : '0'.repeat(40);
    assertFailed(invokeBuilder(source, wrongCommit, badCommitOutput), 'SOURCE_COMMIT_MISMATCH');
    assert.equal(fs.existsSync(badCommitOutput), false);
    assertNoStages(root);

    await write(source, 'untracked.tmp', 'dirty\n');
    const dirtyOutput = path.join(root, 'dirty-output');
    assertFailed(invokeBuilder(source, commit, dirtyOutput), 'SOURCE_TREE_DIRTY');
    assert.equal(fs.existsSync(dirtyOutput), false);
    await fsp.rm(path.join(source, 'untracked.tmp'));
    assertNoStages(root);

    await write(source, 'install.ps1', "param([string]$SourceRef = 'v1.2.3',[string]$ExpectedCommit = '')\n# [string]$ExpectedCommit = ''\n");
    git(source, ['add', 'install.ps1']);
    git(source, ['commit', '-m', 'duplicate windows pin']);
    const duplicateWindowsCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const duplicateWindowsOutput = path.join(root, 'duplicate-windows-output');
    assertFailed(invokeBuilder(source, duplicateWindowsCommit, duplicateWindowsOutput), 'INSTALL_PS1_PIN_PLACEHOLDER_COUNT');
    assert.equal(fs.existsSync(duplicateWindowsOutput), false);
    assertNoStages(root);

    await write(source, 'install.ps1', "param([string]$SourceRef = 'v1.2.3',[string]$ExpectedCommit = '')\n");
    await write(source, 'install.sh', '#!/usr/bin/env bash\nSOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v1.2.3}"\nEXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"\n# EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"\n');
    git(source, ['add', 'install.ps1', 'install.sh']);
    git(source, ['commit', '-m', 'duplicate linux pin']);
    const duplicateLinuxCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const duplicateLinuxOutput = path.join(root, 'duplicate-linux-output');
    assertFailed(invokeBuilder(source, duplicateLinuxCommit, duplicateLinuxOutput), 'INSTALL_SH_PIN_PLACEHOLDER_COUNT');
    assert.equal(fs.existsSync(duplicateLinuxOutput), false);
    assertNoStages(root);

    await write(source, 'install.ps1', "param([string]$SourceRef = 'v1.2.3',[string]$ExpectedCommit = 'not-pinned')\n# [string]$ExpectedCommit = ''\n");
    await write(source, 'install.sh', '#!/usr/bin/env bash\nSOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v1.2.3}"\nEXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"\n');
    git(source, ['add', 'install.ps1', 'install.sh']);
    git(source, ['commit', '-m', 'comment-only windows placeholder']);
    const commentOnlyWindowsCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const commentOnlyWindowsOutput = path.join(root, 'comment-only-windows-output');
    assertFailed(invokeBuilder(source, commentOnlyWindowsCommit, commentOnlyWindowsOutput), 'INSTALL_PS1_EFFECTIVE_PIN_INVALID');
    assert.equal(fs.existsSync(commentOnlyWindowsOutput), false);
    assertNoStages(root);

    await write(source, 'install.ps1', "param([string]$SourceRef = 'v1.2.3',[string]$ExpectedCommit = '')\n");
    await write(source, 'install.sh', '#!/usr/bin/env bash\nSOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v1.2.3}"\nEXPECTED_COMMIT="not-pinned"\n# EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"\n');
    git(source, ['add', 'install.ps1', 'install.sh']);
    git(source, ['commit', '-m', 'comment-only linux placeholder']);
    const commentOnlyLinuxCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const commentOnlyLinuxOutput = path.join(root, 'comment-only-linux-output');
    assertFailed(invokeBuilder(source, commentOnlyLinuxCommit, commentOnlyLinuxOutput), 'INSTALL_SH_EFFECTIVE_PIN_INVALID');
    assert.equal(fs.existsSync(commentOnlyLinuxOutput), false);
    assertNoStages(root);

    git(source, ['tag', '-d', 'v1.2.3']);
    const missingTagOutput = path.join(root, 'missing-tag-output');
    assertFailed(invokeBuilder(source, commentOnlyLinuxCommit, missingTagOutput), 'RELEASE_TAG_NOT_FOUND');
    assert.equal(fs.existsSync(missingTagOutput), false);
    git(source, ['tag', 'v1.2.3']);

    git(source, ['remote', 'set-url', 'origin', 'https://github.com/example/not-the-product.git']);
    const wrongOriginOutput = path.join(root, 'wrong-origin-output');
    assertFailed(invokeBuilder(source, commentOnlyLinuxCommit, wrongOriginOutput), 'CANONICAL_ORIGIN_MISMATCH');
    assert.equal(fs.existsSync(wrongOriginOutput), false);
    git(source, ['remote', 'set-url', 'origin', canonicalOrigin]);

    await write(source, 'install.ps1', "param([string]$SourceRef = 'v9.9.9',[string]$ExpectedCommit = '')\nWrite-Output 'fixture'\n");
    await write(source, 'install.sh', '#!/usr/bin/env bash\nset -euo pipefail\nSOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v1.2.3}"\nEXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"\nprintf "%s\\n" "$EXPECTED_COMMIT"\n');
    git(source, ['add', 'install.ps1', 'install.sh']);
    git(source, ['commit', '-m', 'wrong Windows default source ref']);
    const wrongWindowsRefCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const wrongWindowsRefOutput = path.join(root, 'wrong-windows-ref-output');
    assertFailed(invokeBuilder(source, wrongWindowsRefCommit, wrongWindowsRefOutput), 'INSTALL_PS1_DEFAULT_SOURCE_REF_INVALID');
    assert.equal(fs.existsSync(wrongWindowsRefOutput), false);

    await write(source, 'install.ps1', "param([string]$SourceRef = 'v1.2.3',[string]$ExpectedCommit = '')\nWrite-Output 'fixture'\n");
    await write(source, 'install.sh', '#!/usr/bin/env bash\nset -euo pipefail\nSOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v9.9.9}"\nEXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"\nprintf "%s\\n" "$EXPECTED_COMMIT"\n');
    git(source, ['add', 'install.ps1', 'install.sh']);
    git(source, ['commit', '-m', 'wrong Linux default source ref']);
    const wrongLinuxRefCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const wrongLinuxRefOutput = path.join(root, 'wrong-linux-ref-output');
    assertFailed(invokeBuilder(source, wrongLinuxRefCommit, wrongLinuxRefOutput), 'INSTALL_SH_DEFAULT_SOURCE_REF_INVALID');
    assert.equal(fs.existsSync(wrongLinuxRefOutput), false);

    await write(source, 'install.sh', '#!/usr/bin/env bash\nset -euo pipefail\nSOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v1.2.3}"\nEXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"\nprintf "%s\\n" "$EXPECTED_COMMIT"\n');
    await write(source, 'package.json', JSON.stringify({ name: 'chatgpt-remote-commander', version: '1.2.3', repository: 'https://github.com/example/not-the-product' }, null, 2) + '\n');
    git(source, ['add', 'install.sh', 'package.json']);
    git(source, ['commit', '-m', 'wrong package repository']);
    const wrongRepositoryCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const wrongRepositoryOutput = path.join(root, 'wrong-repository-output');
    assertFailed(invokeBuilder(source, wrongRepositoryCommit, wrongRepositoryOutput), 'PACKAGE_REPOSITORY_MISMATCH');
    assert.equal(fs.existsSync(wrongRepositoryOutput), false);

    await write(source, 'package.json', JSON.stringify({ name: 'chatgpt-remote-commander', version: '1.2.3', repository: canonicalRepository }, null, 2) + '\n');
    await write(source, 'plugin-template/plugin.json', JSON.stringify({ name: 'different-plugin', version: '1.2.3', repository: canonicalRepository, homepage: canonicalRepository }, null, 2) + '\n');
    git(source, ['add', 'package.json', 'plugin-template/plugin.json']);
    git(source, ['commit', '-m', 'wrong plugin identity']);
    const wrongPluginCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const wrongPluginOutput = path.join(root, 'wrong-plugin-output');
    assertFailed(invokeBuilder(source, wrongPluginCommit, wrongPluginOutput), 'PLUGIN_IDENTITY_MISMATCH');
    assert.equal(fs.existsSync(wrongPluginOutput), false);

    await write(source, 'plugin-template/plugin.json', JSON.stringify({ name: 'chatgpt-remote-commander', version: '1.2.3', repository: canonicalRepository, homepage: canonicalRepository }, null, 2) + '\n');
    await write(source, 'install-work-plugin.ps1', "param()\n$ReleaseTag='wrong'\n$PluginTemplateSha256='wrong'\n$PluginTemplateManifestBase64='wrong'\n# __REMOTE_COMMANDER_RELEASE_TAG__\n# __REMOTE_COMMANDER_PLUGIN_TEMPLATE_SHA256__\n# __REMOTE_COMMANDER_PLUGIN_TEMPLATE_MANIFEST_BASE64__\n");
    git(source, ['add', 'plugin-template/plugin.json', 'install-work-plugin.ps1']);
    git(source, ['commit', '-m', 'comment-only plugin PowerShell pins']);
    const commentOnlyPluginPsCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const commentOnlyPluginPsOutput = path.join(root, 'comment-only-plugin-ps-output');
    assertFailed(invokeBuilder(source, commentOnlyPluginPsCommit, commentOnlyPluginPsOutput), 'PLUGIN_INSTALLER_EFFECTIVE_PIN_INVALID');
    assert.equal(fs.existsSync(commentOnlyPluginPsOutput), false);

    await write(source, 'install-work-plugin.ps1', await fsp.readFile(path.join(repo, 'install-work-plugin.ps1')));
    await write(source, 'install-work-plugin.sh', "#!/usr/bin/env bash\nRELEASE_TAG='wrong'\nPLUGIN_TEMPLATE_SHA256='wrong'\nPLUGIN_TEMPLATE_MANIFEST_BASE64='wrong'\n# __REMOTE_COMMANDER_RELEASE_TAG__\n# __REMOTE_COMMANDER_PLUGIN_TEMPLATE_SHA256__\n# __REMOTE_COMMANDER_PLUGIN_TEMPLATE_MANIFEST_BASE64__\n");
    git(source, ['add', 'install-work-plugin.ps1', 'install-work-plugin.sh']);
    git(source, ['commit', '-m', 'comment-only plugin Bash pins']);
    const commentOnlyPluginShCommit = git(source, ['rev-parse', 'HEAD']).toLowerCase();
    git(source, ['tag', '-f', 'v1.2.3']);
    const commentOnlyPluginShOutput = path.join(root, 'comment-only-plugin-sh-output');
    assertFailed(invokeBuilder(source, commentOnlyPluginShCommit, commentOnlyPluginShOutput), 'PLUGIN_INSTALLER_EFFECTIVE_PIN_INVALID');
    assert.equal(fs.existsSync(commentOnlyPluginShOutput), false);
    assertNoStages(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
