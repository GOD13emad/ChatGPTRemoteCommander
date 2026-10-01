import { appendFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync, writeSync } from 'node:fs';
import os from 'node:os';

const [mode, arg1, arg2, arg3] = process.argv.slice(2);
if (mode === 'sleep') {
  await new Promise((resolve) => setTimeout(resolve, Number(arg1 || 100)));
  process.stdout.write(arg2 || 'done');
} else if (mode === 'linger-stdio') {
  const holdMs = Number(arg3 || 10000);
  const child = spawn(process.execPath, ['-e', `setTimeout(()=>{},${holdMs})`], {
    detached: true,
    windowsHide: true,
    cwd: os.tmpdir(),
    stdio: ['ignore', 'inherit', 'inherit']
  });
  child.unref();
  // Signal that the direct child has actually been scheduled and established
  // the inherited-stdio condition. The regression timer starts from this
  // marker, not from operation creation under unrelated CI scheduler load.
  if (arg2) {
    const readyTmp = arg2 + '.tmp-' + process.pid;
    writeFileSync(readyTmp, String(child.pid) + '\n', 'utf8');
    renameSync(readyTmp, arg2);
  }
  // Write the direct child's tiny marker synchronously, then exit immediately.
  // This constructs the intended regression condition without depending on a
  // stream callback that can be delayed under hosted-runner load while the
  // detached grandchild keeps the inherited pipe descriptor open.
  writeSync(1, arg1 || 'parent-done');
  process.exit(0);
} else if (mode === 'large') {
  const bytes = Number(arg1 || 1024);
  process.stdout.write('x'.repeat(bytes));
} else if (mode === 'effect') {
  await appendFile(arg1, 'x', 'utf8');
  await new Promise((resolve) => setTimeout(resolve, Number(arg2 || 100)));
  process.stdout.write('effect-done');
} else if (mode === 'write') {
  await writeFile(arg1, arg2 || 'ok', 'utf8');
} else {
  process.stderr.write('unknown mode');
  process.exitCode = 2;
}
