import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, rm } from 'node:fs/promises';
import {
  copyPath, createDirectory, deletePath, fileInfo, movePath,
  powerStatus, readAnyFile, runShell, searchFiles,
  startTerminal, readTerminal, stopTerminal, writeAnyFile
} from '../src/power-tools-v0.3.mjs';
import {
  listDirectory as legacyListDirectory,
  readText as legacyReadText,
  runProjectCommand as legacyRunProjectCommand,
  writeText as legacyWriteText
} from '../src/tools-v0.3.mjs';

const root = path.resolve('test', '.tmp-power-v03-root');
const backups = path.resolve('test', '.tmp-power-v03-backups');
const legacyOutside = path.resolve('test', '.tmp-legacy-power-v03-outside');
const legacyAudit = path.resolve('test', '.tmp-legacy-power-v03-audit.jsonl');
const cleanup = async (target) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(target, { recursive: true, force: true }); return; }
    catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
};
await cleanup(root);
await cleanup(backups);
await cleanup(legacyOutside);
await rm(legacyAudit, { force: true });
await cleanup(legacyOutside);
await rm(legacyAudit, { force: true });
await mkdir(root, { recursive: true });
await mkdir(legacyOutside, { recursive: true });
const ctx = {
  roots: [root],
  auditLog: legacyAudit,
  config: {
    maxReadBytes: 1024 * 1024,
    maxWriteBytes: 1024 * 1024,
    maxCommandMs: 10000,
    allowedPrograms: ['git', 'node'],
    powerMode: {
      enabled: true, fullFilesystem: true, allowShell: true,
      allowProcessControl: true, allowPermanentDelete: false,
      backupRoot: backups, maxFileBytes: 1024 * 1024,
      maxCommandMs: 10000, maxOutputBytes: 1024 * 1024,
      maxTerminalBufferBytes: 1024 * 1024,
      blockedShellPatterns: [
        'shutdown', 'Restart-Computer', 'Stop-Computer', 'logoff',
        '(^|\\s)(reboot|poweroff|halt)(\\s|$)', 'systemctl\\s+(reboot|poweroff|halt)'
      ]
    }
  }
};
const status = await powerStatus(ctx);
assert.equal(status.enabled, true);
assert.equal(status.platform, process.platform);
await createDirectory(ctx, { path: path.join(root, 'a', 'b') });
let write = await writeAnyFile(ctx, { path: path.join(root, 'a', 'b', 'x.txt'), content: 'alpha' });
assert.ok(write.sha256);
let read = await readAnyFile(ctx, { path: path.join(root, 'a', 'b', 'x.txt') });
assert.equal(read.content, 'alpha');
const info = await fileInfo(ctx, { path: path.join(root, 'a', 'b', 'x.txt') });
assert.equal(info.isFile, true);
await copyPath(ctx, { source: path.join(root, 'a'), destination: path.join(root, 'copy') });
await movePath(ctx, { source: path.join(root, 'copy', 'b', 'x.txt'), destination: path.join(root, 'moved.txt') });
assert.equal(await readFile(path.join(root, 'moved.txt'), 'utf8'), 'alpha');

const search = await searchFiles(ctx, { path: root, pattern: 'alpha', searchContent: true, depth: 5 });
assert.ok(search.results.some((item) => item.path.endsWith('moved.txt')));

const shellCommand = process.platform === 'win32'
  ? "Write-Output 'POWER_SHELL_PASS'"
  : "printf 'POWER_SHELL_PASS\\n'";
const shell = await runShell(ctx, { command: shellCommand, cwd: root, timeoutMs: 5000 });
assert.equal(shell.exitCode, 0);
assert.match(shell.stdout, /POWER_SHELL_PASS/);
const blockedCommand = process.platform === 'win32' ? 'shutdown /s' : 'shutdown -h now';
await assert.rejects(() => runShell(ctx, { command: blockedCommand, cwd: root }), /blocked by policy/);

const terminalCommand = process.platform === 'win32'
  ? "Write-Output 'TERM_PASS'"
  : "printf 'TERM_PASS\\n'";
const term = await startTerminal(ctx, { cwd: root, command: terminalCommand });
let termOut = null;
for (let attempt = 0; attempt < 20; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  termOut = await readTerminal(ctx, { id: term.id, consume: false });
  if (/TERM_PASS/.test(termOut.stdout)) break;
}
assert.match(termOut?.stdout ?? '', /TERM_PASS/);
await stopTerminal(ctx, { id: term.id });

const before = await readAnyFile(ctx, { path: path.join(root, 'a', 'b', 'x.txt') });
await assert.rejects(
  () => writeAnyFile(ctx, {
    path: path.join(root, 'a', 'b', 'x.txt'),
    content: 'conflict', expectedSha256: '0'.repeat(64)
  }),
  /expectedSha256/
);
const afterConflict = await readAnyFile(ctx, { path: path.join(root, 'a', 'b', 'x.txt') });
assert.equal(afterConflict.sha256, before.sha256);

const deleted = await deletePath(ctx, { path: path.join(root, 'moved.txt') });
assert.ok(deleted.backupPath);
await assert.rejects(() => deletePath(ctx, { path: path.join(root, 'a'), permanent: true }), /permanent delete is disabled/);

// Legacy five-tool compatibility: explicit Power Mode fullFilesystem must be effective
// even when the target is outside configured roots.
const legacyFile = path.join(legacyOutside, 'legacy.txt');
let legacyWrite = await legacyWriteText(ctx, { path: legacyFile, content: 'legacy-alpha' });
assert.equal(legacyWrite.beforeSha256, null);
const legacyFirstHash = legacyWrite.sha256;
legacyWrite = await legacyWriteText(ctx, {
  path: legacyFile, content: 'legacy-beta', expectedSha256: legacyFirstHash
});
assert.ok(legacyWrite.backupPath);
assert.ok(path.resolve(legacyWrite.backupPath).startsWith(path.resolve(backups) + path.sep));
const legacyRead = await legacyReadText(ctx, { path: legacyFile });
assert.equal(legacyRead.text, 'legacy-beta');
const legacyListing = await legacyListDirectory(ctx, { path: legacyOutside, depth: 0, maxEntries: 20 });
assert.ok(legacyListing.entries.some((entry) => entry.path === 'legacy.txt'));
assert.equal(legacyListing.entries.some((entry) => entry.path === '.remote-commander-backups'), false);

const legacyScript = path.join(legacyOutside, 'legacy-command.mjs');
await legacyWriteText(ctx, {
  path: legacyScript,
  content: "console.log('LEGACY_POWER_COMMAND_PASS')\n"
});
const legacyCommand = await legacyRunProjectCommand(ctx, {
  program: 'node', args: [legacyScript], cwd: legacyOutside, timeoutMs: 5000
});
assert.equal(legacyCommand.exitCode, 0);
assert.match(legacyCommand.stdout, /LEGACY_POWER_COMMAND_PASS/);
await assert.rejects(
  () => legacyRunProjectCommand(ctx, {
    program: 'node', args: ['--eval=console.log(1)'], cwd: legacyOutside, timeoutMs: 5000
  }),
  /eval\/print/
);
console.log('LEGACY_POWER_COMPAT_V03_PASS');
console.log('POWER_SMOKE_V03_PASS');
await cleanup(root);
await cleanup(backups);
