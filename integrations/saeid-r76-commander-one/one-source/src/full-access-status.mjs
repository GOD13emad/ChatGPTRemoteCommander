import { requestPrivilegeBroker } from './privilege-client.mjs';
import { probeWindowsAdministrator } from './windows-admin-token.mjs';

const BROKER_ACTIONS = Object.freeze({
  linux: Object.freeze(['os.probe', 'system_unit.status', 'system_unit.start']),
  win32: Object.freeze(['os.probe', 'broker.task.status'])
});

export function verifyPrivilegedBrokerProof(proof, platform = process.platform) {
  if (proof?.ok !== true || proof.action !== 'os.probe') return false;
  if (platform === 'linux') return proof.root === true && proof.effectiveUid === 0;
  if (platform === 'win32') return proof.isSystem === true && proof.sid === 'S-1-5-18';
  return false;
}

/**
 * Configured tier expresses owner intent; effective tier is determined at
 * runtime. A broker grants only its documented fixed operations, never a
 * generic elevated shell. STANDARD is never auto-promoted by broker presence.
 */
export function assessAccessStatus(config, proof, {
  platform = process.platform, adminToken = null,
  // Never infer native root from the broker's separate root process.
  effectiveUid = platform === 'linux' ? process.geteuid?.() : null
} = {}) {
  const profile = config?.capabilityProfile ?? {};
  const configuredTier = ['STANDARD', 'FULL_POWER', 'FULL_ACCESS'].includes(profile.tier)
    ? profile.tier : (config?.powerMode?.enabled ? 'FULL_POWER' : 'STANDARD');
  const nativeBrokerVerified = verifyPrivilegedBrokerProof(proof, platform);
  const grantedByOwner = profile.explicitlyAuthorized === true;
  const fullPowerEnabled = config?.powerMode?.enabled === true;
  // Native SYSTEM/root broker identity does not imply a shell grant.
  // On Windows, an actual elevated token on this *same worker* does.
  // Restricted shell policy or restricted filesystem still disqualifies it.
  const nativeAdminTokenVerified = platform === 'win32' &&
    adminToken?.ok === true && adminToken?.isAdmin === true &&
    adminToken?.elevation === 'high' && adminToken?.source === 'local-process-token';
  // This worker must itself be root. A root broker with a UID 1000 worker
  // is only a fixed-action helper, never an unrestricted root shell.
  const nativeRootTokenVerified = platform === 'linux' && effectiveUid === 0;
  const pm = config?.powerMode ?? {};
  const hostFilesystem = fullPowerEnabled && configuredTier !== 'STANDARD' &&
    grantedByOwner && pm.fullFilesystem === true;
  const shellAvailable = fullPowerEnabled && configuredTier !== 'STANDARD' &&
    grantedByOwner && pm.allowShell === true;
  const noCommanderShellPatternRestrictions = shellAvailable &&
    Array.isArray(pm.blockedShellPatterns) && pm.blockedShellPatterns.length === 0;
  const hostUserAccess = hostFilesystem && noCommanderShellPatternRestrictions;
  const adminShellScope = pm.allowShell === true && pm.fullFilesystem === true &&
    pm.allowProcessControl === true && Array.isArray(pm.blockedShellPatterns) &&
    pm.blockedShellPatterns.length === 0;
  const operationalFullAccess = (nativeAdminTokenVerified || nativeRootTokenVerified) && adminShellScope;
  const fullAccessActive = configuredTier === 'FULL_ACCESS' && grantedByOwner &&
    fullPowerEnabled && operationalFullAccess;
  const effectiveTier = !fullPowerEnabled || configuredTier === 'STANDARD' ? 'STANDARD'
    : fullAccessActive ? 'FULL_ACCESS' : 'FULL_POWER';
  // Report the first real enrollment prerequisite, including missing owner
  // consent and disabled Power Mode. Do not treat a healthy broker as an OS
  // privilege grant on the current worker.
  const fullAccessBlocker = configuredTier !== 'FULL_ACCESS' || fullAccessActive ? null
    : !grantedByOwner ? 'FULL_ACCESS_OWNER_GRANT_REQUIRED'
    : !fullPowerEnabled ? 'POWER_MODE_DISABLED'
    : platform === 'win32' ? (!nativeAdminTokenVerified
      ? 'WINDOWS_ADMIN_TOKEN_NOT_ELEVATED' : 'FULL_ACCESS_SHELL_SCOPE_REQUIRED')
    : platform === 'linux' ? (!nativeRootTokenVerified
      ? 'LINUX_ROOT_PROCESS_NOT_ELEVATED' : 'FULL_ACCESS_SHELL_SCOPE_REQUIRED')
    : 'PRIVILEGED_ACTION_SCOPE_NOT_READY';
  return {
    configuredTier,
    effectiveTier,
    // FULL_HOST_USER is ordinary owner-token command/file access, not
    // operating-system elevation, and is never a protected-action grant.
    hostExecution: {
      mode: hostUserAccess ? 'FULL_HOST_USER' : 'RESTRICTED',
      hostFilesystem,
      shellAvailable,
      noCommanderShellPatternRestrictions,
      osTokenBoundaryApplies: true,
      nativeElevationNotImplied: true,
      externalApprovalsNotBypassed: true
    },
    fullAccessConfigured: configuredTier === 'FULL_ACCESS',
    fullAccessActive,
    operationalFullAccess,
    fullAccessBlocker,
    enrollmentRequired: configuredTier === 'FULL_ACCESS' && !fullAccessActive,
    nativeAdmin: {
      verified: nativeAdminTokenVerified,
      scope: nativeAdminTokenVerified ? 'current-process-token' : 'unverified',
      unrestrictedAdminShell: platform === 'win32' && operationalFullAccess
    },
    nativeRoot: {
      verified: nativeRootTokenVerified,
      scope: nativeRootTokenVerified ? 'current-process-effective-uid' : 'unverified',
      unrestrictedRootShell: platform === 'linux' && operationalFullAccess
    },
    broker: {
      verified: nativeBrokerVerified,
      actionScope: 'fixed-allowlist',
      // The fixed native Broker never grants unrestricted admin shell access;
      // a separately elevated worker belongs to nativeAdmin, not broker.
      operationalFullAccess: false,
      privilegeIdentity: nativeBrokerVerified ? (platform === 'win32' ? 'SYSTEM' : 'root') : null,
      code: nativeBrokerVerified ? 'NATIVE_BROKER_VERIFIED'
        : (typeof proof?.code === 'string' ? proof.code : 'BROKER_NOT_VERIFIED'),
      allowedActions: [...(BROKER_ACTIONS[platform] ?? [])],
      unrestrictedAdminShell: false
    }
  };
}

