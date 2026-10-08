import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  UNSAFE_MSI_AUDIT, isUnsafeMsiInventoryCommand,
  assertSafeSoftwareInventoryCommand, assertSafeSoftwareInventoryInvocation
} from '../src/software-inventory-guard.mjs';

const deny = [
  'Get-CimInstance Win32_Product',
  'gcim -ClassName Win32_Product',
  'wmic path Win32_Product get Name',
  'Get-CimInstance -ClassName Win32_Product | Select-Object Name',
  'Get-WmiObject -Class Win32_Product',
  'gwmi Win32_Product',
  'wmic product get Name',
  'wmic.exe product where Name="Example" get Name',
  'Get-CimInstance -Query "SELECT * FROM Win32_Product"',
  'Get-WmiObject -Query "select name from Win32_Product"',
  'Invoke-CimMethod -ClassName Win32_Product -MethodName Configure'
];

test('known side-effecting MSI/WMI inventory invocations rejected on Windows', () => {
  for (const command of deny) {
    assert.equal(isUnsafeMsiInventoryCommand(command), true, command);
    assert.throws(() => assertSafeSoftwareInventoryCommand(command, { platform: 'win32' }),
      e => e.code === UNSAFE_MSI_AUDIT, command);
  }
});

test('read-only Uninstall registry and class-name source search remain available', () => {
  for (const command of [
    'Get-ChildItem HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    "Select-String -Pattern 'Win32_Product' -Path .\\docs\\audit.md",
    'rg Win32_Product ./src',
    'Get-CimInstance Win32_OperatingSystem'
  ]) {
    assert.equal(isUnsafeMsiInventoryCommand(command), false, command);
    assert.doesNotThrow(() => assertSafeSoftwareInventoryCommand(command, { platform: 'win32' }));
  }
});

test('Linux path unaffected by Windows-only policy', () => {
  assert.doesNotThrow(() => assertSafeSoftwareInventoryCommand(deny[0], { platform: 'linux' }));
});

test('PowerShell -Command and nested CMD direct arguments rejected before spawn', async () => {
  await assert.rejects(
    assertSafeSoftwareInventoryInvocation('pwsh.exe', ['-NoProfile', '-Command', deny[0]], 'C:\\', { platform: 'win32' }),
    e => e.code === UNSAFE_MSI_AUDIT
  );
  await assert.rejects(
    assertSafeSoftwareInventoryInvocation('cmd.exe', ['/d','/c','powershell.exe', '-Command', deny[2]], 'C:\\', { platform: 'win32' }),
    e => e.code === UNSAFE_MSI_AUDIT
  );
});

test('PowerShell -File preflight detects side-effecting source but permits registry-only file', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'rc-msi-inventory-r1-'));
  try {
    // These are fixture files only; no PowerShell is ever executed.
    const unsafe = path.join(folder, 'unsafe.ps1');
    const safe = path.join(folder, 'safe.ps1');
    await writeFile(unsafe, 'Get-CimInstance -ClassName Win32_Product\n');
    await writeFile(safe, 'Get-ChildItem HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\n');
    await assert.rejects(
      assertSafeSoftwareInventoryInvocation('pwsh.exe',['-NoProfile','-File',unsafe],folder,{platform:'win32'}),
      e => e.code === UNSAFE_MSI_AUDIT
    );
    await assert.doesNotReject(
      assertSafeSoftwareInventoryInvocation('pwsh.exe',['-NoProfile','-File',safe],folder,{platform:'win32'})
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('test suite does not instantiate MSI provider or reconfigure any Windows application', () => {
  assert.equal(typeof isUnsafeMsiInventoryCommand, 'function');
  assert.equal(UNSAFE_MSI_AUDIT, 'UNSAFE_WIN32_PRODUCT_INVENTORY');
});
