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
  "test/native-tunnel-attestor.test.mjs",
  "test/native-owner-session-provider-windows.test.mjs",
  "test/v101-g1-loopback-runtime.test.mjs",
  "test/v2-private-tunnel-mtls-attestor.test.mjs",
  "test/v2-private-tunnel-https-gateway.test.mjs"
];

const batches = [
  files.slice(0, 5),
  files.slice(5, 9),
  files.slice(9, 10), // WorkflowStore: separate bounded DB/process regression
  files.slice(10, 13),
  files.slice(13)
];
if(batches.flat().length!==files.length
  ||new Set(batches.flat()).size!==files.length
  ||batches.some(batch=>batch.length===0))
  throw new Error('V012_SOURCE_REGRESSION_COVERAGE_INVALID');
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
