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
  "test/v2-private-tunnel-https-gateway.test.mjs",
  "test/v101-g1-canonical-workflow-runtime.test.mjs",
  "test/qa-v012-no-promote-ingress.test.mjs",
  "test/owner-pinned-provenance.test.mjs",
  "test/v012-owner-local-canary.test.mjs",
  "test/owner-dpapi-profile-recovery.test.mjs",
  "test/owner-systemd-creds-profile-recovery.test.mjs",
  "test/native-owner-session-provider-linux.test.mjs",
  "test/local-ollama-planner.test.mjs",
  "test/native-tunnel-client-observer-linux.test.mjs"
];

// Keep every file once while bounding expensive Windows native process/SQLite
// fixtures inside the unchanged 30-second per-batch execution budget.
const batches = [
  files.slice(0, 2),
  files.slice(2, 4),
  files.slice(4, 5),
  files.slice(5, 7),
  files.slice(7, 9),
  files.slice(9, 10), // WorkflowStore: separate bounded DB/process regression
  files.slice(10, 12),
  files.slice(12, 13),
  files.slice(13, 15),
  files.slice(15, 17),
  files.slice(17, 18), // Canonical G1/WorkflowStore composition and mTLS denial
  files.slice(18, 26) // NoPromote, protected Core, encrypted recovery, local J01 and owner-pinned tunnel
];
if(batches.flat().length!==files.length
  ||new Set(batches.flat()).size!==files.length
  ||batches.some(batch=>batch.length===0))
  throw new Error('V012_SOURCE_REGRESSION_COVERAGE_INVALID');
// Durable Commander operations have a 30-second transport deadline, not a
// release-test deadline. Independently replayable ranges avoid losing all
// test evidence when this suite approaches that cap. CI runs the full suite.
function selectedRange(argv){
  if(argv.length===0)return {first:1,last:batches.length};
  if(argv.length!==1||!/^--batch-range=[0-9]{1,2}-[0-9]{1,2}$/.test(argv[0]))
    throw new Error('V012_SOURCE_REGRESSION_BATCH_RANGE_INVALID');
  const [,numbers]=argv[0].split('=');
  const [first,last]=numbers.split('-').map(Number);
  if(first<1||last<first||last>batches.length)
    throw new Error('V012_SOURCE_REGRESSION_BATCH_RANGE_INVALID');
  return {first,last};
}
const range=selectedRange(process.argv.slice(2));
for (let index = range.first-1; index < range.last; index++) {
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
