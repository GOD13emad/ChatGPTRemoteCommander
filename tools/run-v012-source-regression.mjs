import { spawnSync } from 'node:child_process';

const files = [
  "test/effective-power-owner-grant.test.mjs",
  "test/operation-worker-execution-access.test.mjs",
  "test/v102-payload-audit.test.mjs",
  "test/windows-job-receipt.test.mjs",
  "test/v2-worker-grant-registry.test.mjs",
  "test/v2-native-owner-session-bindings.test.mjs",
  "test/j01-binding-v101-bridge.test.mjs",
  "test/v101-owner-bound-router-bridge.test.mjs",
  "test/v101-worker-identity-grant-adapter.test.mjs",
  "test/workflow-store.test.mjs",
  "test/worker-identity-authority.test.mjs",
  "test/worker-identity-store.test.mjs",
  "test/native-tunnel-attestor.test.mjs"
];

// Preserve 13 exact tests and the original 30-second limit per child process.
// The loaded Windows CI runner timed out when it bundled the WorkflowStore
// process-heavy suite with three further files. Give WorkflowStore its own
// bounded cold phase and split the former near-timeout first group as well.
const batches = [files.slice(0, 3), files.slice(3, 5), files.slice(5, 9), files.slice(9, 10), files.slice(10)];
if (new Set(files).size !== files.length ||
    batches.some(batch => batch.length === 0) ||
    batches.flat().length !== files.length ||
    batches.flat().some((file, index) => file !== files[index])) {
  throw new Error('V012_SOURCE_REGRESSION_BATCH_COVERAGE_INVALID');
}
for (let index = 0; index < batches.length; index++) {
  const batch = batches[index];
  if (!batch.length) continue;
  process.stdout.write('V012_SOURCE_REGRESSION_BATCH_START_' + (index + 1) + '/' + batches.length + ' files=' + batch.length + '\n');
  const result = spawnSync(process.execPath, [
    '--test', '--test-concurrency=1', ...batch
  ], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 30000
  });

  if (result.error) {
    process.stderr.write('V012_SOURCE_REGRESSION_RUNNER_FAILED batch=' + (index + 1) + ': ' + result.error.message + '\n');
    process.exitCode = 1;
    break;
  }
  if (result.signal || result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
  process.stdout.write('V012_SOURCE_REGRESSION_BATCH_PASS_' + (index + 1) + '/' + batches.length + '\n');
}
