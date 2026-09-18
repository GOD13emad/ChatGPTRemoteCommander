import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log(`GUI_NATIVE_LAYOUT_SKIP platform=${process.platform}`);
  process.exit(0);
}

const result = spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File','test/gui-native.ps1'],{encoding:'utf8',timeout:30000});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`GUI_NATIVE_LAYOUT_FAILED\n${result.stdout}\n${result.stderr}`);
process.stdout.write(result.stdout);
