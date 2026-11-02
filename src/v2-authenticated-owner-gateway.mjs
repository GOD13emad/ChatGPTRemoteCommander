// V2-only G1 composition: operator-approved OAuth + authenticated OpenAI transport
// (direct ChatGPT mTLS or pinned Secure Tunnel local mTLS) + owner-native assertions.
// Importing this module opens no listener; no transport certificate alone authorizes a user.
// Never use a V1 route, profile, tunnel, credential or default fallback here.
import {validateV2OAuthProvider} from './v2-oauth-provider-preflight.mjs';
import {createV2JwksTokenVerifier} from './v2-oauth-jwks.mjs';
import {createV2CandidateMcpDispatcher} from './v2-mcp-workflow-dispatcher.mjs';
import {createV2CandidateDirectHttpsGateway,createV2CandidateSecureTunnelHttpsGateway} from './v2-mcp-http-ingress.mjs';
import {readV2OwnerWorkflowSummary} from './v2-owner-workflow-inventory.mjs';

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
  scopes=['commander.workflow'],transportMode='direct-openai-mtls',
  certificatePem,privateKeyPem,serverCertificatePem,serverPrivateKeyPem,
  clientCaPem,clientCaDerSha256,clientCertificateSha256,
  expectedServerDns='localhost',expectedClientDns='commander-v2-tunnel-client',
  assertionTrust,workflowStore,grantRegistry,
  resolvePrincipal,observedNativeSession,resolveTrustedInvocation,
  authorizeTool,dispatch,loadAuthenticatedProfile,
  ownerWorkflowSessions,ownerWorkflowObservedCaller,authorizeWorkflowRead,
  now=Date.now,request=fetch
}={}){
  if(typeof now!=='function'||typeof request!=='function'
    ||!assertionTrust||!workflowStore||!grantRegistry
    ||[resolvePrincipal,observedNativeSession,resolveTrustedInvocation,
        authorizeTool,dispatch].some(fn=>typeof fn!=='function')
    ||(loadAuthenticatedProfile!==undefined
      &&typeof loadAuthenticatedProfile!=='function'))
    deny('V2_OWNER_BOOTSTRAP_DEPENDENCIES_REQUIRED');
  const ownerReadDependencies=[ownerWorkflowSessions,ownerWorkflowObservedCaller,authorizeWorkflowRead];
  const readEnabled=ownerReadDependencies.every(x=>x!==undefined);
  if(!readEnabled && ownerReadDependencies.some(x=>x!==undefined))
    deny('V2_OWNER_WORKFLOW_READ_DEPENDENCIES_INCOMPLETE');
  if(readEnabled && (typeof ownerWorkflowSessions?.resolveNativeRoute!=='function'
      ||typeof ownerWorkflowObservedCaller!=='function'
      ||typeof authorizeWorkflowRead!=='function'))
    deny('V2_OWNER_WORKFLOW_READ_TRUSTED_CALLBACKS_REQUIRED');
  const approved=validateV2OAuthProvider({
    issuer,resource,metadata:providerMetadata,
    clientRegistration,requiredScopes:scopes
  });
  // No inferred issuer, audience, signing keys or OAuth principal.
  const verifyAccessToken=createV2JwksTokenVerifier({
    issuer:approved.issuer,audience:approved.audience,
    jwksUri:approved.jwksUri,request,now
  });
  const dispatcherFactory=async({authenticated,sessionHandle})=>{
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
        loadAuthenticatedProfile,
        readTrustedWorkflowSummary:readEnabled?async({principalId})=>
          readV2OwnerWorkflowSummary({
            sessionHandle,expectedPrincipalId:principalId,
            sessions:ownerWorkflowSessions,observedCaller:ownerWorkflowObservedCaller,
            grants:grantRegistry,workflowStore,authorizeRead:authorizeWorkflowRead
          }):undefined,now
      });
    };
  let gateway;
  const common={resource:approved.audience,authorizationServers:[approved.issuer],
    scopes:approved.scopes,dispatcherFactory,now};
  if(transportMode==='direct-openai-mtls'){
    gateway=createV2CandidateDirectHttpsGateway({...common,certificatePem,privateKeyPem,
      sessionSource:'openai/session'});
  }else if(transportMode==='openai-secure-mcp-tunnel'){
    gateway=createV2CandidateSecureTunnelHttpsGateway({...common,
      serverCertificatePem,serverPrivateKeyPem,clientCaPem,clientCaDerSha256,
      clientCertificateSha256,expectedServerDns,expectedClientDns});
  }else deny('V2_OWNER_TRANSPORT_MODE_UNSUPPORTED');
  return Object.freeze({
    ...gateway,
    issuer:approved.issuer,
    // This is source composition readiness, NOT authenticated deployment.
    status:'V2_SOURCE_WIRED_NOT_LISTENING'
  });
}
