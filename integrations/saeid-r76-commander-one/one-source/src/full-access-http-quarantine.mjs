/**
 * Fail-closed quarantine for legacy unauthenticated MCP HTTP on a worker
 * that could perform protected OS actions.
 *
 * This is deliberately NOT an authentication protocol. Only a separately
 * authenticated V2 ingress with owner-bound signed action grants may serve
 * commands on a privileged worker. Until that ingress is deployed, the
 * legacy /mcp dispatcher must never receive a protected request.
 */
export function legacyPrivilegedMcpQuarantine({
  platform = process.platform, configuredTier = 'STANDARD',
  effectiveUid = null, windowsAdminToken = null
} = {}) {
  const privilegedConfig = configuredTier === 'FULL_ACCESS';
  let privilegedProcess = false;
  let tokenUncertain = false;
  if (platform === 'linux') {
    privilegedProcess = effectiveUid === 0;
    tokenUncertain = !Number.isSafeInteger(effectiveUid) || effectiveUid < 0;
  } else if (platform === 'win32') {
    const proof = windowsAdminToken;
    const trustedProof = proof?.ok === true && proof?.source === 'local-process-token';
    privilegedProcess = trustedProof && proof?.isAdmin === true && proof?.elevation === 'high';
    const verifiedFiltered = trustedProof && proof?.isAdmin === false && proof?.elevation === 'filtered';
    // Only the probe's two complete typed tuples are evidence. A failed,
    // partial, differently sourced or inconsistent answer is never filtered.
    tokenUncertain = !privilegedProcess && !verifiedFiltered;
  } else {
    tokenUncertain = true;
  }
  const quarantine = privilegedConfig || privilegedProcess || tokenUncertain;
  return Object.freeze({
    quarantine,
    code: quarantine ? 'TRUSTED_V2_INGRESS_REQUIRED' : 'LEGACY_OWNER_TOKEN_ONLY',
    privilegedProcess,
    tokenUncertain
  });
}

/** No extra headers from HTTP clients can override this boundary. */
export function rejectLegacyPrivilegedMcp(req, res, decision) {
  if (decision?.quarantine !== true) return false;
  // Call after existing Host/Origin request admission and after /health.
  const body = Buffer.from(JSON.stringify({error:'trusted_transport_required'}));
  res.writeHead(403, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length
  });
  res.end(body);
  return true;
}
