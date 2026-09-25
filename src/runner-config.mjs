export const PROJECT_RUNNER_LIMITS = Object.freeze({
  timeoutMinMs: 10,
  configuredTimeoutMaxMs: 600000,
  effectiveTimeoutMaxMs: 30000,
  maxOutputMinBytes: 64,
  maxOutputMaxBytes: 16 * 1024 * 1024,
  defaultTimeoutMs: 30000,
  defaultMaxOutputBytes: 2 * 1024 * 1024
});

function boundedInteger(value, fallback, min, max, code) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(code);
  return n;
}

export function enableProjectRunner(config, {
  executable,
  kind = 'codex',
  autoTick = true,
  timeoutMs = PROJECT_RUNNER_LIMITS.defaultTimeoutMs,
  maxOutputBytes = PROJECT_RUNNER_LIMITS.defaultMaxOutputBytes
}) {
  if (!config?.durableWorkflows || config.durableWorkflows.enabled !== true) {
    throw new Error('PROJECT_RUNNER_REQUIRES_DURABLE_WORKFLOWS');
  }
  if (!['codex', 'command'].includes(kind)) throw new Error('PROJECT_RUNNER_KIND');
  if (typeof executable !== 'string' || !executable.trim()) throw new Error('PROJECT_RUNNER_EXECUTABLE');
  const configuredTimeoutMs = boundedInteger(
    timeoutMs, PROJECT_RUNNER_LIMITS.defaultTimeoutMs,
    PROJECT_RUNNER_LIMITS.timeoutMinMs, PROJECT_RUNNER_LIMITS.configuredTimeoutMaxMs,
    'PROJECT_RUNNER_TIMEOUT'
  );
  const configuredMaxOutputBytes = boundedInteger(
    maxOutputBytes, PROJECT_RUNNER_LIMITS.defaultMaxOutputBytes,
    PROJECT_RUNNER_LIMITS.maxOutputMinBytes, PROJECT_RUNNER_LIMITS.maxOutputMaxBytes,
    'PROJECT_RUNNER_OUTPUT_LIMIT'
  );
  const previous = config.durableWorkflows.runner ?? {};
  config.durableWorkflows.runner = {
    ...previous,
    enabled: true,
    autoTick: autoTick === true,
    provider: {
      ...(previous.provider ?? {}),
      kind,
      executable,
      timeoutMs: configuredTimeoutMs,
      maxOutputBytes: configuredMaxOutputBytes
    },
    allowedTools: previous.allowedTools ?? ['list_directory','read_text','file_info','write_text','create_directory'],
    maxActions: previous.maxActions ?? 32,
    maxDurationMs: previous.maxDurationMs ?? 300000,
    maxPlannerCalls: previous.maxPlannerCalls ?? 128,
    adaptive: previous.adaptive ?? { enabled: true, maxExtensions: 4 },
    team: previous.team ?? {
      workers: [
        { id: 'builder', role: 'Propose the safest bounded next step using current evidence.' },
        { id: 'reviewer', role: 'Check missing prerequisites, evidence and failure risks before the coordinator acts.' }
      ],
      maxParallel: 2
    },
    worker: previous.worker ?? { enabled: true, maxArtifactBytes: 65536 }
  };
  return config.durableWorkflows.runner;
}

export function disableProjectRunner(config) {
  if (!config?.durableWorkflows) throw new Error('PROJECT_RUNNER_REQUIRES_DURABLE_WORKFLOWS');
  config.durableWorkflows.runner ??= {};
  config.durableWorkflows.runner.enabled = false;
  config.durableWorkflows.runner.autoTick = false;
  return config.durableWorkflows.runner;
}
