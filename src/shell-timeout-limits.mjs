// Shared fail-closed numeric bounds for both current and legacy Power Shell routes.
// Prevent non-finite durations and implicit coercion from reaching OS/Node timers.
export const MAX_POWER_SHELL_TIMEOUT_MS = 3_600_000;

export function boundedPowerShellTimeout(requested, configured = 300_000) {
  if (!Number.isSafeInteger(configured) || configured < 1_000
    || configured > MAX_POWER_SHELL_TIMEOUT_MS)
    throw new Error('POWER_SHELL_TIMEOUT_POLICY_INVALID');

  if (requested === undefined || requested === null) return configured;
  if (!Number.isSafeInteger(requested) || requested < 1
    || requested > MAX_POWER_SHELL_TIMEOUT_MS)
    throw new Error('POWER_SHELL_TIMEOUT_INVALID');
  return Math.max(1_000, Math.min(requested, configured));
}
