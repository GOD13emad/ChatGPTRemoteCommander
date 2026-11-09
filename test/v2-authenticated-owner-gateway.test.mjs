import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2AuthenticatedOwnerGateway} from '../src/v2-authenticated-owner-gateway.mjs';

const issuer='https://issuer.example.test';
const resource='https://commander-v2.example.test/mcp-v2';
const now=()=>Date.parse('2026-10-30T12:00:00Z');
const metadata={
  issuer,
  authorization_endpoint:issuer+'/authorize',
  token_endpoint:issuer+'/token',
  jwks_uri:issuer+'/jwks',
  response_types_supported:['code'],
  grant_types_supported:['authorization_code'],
  code_challenge_methods_supported:['S256'],
  client_id_metadata_document_supported:true,
  authorization_response_iss_parameter_supported:true,
  token_endpoint_auth_methods_supported:['none'],
  scopes_supported:['commander.workflow']
};
let sideEffects=0;
const options={
  issuer,resource,providerMetadata:metadata,now,
  certificatePem:'-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----',
  privateKeyPem:['-----BEGIN ','PRIVATE KEY-----\nfixture\n-----END ','PRIVATE KEY-----'].join(''),
  assertionTrust:{issuer:'owner'},
  workflowStore:{},grantRegistry:{},
  resolvePrincipal:async()=> 'owner',
  observedNativeSession:async()=> 'owner-seat',
  resolveTrustedInvocation:async()=>{sideEffects++;return null;},
  authorizeTool:async()=>false,
  dispatch:async()=>{sideEffects++;return null;}
};
test('V2 OAuth + JWT + signed owner gateway composes without opening any listener or side effects',()=>{
  const gateway=createV2AuthenticatedOwnerGateway(options);
  assert.equal(gateway.status,'V2_SOURCE_WIRED_NOT_LISTENING');
  assert.equal(gateway.requiredTransport,'direct-openai-mtls');
  assert.equal(gateway.issuer,issuer);
  assert.equal(gateway.protectedResource.body.resource,resource);
  assert.deepEqual(gateway.protectedResource.body.authorization_servers,[issuer]);
  assert.deepEqual(gateway.protectedResource.body.scopes_supported,['commander.workflow']);
  assert.equal(typeof gateway.createUnboundTlsServer,'function');
  assert.equal(sideEffects,0);
});
test('no validated owner session resolver or native grants means no gateway',()=>{
  for(const key of ['resolvePrincipal','observedNativeSession',
    'resolveTrustedInvocation','authorizeTool','dispatch',
    'assertionTrust','workflowStore','grantRegistry']){
    assert.throws(()=>createV2AuthenticatedOwnerGateway({...options,[key]:undefined}),
      {code:'V2_OWNER_BOOTSTRAP_DEPENDENCIES_REQUIRED'});
  }
  assert.equal(sideEffects,0);
});
test('unapproved issuer, missing PKCE and unsupported CIMD fail before TLS or any effect',()=>{
  assert.throws(()=>createV2AuthenticatedOwnerGateway({
    ...options,providerMetadata:{...metadata,issuer:'https://foreign.example.test'}
  }),{code:'V2_PROVIDER_ISSUER_MISMATCH'});
  assert.throws(()=>createV2AuthenticatedOwnerGateway({
    ...options,providerMetadata:{...metadata,code_challenge_methods_supported:[]}
  }),{code:'V2_PROVIDER_PKCE_S256_REQUIRED'});
  assert.throws(()=>createV2AuthenticatedOwnerGateway({
    ...options,providerMetadata:{...metadata,client_id_metadata_document_supported:false}
  }),{code:'V2_PROVIDER_CIMD_UNSUPPORTED'});
  assert.equal(sideEffects,0);
});
test('without independent HTTPS server certificate or private key V2 remains disabled',()=>{
  assert.throws(()=>createV2AuthenticatedOwnerGateway({
    ...options,certificatePem:undefined
  }),{code:'V2_HTTPS_SERVER_IDENTITY_REQUIRED'});
  assert.throws(()=>createV2AuthenticatedOwnerGateway({
    ...options,privateKeyPem:undefined
  }),{code:'V2_HTTPS_SERVER_IDENTITY_REQUIRED'});
  assert.equal(sideEffects,0);
});
test('scope sets are validated at the IdP before an MCP dispatcher can be built',()=>{
  assert.throws(()=>createV2AuthenticatedOwnerGateway({
    ...options,scopes:['commander.workflow','commander.gui']
  }),{code:'V2_PROVIDER_SCOPE_NOT_ADVERTISED'});
  assert.equal(sideEffects,0);
});
