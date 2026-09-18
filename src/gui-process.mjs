import { spawn } from 'node:child_process';
import { guiError } from './gui-contract.mjs';

/** Execute only the fixed helper path, with JSON on stdin (never in process args).
 * Bounded buffers, one JSON result, cleanup on every termination path.
 * A failed input is NOT retried. Caller latches uncertain native outcomes.
 */
export function runGuiProcess(request, { file, args, timeoutMs = 30000, maxBytes = 7 * 1024 * 1024, env = process.env }) {
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let done = false;
    let outBytes = 0;
    let errBytes = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) { child?.kill(); reject(error); } else resolve(value);
    };
    try { child = spawn(file, args, { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false }); }
    catch { finish(guiError('GUI_HELPER_START_FAILED')); return; }
    child.once('error', () => finish(guiError('GUI_HELPER_START_FAILED')));
    child.stdin.once('error', () => finish(guiError('GUI_HELPER_STDIN_FAILED')));
    child.stdout.on('data', chunk => {
      if (done) return;
      outBytes += chunk.length;
      if (outBytes > maxBytes) finish(guiError('GUI_HELPER_OUTPUT_LIMIT')); else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      errBytes += chunk.length;
      if (errBytes > 16384) finish(guiError('GUI_HELPER_OUTPUT_LIMIT'));
      // Intentionally never forward raw stderr: it can contain screen titles or typed text.
    });
    child.once('close', code => {
      if (done) return;
      if (code !== 0) { finish(guiError('GUI_HELPER_EXIT_FAILED')); return; }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.ok !== 'boolean') throw new Error();
        if (value.ok !== true) {
          const safeCode = /^[A-Z][A-Z0-9_]{1,79}$/.test(value.error ?? '') ? value.error : 'GUI_NATIVE_FAILED';
          finish(guiError(safeCode));
        } else finish(null, value);
      } catch { finish(guiError('GUI_HELPER_BAD_JSON')); }
    });
    timer = setTimeout(() => finish(guiError('GUI_HELPER_TIMEOUT')), timeoutMs);
    child.stdin.end(JSON.stringify(request), 'utf8');
  });
}
