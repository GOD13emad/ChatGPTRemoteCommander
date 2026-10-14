// Preparatory Work Events authorization policy. It is NOT a JWT verifier or an
// authenticated MCP endpoint. The injected verifier MUST cryptographically
// verify the OAuth access token via a trusted IdP/SDK before returning claims.
// No event method or outbound callback is activated by this module.
const EVENT_SCOPE = 'commander.events.subscribe';
const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const deny = (kind) => new Error(kind);
const isText = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

export function createWorkEventAuthorizer({ issuer, resource, verifyAccessToken, resolveProjectAccess, nowEpochSeconds = () => Math.floor(Date.now() / 1000) } = {}) {
  if (typeof verifyAccessToken !== 'function') throw new Error('verified OAuth token verifier required');
  if (typeof resolveProjectAccess !== 'function') throw new Error('authoritative project access resolver required');
  if (typeof nowEpochSeconds !== 'function') throw new Error('trusted clock function required');
  for (const [name, url] of [['issuer', issuer], ['resource', resource]]) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error(`${name} must be an exact HTTPS URL`); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error(`${name} must be an exact HTTPS URL`);
    }
  }
  return async function authorizeWorkEvent({ accessToken, projectId } = {}) {
    // Reject identifiers before any privileged access or network/IdP call.
    if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) throw deny('forbidden');
    if (typeof accessToken !== 'string' || accessToken.length === 0 || accessToken.length > 16384) throw deny('unauthorized');
    let claims;
    try { claims = await verifyAccessToken(accessToken); } catch { throw deny('unauthorized'); }
    const now = nowEpochSeconds();
    if (!claims || claims.issuer !== issuer || claims.resource !== resource ||
      !isText(claims.subject) || !isText(claims.tenantId) ||
      !Number.isSafeInteger(claims.expiresAt) || !Number.isFinite(now) || claims.expiresAt <= now ||
      !Array.isArray(claims.scopes) || !claims.scopes.includes(EVENT_SCOPE)) throw deny('unauthorized');
    let project;
    try { project = await resolveProjectAccess(projectId); } catch { throw deny('forbidden'); }
    if (!project || project.id !== projectId || project.ownerSubject !== claims.subject ||
      project.ownerIssuer !== claims.issuer || project.tenantId !== claims.tenantId) throw deny('forbidden');
    // ACL lookup may take time: never grant an already-expired credential.
    const postAclNow = nowEpochSeconds();
    if (!Number.isFinite(postAclNow) || claims.expiresAt <= postAclNow) throw deny('unauthorized');
    return Object.freeze({ projectId, eventName: 'operation.completed', ownerSubject: claims.subject, tenantId: claims.tenantId });
  };
}
