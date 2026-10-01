// Import-safe: observes only the caller's child and never spawns, kills, or reads state itself.
// Install synchronously after spawn, before any awaited persistence.
export function observeOperationChild(child, {
  stdout, stderr, timeoutMs, cancellationRequested, killOwnedChild,
  drainMs = 2000, timers = globalThis
}) {
  let resolveOutcome;
  const outcome = new Promise(resolve => { resolveOutcome = resolve; });
  let settled = false;
  let exited = null;
  let cancelRequested = false;
  let timedOut = false;
  let drainTimer = null;
  let terminationTimer = null;
  let cancelTimer = null;
  let timeoutTimer = null;
  const ownedPid = child.pid;
  const clear = (name, key) => { if (key !== null) timers[name](key); };
  const stopExecutionTimers = () => {
    clear('clearInterval', cancelTimer); cancelTimer = null;
    clear('clearTimeout', timeoutTimer); timeoutTimer = null;
  };
  const cleanup = () => {
    stopExecutionTimers();
    clear('clearTimeout', drainTimer); drainTimer = null;
    clear('clearTimeout', terminationTimer); terminationTimer = null;
    child.off('error', onError); child.off('exit', onExit); child.off('close', onClose);
    child.stdout?.off('data', onStdout); child.stderr?.off('data', onStderr);
  };
  const finish = value => {
    if (settled) return;
    settled = true;
    cleanup();
    // Tagged error, not rejection: persistence may still be awaiting I/O when spawn fails.
    resolveOutcome({ ...value, timedOut, cancelRequested });
  };
  const onStdout = chunk => stdout.push(chunk);
  const onStderr = chunk => stderr.push(chunk);
  const onError = error => finish({ error });
  const onExit = (code, signal) => {
    if (settled || exited) return;
    exited = { code, signal };
    stopExecutionTimers();
    clear('clearTimeout', terminationTimer); terminationTimer = null;
    drainTimer = timers.setTimeout(() => {
      finish({ ...exited, stdioComplete: false });
      child.stdout?.destroy(); child.stderr?.destroy();
    }, drainMs);
  };
  const onClose = (code, signal) => finish({
    code: exited?.code ?? code, signal: exited?.signal ?? signal, stdioComplete: true
  });
  const interrupt = kind => {
    if (settled || exited) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode);
      return;
    }
    if (!Number.isSafeInteger(ownedPid) || ownedPid <= 0 || child.pid !== ownedPid) {
      finish({ error: new Error('CHILD_IDENTITY_UNPROVEN') });
      return;
    }
    if (kind === 'cancel') cancelRequested = true; else timedOut = true;
    stopExecutionTimers();
    try { killOwnedChild(ownedPid); } catch (error) { onError(error); }
    if (!settled && !exited) terminationTimer = timers.setTimeout(() => {
      // No termination observation is not proof of a completed/cancelled external effect.
      finish({ error: new Error('CHILD_TERMINATION_UNCONFIRMED') });
      child.stdout?.destroy(); child.stderr?.destroy();
    }, drainMs);
  };
  child.stdout?.on('data', onStdout); child.stderr?.on('data', onStderr);
  child.once('error', onError); child.once('exit', onExit); child.once('close', onClose);
  cancelTimer = timers.setInterval(() => {
    try { if (cancellationRequested()) interrupt('cancel'); }
    catch (error) { onError(error); }
  }, 250);
  timeoutTimer = timers.setTimeout(() => interrupt('timeout'), timeoutMs);
  return { outcome, dispose: cleanup };
}