export function createAccessStatusReader({
  config, platform = process.platform, probe = requestPrivilegeBroker,
  probeWindowsAdmin = probeWindowsAdministrator,
  now = () => Date.now(), ttlMs = 15_000
}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 0 || ttlMs > 120_000) {
    throw new Error('ACCESS_STATUS_CACHE_TTL_INVALID');
  }
  let cached = null;
  let validUntil = 0;
  let pending = null;
  return async function readAccessStatus({ force = false } = {}) {
    const clock = now();
    if (!force && cached && clock < validUntil) return cached;
    if (pending) return pending;
    pending = (async () => {
      let result;
      try { result = await probe('os.probe', { platform }); }
      catch { result = { ok: false, code: 'BROKER_PROBE_FAILED' }; }
      let adminToken = null;
      if (platform === 'win32' && config?.capabilityProfile?.tier === 'FULL_ACCESS') {
        try { adminToken = await probeWindowsAdmin({ platform }); }
        catch { adminToken = {ok:false,code:'WINDOWS_TOKEN_PROBE_FAILED'}; }
      }
      const status = assessAccessStatus(config, result, { platform, adminToken });
      cached = status;
      validUntil = now() + ttlMs;
      return status;
    })();
    try { return await pending; }
    finally { pending = null; }
  };
}
