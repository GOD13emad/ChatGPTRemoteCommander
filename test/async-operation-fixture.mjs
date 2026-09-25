import { appendFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === 'sleep') {
  await new Promise((resolve) => setTimeout(resolve, Number(arg1 || 100)));
  process.stdout.write(arg2 || 'done');
} else if (mode === 'linger-stdio') {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {
    detached: true,
    windowsHide: true,
    cwd: os.tmpdir(),
    stdio: ['ignore', 'inherit', 'inherit']
  });
  child.unref();
  process.stdout.write(arg1 || 'parent-done');
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
