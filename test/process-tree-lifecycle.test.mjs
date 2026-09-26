import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runShell, startTerminal, stopTerminal } from '../src/power-tools-v0.3.mjs';
import { runProjectCommand } from '../src/tools-v0.3.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (target) => fs.existsSync(target);
const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const shQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

async function fixture(t) {
  const root = fs.realpathSync.native(await mkdtemp(path.join(os.tmpdir(), 'rc-process-tree-')));
  t.after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); });
  return root;
}

function powerContext(root) {
  return {
    roots: [root],
    auditLog: path.join(root, 'audit.jsonl'),
    config: {
      powerMode: {
        enabled: true,
        fullFilesystem: true,
        allowShell: true,
        allowProcessControl: true,
        allowPermanentDelete: true,
        maxCommandMs: 5000,
        maxOutputBytes: 262144,
        maxTerminalBufferBytes: 262144,
        blockedShellPatterns: []
      }
    }
  };
}

function delayedShellMarker(marker, started = null) {
  if (process.platform === 'win32') {
    const child = `Start-Sleep -Milliseconds 1800; Set-Content -LiteralPath ${psQuote(marker)} -Value leaked -Encoding ascii`;
    const encoded = Buffer.from(child, 'utf16le').toString('base64');
    const ready = started ? `; Set-Content -LiteralPath ${psQuote(started)} -Value started -Encoding ascii` : '';
    return `Start-Process -FilePath 'pwsh.exe' -ArgumentList '-NoLogo','-NoProfile','-EncodedCommand','${encoded}' -WindowStyle Hidden | Out-Null${ready}; Start-Sleep -Seconds 5`;
  }
  const ready = started ? `printf started > ${shQuote(started)}; ` : '';
  return `(sleep 1.8; printf leaked > ${shQuote(marker)}) & ${ready}sleep 5`;
}

async function waitForFile(target, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exists(target)) return true;
    await wait(25);
  }
  return exists(target);
}

test('run_shell timeout terminates the owned descendant process tree', { timeout: 10000 }, async (t) => {
  const root = await fixture(t);
  const marker = path.join(root, 'run-shell-leak.txt');
  const result = await runShell(powerContext(root), {
    command: delayedShellMarker(marker),
    cwd: root,
    timeoutMs: 1000
  });
  assert.equal(result.timedOut, true);
  await wait(2200);
  assert.equal(exists(marker), false);
});

test('stop_terminal terminates descendants and does not leave a delayed mutation', { timeout: 10000 }, async (t) => {
  const root = await fixture(t);
  const marker = path.join(root, 'terminal-leak.txt');
  const started = path.join(root, 'terminal-started.txt');
  const ctx = powerContext(root);
  const session = await startTerminal(ctx, {
    cwd: root,
    command: delayedShellMarker(marker, started)
  });
  assert.equal(await waitForFile(started), true);
  await stopTerminal(ctx, { id: session.id, remove: false });
  await wait(2200);
  assert.equal(exists(marker), false);
  await stopTerminal(ctx, { id: session.id, remove: true });
});

test('run_project_command timeout terminates the owned descendant process tree', { timeout: 10000 }, async (t) => {
  const root = await fixture(t);
  const marker = path.join(root, 'project-command-leak.txt');
  const parent = path.join(root, 'parent.mjs');
  const descendant = path.join(root, 'descendant.mjs');
  await writeFile(descendant, `import fs from 'node:fs'; setTimeout(()=>fs.writeFileSync(process.argv[2],'leaked'),1800); setInterval(()=>{},1000);\n`);
  await writeFile(parent, `import { spawn } from 'node:child_process'; spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:'ignore'}); setInterval(()=>{},1000);\n`);
  const ctx = {
    roots: [root],
    auditLog: path.join(root, 'standard-audit.jsonl'),
    config: { allowedPrograms: ['node'], maxCommandMs: 5000, powerMode: { enabled: false } }
  };
  const result = await runProjectCommand(ctx, {
    program: 'node',
    args: [parent, descendant, marker],
    cwd: root,
    timeoutMs: 1000
  });
  assert.equal(result.timedOut, true);
  await wait(2200);
  assert.equal(exists(marker), false);
});
