// Measured authorization surface: never equate application capability with OS privileges.
export function assessFullPowerReadiness({
  config = {}, workflowStatus = {},
  platform = process.platform,
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  nativeEvidence = {}
} = {}) {
  const tier = config.capabilityProfile?.tier === 'FULL_POWER' ? 'FULL_POWER' : 'STANDARD';
  const approved = config.capabilityProfile?.explicitlyAuthorized === true;
  const enabled = config.powerMode?.enabled === true;
  const disabled = Array.isArray(config.capabilityProfile?.disabledCapabilities)
    ? [...new Set(config.capabilityProfile.disabledCapabilities.filter(x => typeof x === 'string'))].sort()
    : [];
  const allCapabilitiesConfigured = tier === 'FULL_POWER' && approved && enabled && disabled.length === 0;
  const osPrivilege = platform === 'win32'
    ? { level: nativeEvidence.windowsElevation === true ? 'ELEVATED' : 'NOT_VERIFIED',
        elevated: nativeEvidence.windowsElevation === true ? true : null,
        nativeVerificationRequired: nativeEvidence.windowsElevation !== true }
    : typeof uid === 'number'
      ? { level: uid === 0 ? 'ROOT' : 'USER', elevated: uid === 0, nativeVerificationRequired: uid !== 0 }
      : { level: 'NOT_VERIFIED', elevated: null, nativeVerificationRequired: true };
  const guiConfigured = enabled && config.powerMode?.guiControl?.enabled === true;
  const browserConfigured = enabled && config.powerMode?.browserControl?.enabled === true;
  const userSessionsVerified = nativeEvidence.everyProfileAuthorized === true;
  const guiBackgroundProven = nativeEvidence.guiBackgroundControlE2E === true;
  const browserSessionProven = nativeEvidence.browserSameSessionE2E === true;
  const unmetGates = [];
  if (!allCapabilitiesConfigured) unmetGates.push('DISABLED_APPLICATION_CAPABILITIES');
  if (osPrivilege.nativeVerificationRequired) unmetGates.push('NATIVE_OS_ELEVATION');
  if (guiConfigured && !guiBackgroundProven) unmetGates.push('GUI_BACKGROUND_CONTROL_E2E');
  if (browserConfigured && !browserSessionProven) unmetGates.push('BROWSER_SAME_SESSION_E2E');
  if (!userSessionsVerified) unmetGates.push('PER_USER_SESSION_AUTHORIZATION');
  if (workflowStatus.runnerConfigured !== true) unmetGates.push('WORKFLOW_RUNNER_CONFIGURED');
  const fullyProven = allCapabilitiesConfigured && unmetGates.length === 0;
  const blocked = !allCapabilitiesConfigured;
  const operationalStatus = blocked ? 'BLOCKED' : fullyProven ? 'READY' : 'UNVERIFIED';
  const workflow = {
    configured: workflowStatus.runnerConfigured === true,
    automaticExecution: workflowStatus.automaticExecution === true
  };
  const userSessions = {
    everyProfileAuthorized: userSessionsVerified ? 'VERIFIED' : 'NOT_VERIFIED',
    sameSessionConsent: userSessionsVerified ? 'VERIFIED' : 'REQUIRED'
  };
  const gui = {
    configured: guiConfigured,
    runtime: 'CHECK_gui_status',
    backgroundControlProven: guiBackgroundProven ? 'VERIFIED' : 'NOT_VERIFIED'
  };
  const browser = {
    configured: browserConfigured,
    runtime: 'CHECK_browser_status',
    existingProfileConsent: browserSessionProven ? 'VERIFIED' : 'REQUIRED'
  };
  return {
    schema: 2,
    definition: 'APPLICATION_CAPABILITY_AUTHORIZATION_NOT_OS_PRIVILEGE',
    tier,
    capabilitiesConfigured: tier === 'FULL_POWER' && approved && enabled,
    allCapabilitiesConfigured,
    allCapabilitiesEnabled: fullyProven,
    operationalStatus,
    unmetGates,
    disabledCapabilities: disabled,
    osPrivilege,
    userSessions,
    gui,
    browser,
    workflow,
    fleetReady: false,
    next: 'VERIFY_NATIVE_OS_PRIVILEGE_GUI_BROWSER_AND_PER_USER_SESSION_EVIDENCE'
  };
}
