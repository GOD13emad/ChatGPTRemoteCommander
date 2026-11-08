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

const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1', ...files
], {
  stdio: 'inherit',
  windowsHide: true,
  timeout: 30000
});

if (result.error) {
  process.stderr.write('V012_SOURCE_REGRESSION_RUNNER_FAILED: ' + result.error.message + '\n');
  process.exitCode = 1;
} else if (result.signal || result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
