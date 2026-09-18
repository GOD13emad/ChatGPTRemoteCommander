import { spawnSync } from 'node:child_process';

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

run('pwsh.exe', ['-NoLogo','-NoProfile','-NonInteractive','-File','test/gui-native.ps1'], 'native layout self-test', 90000);
run('dotnet', ['build','test/gui-e2e-app/GuiE2EApp.csproj','-c','Release','--nologo'], 'GUI E2E app build');
run(process.execPath, ['test/gui-native-e2e.mjs'], 'GUI native E2E');

console.log('GUI_NATIVE_E2E_PASS');
