import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.log(`GUI_NATIVE_E2E_SKIP platform=${process.platform}`);
  process.exit(0);
}

function run(file, args, label, timeout = 120000) {
  const r = spawnSync(file, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    timeout
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${label} failed with exit code ${r.status}`);
}

function findDotnet10() {
  const candidates = [
    process.env.DOTNET_ROOT ? path.join(process.env.DOTNET_ROOT, 'dotnet.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'dotnet', 'dotnet.exe') : null,
    'dotnet'
  ].filter(Boolean);
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key) || (path.isAbsolute(candidate) && !fs.existsSync(candidate))) continue;
    seen.add(key);
    const probe = spawnSync(candidate, ['--list-sdks'], { encoding: 'utf8', shell: false, timeout: 15000 });
    if (!probe.error && probe.status === 0 && /(?:^|\r?\n)10\.\d+\.\d+\s+\[/m.test(probe.stdout)) return candidate;
  }
  throw new Error('GUI_NATIVE_DOTNET_10_SDK_REQUIRED');
}

run('pwsh.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File','test/gui-native.ps1'], 'native layout self-test', 90000);
const dotnet = findDotnet10();
process.env.REMOTE_COMMANDER_DOTNET_EXE = dotnet;
run(dotnet, ['build','test/gui-e2e-app/GuiE2EApp.csproj','-c','Release','--nologo'], 'GUI E2E app build');
run(process.execPath, ['test/gui-native-e2e.mjs'], 'GUI native E2E');

console.log('GUI_NATIVE_E2E_PASS');
