// V2-only G1 composition: operator-approved OAuth + verified ChatGPT mTLS
// + owner-native signed invocations. Importing this module opens no listener.
// Never use a V1 route, profile, tunnel, credential or default fallback here.
import {validateV2OAuthProvider} from './v2-oauth-provider-preflight.mjs';
import {createV2JwksTokenVerifier} from './v2-oauth-jwks.mjs';
import {createV2CandidateMcpDispatcher} from './v2-mcp-workflow-dispatcher.mjs';
import {createV2CandidateDirectHttpsGateway} from './v2-mcp-http-ingress.mjs';

function deny(code){throw Object.assign(new Error(code),{code});}

/**
 * Compose the independent V2 authenticated resource server without binding it.
 *
 * Provision separately: a real operator-approved OAuth issuer, an HTTPS server
 * identity, and owner-native functions that verify per-chat/session consent and
 * sign exact action-bound assertions. No synthetic chat identity is acceptable.
 *
 * This intentionally never calls listen() or creates accounts, keys, tunnels,
 * routes, grants, OAuth sessions or persistent services.
 */
export function createV2AuthenticatedOwnerGateway({
  resource,issuer,providerMetadata,clientRegistration='client-id-metadata',
  scopes=['commander.workflow'],certificatePem,privateKeyPem,
  assertionTrust,workflowStore,grantRegistry,
  resolvePrincipal,observedNativeSession,resolveTrustedInvocation,
  authorizeTool,dispatch,loadAuthenticatedProfile,
  now=Date.now,request=fetch
}={}){
  if(typeof now!=='function'||typeof request!=='function'
    ||!assertionTrust||!workflowStore||!grantRegistry
    ||[resolvePrincipal,observedNativeSession,resolveTrustedInvocation,
        authorizeTool,dispatch].some(fn=>typeof fn!=='function')
    ||(loadAuthenticatedProfile!==undefined
      &&typeof loadAuthenticatedProfile!=='function'))
    deny('V2_OWNER_BOOTSTRAP_DEPENDENCIES_REQUIRED');
  const approved=validateV2OAuthProvider({
    issuer,resource,metadata:providerMetadata,
    clientRegistration,requiredScopes:scopes
  });
  // No inferred issuer, audience, signing keys or OAuth principal.
  const verifyAccessToken=createV2JwksTokenVerifier({
    issuer:approved.issuer,audience:approved.audience,
    jwksUri:approved.jwksUri,request,now
  });
  const gateway=createV2CandidateDirectHttpsGateway({
    resource:approved.audience,
    authorizationServers:[approved.issuer],
    scopes:approved.scopes,
    certificatePem,privateKeyPem,now,
    sessionSource:'openai/session',
    // Only a certificate-verified ChatGPT session namespace reaches the owner.
    // This callback MUST resolve native bindings and authorize exact actions;
    // mere possession of an OAuth bearer or a string session ID is insufficient.
    dispatcherFactory:async({authenticated,sessionHandle})=>{
      if(authenticated!==true||typeof sessionHandle!=='string')
        deny('V2_OWNER_SESSION_ATTESTATION_REQUIRED');
      return createV2CandidateMcpDispatcher({
        resource:approved.audience,authorizationServers:[approved.issuer],
        issuer:approved.issuer,audience:approved.audience,
        scopes:approved.scopes,assertionTrust,verifyAccessToken,
        resolvePrincipal,observedNativeSession,
        resolveTrustedInvocation:action=>resolveTrustedInvocation(
          Object.freeze({sessionHandle,action})
        ),
        workflowStore,grantRegistry,authorizeTool,dispatch,
        loadAuthenticatedProfile,now
      });
    }
  });
  return Object.freeze({
    ...gateway,
    issuer:approved.issuer,
    // This is source composition readiness, NOT authenticated deployment.
    status:'V2_SOURCE_WIRED_NOT_LISTENING'
  });
}
