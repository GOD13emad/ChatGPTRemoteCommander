import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

test('annotated release refs must be peeled to commits before ExpectedCommit comparison', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-annotated-tag-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');

  try {
    await fs.mkdir(source, { recursive: true });
    git(source, ['init']);
    git(source, ['config', 'user.name', 'Remote Commander Test']);
    git(source, ['config', 'user.email', 'remote-commander-test@users.noreply.github.com']);
    await fs.writeFile(path.join(source, 'marker.txt'), 'ANNOTATED_TAG_TEST\n', 'utf8');
    git(source, ['add', 'marker.txt']);
    git(source, ['commit', '-m', 'fixture']);
    const commit = git(source, ['rev-parse', 'HEAD']);
    git(source, ['tag', '-a', 'v-fixture', '-m', 'fixture annotated tag']);

    await fs.mkdir(target, { recursive: true });
    git(target, ['init']);
    git(target, ['remote', 'add', 'origin', source]);
    git(target, ['fetch', '--depth', '1', '--no-tags', 'origin', 'v-fixture']);

    const rawFetchHead = git(target, ['rev-parse', 'FETCH_HEAD']);
    const peeled = git(target, ['rev-parse', 'FETCH_HEAD^{commit}']);

    assert.match(commit, /^[0-9a-f]{40}$/);
    assert.match(rawFetchHead, /^[0-9a-f]{40}$/);
    assert.notEqual(rawFetchHead, commit, 'annotated tag object must differ from its commit');
    assert.equal(peeled, commit, 'peeled FETCH_HEAD must equal the expected release commit');

    const windowsInstaller = await fs.readFile(path.resolve('install.ps1'), 'utf8');
    const linuxInstaller = await fs.readFile(path.resolve('install.sh'), 'utf8');
    for (const [name, sourceText] of [['install.ps1', windowsInstaller], ['install.sh', linuxInstaller]]) {
      assert.match(sourceText, /FETCH_HEAD\^\{commit\}/, `${name} must peel fetched refs to commits`);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
