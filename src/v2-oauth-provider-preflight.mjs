// V2-G1: pure validation of an operator-approved OAuth authorization server's
// RFC8414/OIDC metadata before any ChatGPT MCP activation. No token issuance,
// user consent, HTTP listener, client credentials, or live discovery occurs here.
// The issuer and expected resource audience MUST be pinned out of band.
function fail(code){throw Object.assign(new Error(code),{code});}
function https(value){
  if(typeof value!=='string'||value.length>2048||/[\u0000-\u001f\\]/.test(value))
    fail('V2_PROVIDER_HTTPS_REQUIRED');
  let url;
  try{url=new URL(value);}catch{fail('V2_PROVIDER_HTTPS_REQUIRED');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password
    ||url.search||url.hash||url.port && url.port!=='443')
    fail('V2_PROVIDER_HTTPS_REQUIRED');
  return value; // preserve exact issuer identity, including optional slash
}
function includesString(values,required){
  return Array.isArray(values)&&values.includes(required)&&values.every(v=>typeof v==='string');
}
/** Returns only the verified public metadata needed by the OAuth JWT boundary. */
export function validateV2OAuthProvider({
  issuer,resource,metadata,requiredScope='commander.workflow',
  clientRegistration='pre-registered'
}){
  const trustedIssuer=https(issuer),audience=https(resource);
  if(typeof requiredScope!=='string'||!/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(requiredScope))
    fail('V2_PROVIDER_SCOPE_INVALID');
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))
    fail('V2_PROVIDER_METADATA_REQUIRED');
  if(metadata.issuer!==trustedIssuer)fail('V2_PROVIDER_ISSUER_MISMATCH');
  const authorizationEndpoint=https(metadata.authorization_endpoint);
  const tokenEndpoint=https(metadata.token_endpoint);
  const jwksUri=https(metadata.jwks_uri);
  if(!includesString(metadata.response_types_supported,'code'))
    fail('V2_PROVIDER_CODE_FLOW_REQUIRED');
  if(metadata.grant_types_supported!==undefined
    && !includesString(metadata.grant_types_supported,'authorization_code'))
    fail('V2_PROVIDER_CODE_FLOW_REQUIRED');
  // MCP clients require an explicit S256 capability; absence is a hard failure.
  if(!includesString(metadata.code_challenge_methods_supported,'S256'))
    fail('V2_PROVIDER_PKCE_S256_REQUIRED');
  if(metadata.scopes_supported!==undefined
    && !includesString(metadata.scopes_supported,requiredScope))
    fail('V2_PROVIDER_SCOPE_NOT_ADVERTISED');
  if(!['pre-registered','client-id-metadata','dynamic'].includes(clientRegistration))
    fail('V2_PROVIDER_CLIENT_REGISTRATION_REQUIRED');
  if(clientRegistration==='client-id-metadata'
    && metadata.client_id_metadata_document_supported!==true)
    fail('V2_PROVIDER_CIMD_UNSUPPORTED');
  if(clientRegistration==='dynamic'&&typeof metadata.registration_endpoint!=='string')
    fail('V2_PROVIDER_REGISTRATION_UNAVAILABLE');
  if(clientRegistration==='dynamic')https(metadata.registration_endpoint);
  return Object.freeze({
    issuer:trustedIssuer,audience,
    authorizationEndpoint,tokenEndpoint,jwksUri,
    scope:requiredScope,clientRegistration,
    // A positive preflight is not user authorization or authenticated chat identity.
    claimOfAuthenticatedChat:false
  });
}
