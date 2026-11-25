import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareShellCommand } from '../src/power-tools-v0.3.mjs';
import { prepareProjectCommand } from '../src/tools-v0.3.mjs';

const ctx = {
  config: {
    powerMode: { enabled: true, allowShell: true, allowProcessControl: true, fullFilesystem: true, maxCommandMs: 6000 },
    allowedPrograms: ['pwsh', 'pwsh.exe', 'powershell.exe', 'node'],
    blockedShellPatterns: [],
    maxCommandMs: 6000
  },
  roots: [process.cwd()]
};

test('production prepareShellCommand denies direct WMI MSI provider before any spawn', async () => {
  await assert.rejects(
    prepareShellCommand(ctx, { command: 'Get-CimInstance -ClassName Win32_Product', cwd: process.cwd(), timeoutMs: 3000 }),
    error => error.code === 'UNSAFE_WIN32_PRODUCT_INVENTORY'
  );
});

test('production prepareProjectCommand rejects PowerShell -Command hazardous inventory before spawn', async () => {
  await assert.rejects(
    prepareProjectCommand(ctx, {
      program: 'pwsh', args: ['-NoProfile', '-Command', 'Get-WmiObject Win32_Product'],
      cwd: process.cwd(), timeoutMs: 3000
    }),
    error => error.code === 'UNSAFE_WIN32_PRODUCT_INVENTORY'
  );
});

test('safe shell preflight remains usable for genuine read-only registry inventory', async () => {
  const prepared = await prepareShellCommand(ctx, {
    command: 'Get-ChildItem HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    cwd: process.cwd(), timeoutMs: 3000
  });
  assert.ok(prepared && prepared.cwd);
  assert.ok(prepared.timeoutMs > 0);
});
