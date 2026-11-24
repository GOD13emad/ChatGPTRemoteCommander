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
  "test/native-owner-dialog-streamsafe-contract.test.mjs",
  "test/local-ollama-planner.test.mjs",
  "test/native-tunnel-client-observer-linux.test.mjs",
  "test/v012-private-native-worker-adapter.test.mjs",
  "test/v012-private-owner-worker-key-provision.test.mjs",
  "test/windows-owner-tunnel-host-resolution.test.mjs",
  "test/v012-host-global-operation-lease.test.mjs",
  "test/v012-windows-host-global-operation-lease.test.mjs",
  "test/v012-native-operation-lease-gate.test.mjs",
  "test/v012-owner-native-host-lease-bootstrap.test.mjs",
  "test/gui-linux-session-route.test.mjs",
  "test/qa-v012-no-grant-source-coherence.test.mjs",
  "test/v101-pinned-interop-runner.test.mjs"
];

// Keep each test executable once. WorkflowStore's two slow process fixtures
// and the Linux owner-credential tests use exact name-filtered processes.
// Ordinary batches keep a 30-second deadline. Windows DPAPI recovery has
// independent test-declared 30s/60s limits, so it must not share a 30s batch
// with protected Core. Linux recovery likewise has bounded per-fixture budgets.
// Do not skip tests or disable timeouts when a hosted Windows worker is slow.
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
  files.slice(18, 20), // NoPromote and owner-pinned provenance
  files.slice(20, 21), // Protected Core: keep native boot scoped to 30s
  files.slice(21, 22), // Windows DPAPI recovery: test-declared 30s and 60s budgets
  files.slice(22, 23), // Linux encrypted recovery: two expensive fixtures
  files.slice(23, 30), // Native owner, dialogs, Tunnel, Worker, sealed key, hostname
  files.slice(30, 31), // Native Linux SQLite lease and cross-process tests
  files.slice(31, 32), // Windows ACL/SQLite native tests: separate aggregate budget
  files.slice(32, 33), // Protected operation gate with native lease
  files.slice(33, 34), // Native owner bootstrap: separate aggregate budget
  files.slice(34, 35), // Linux GUI routing contract
  files.slice(35, 36), // No-grant bootstrap and J01 timeout coherence
  files.slice(36, 37) // Pinned Interop runner negative contracts (not positive Interop)
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
const slowWorkflowTests = [
  'WorkflowStore accepts only the contained runner proof bound to its acquired root lease',
  'trusted process-cessation receipt reconciles and releases only the expired matching root lease'
];
const linuxOwnerRecoveryTests = [
  'Linux native owner credential recovery stages idempotently, verifies isolated restore and rejects tampering',
  'profile-specific owner recovery capsules never share a Tunnel or private TLS pair'
];
for (let index = range.first-1; index < range.last; index++) {
  const batch = batches[index];
  if (!batch.length) continue;
  // The two disjoint name filters and their complement execute every test
  // exactly once; no tool behavior, assertions, or deadlines are skipped.
  const slowPattern = '^(?:' + slowWorkflowTests.join('|') + ')$';
  // On hosted Windows, the two distinct native mTLS/Gateway test files
  // individually fit the established 30s limit, but the shared process can
  // exceed it under runner load. One process per file, same assertions,
  // same deadline per process, unchanged batch indexes and exact coverage.
  const isolatedWindowsTunnel = process.platform === 'win32' && index === 9;
  if (isolatedWindowsTunnel &&
    (batch.length !== 2 ||
     batch[0] !== 'test/v2-private-tunnel-mtls-attestor.test.mjs' ||
     batch[1] !== 'test/v2-private-tunnel-https-gateway.test.mjs'))
    throw new Error('V012_SOURCE_REGRESSION_TUNNEL_BATCH_INVALID');
  const partitions = index === 5 ? [
    ...slowWorkflowTests.map(name => ['--test-name-pattern=^' + name + '$']),
    ['--test-skip-pattern=' + slowPattern]
  ] : isolatedWindowsTunnel ? [[], []]
    : index === 14 ? linuxOwnerRecoveryTests.map(name =>
    ['--test-name-pattern=^' + name + '$']) : [[]];
  for (let part = 0; part < partitions.length; part++) {
    process.stdout.write('V012_SOURCE_REGRESSION_BATCH_START_' + (index + 1) + '/' + batches.length +
      ' files=' + batch.length + ' partition=' + (part + 1) + '/' + partitions.length + '\n');
    const activeFiles = isolatedWindowsTunnel ? [batch[part]] : batch;
    const result = spawnSync(process.execPath, [
      '--test', '--test-concurrency=1', ...partitions[part], ...activeFiles
    ], {
      stdio: 'inherit',
      windowsHide: true,
      // The Windows DPAPI suite has two 30s/60s test deadlines; allow
      // bounded aggregate overhead without relaxing either assertion.
      // Linux owner recovery has two separate 50s/60s fixtures.
      // Native Linux lease has two 15s subprocess limits; Windows ACL/lease
      // has 215s of declared test limits; owner bootstrap has 245s.
      // Bound aggregate overhead separately, without weakening assertions.
      timeout: index === 13 ? 100000
        : index === 14 ? (part === 0 ? 55000 : 65000)
        : index === 16 ? 60000
        : index === 17 ? 240000
        : index === 19 ? 270000
        : 30000
    });
    if (result.error) {
      process.stderr.write('V012_SOURCE_REGRESSION_RUNNER_FAILED batch=' + (index + 1) +
        ' partition=' + (part + 1) + ': ' + result.error.message + '\n');
      process.exitCode = 1;
      break;
    }
    if (result.signal || result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
  if (process.exitCode) break;
  process.stdout.write('V012_SOURCE_REGRESSION_BATCH_PASS_' + (index + 1) + '/' + batches.length + '\n');
}
