import test from 'node:test';
import assert from 'node:assert/strict';
import { validateV2OAuthProvider } from '../src/v2-oauth-provider-preflight.mjs';
import { createV2JwksTokenVerifier } from '../src/v2-oauth-jwks.mjs';
const issuer='https://idp.example.test/tenant';
const resource='https://commander.example.test/mcp';
const md={
 issuer, authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',
 jwks_uri:issuer+'/keys',response_types_supported:['code'],
 grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],
 scopes_supported:['commander.workflow'],client_id_metadata_document_supported:true,
 token_endpoint_auth_methods_supported:['none','private_key_jwt'],
 registration_endpoint:issuer+'/register'
};
const call=(changes={},config={})=>validateV2OAuthProvider({
 issuer,resource,metadata:{...md,...changes},...config
});
test('pre-registered OAuth provider metadata creates pinned JWT configuration',()=>{
 const result=call();
 assert.equal(result.issuer,issuer);
 assert.equal(result.audience,resource);
 assert.equal(result.jwksUri,md.jwks_uri);
 assert.equal(result.scope,'commander.workflow');
 assert.equal(result.claimOfAuthenticatedChat,false);
 assert.equal(typeof createV2JwksTokenVerifier({
    issuer:result.issuer,audience:result.audience,jwksUri:result.jwksUri
 }), 'function');
});
test('issuer mismatch and legacy insecure HTTP endpoints fail closed',()=>{
 assert.throws(()=>call({issuer:'https://other-idp.example.test'}),{code:'V2_PROVIDER_ISSUER_MISMATCH'});
 for(const field of ['authorization_endpoint','token_endpoint','jwks_uri']){
   assert.throws(()=>call({[field]:'http://127.0.0.1/private'}),{code:'V2_PROVIDER_HTTPS_REQUIRED'});
 }
});
test('authorization code grant and code response type are mandatory',()=>{
 assert.throws(()=>call({response_types_supported:['token']}),{code:'V2_PROVIDER_CODE_FLOW_REQUIRED'});
 assert.throws(()=>call({grant_types_supported:['client_credentials']}),{code:'V2_PROVIDER_CODE_FLOW_REQUIRED'});
 assert.equal(call({grant_types_supported:undefined}).claimOfAuthenticatedChat,false);
});
test('OAuth provider without explicit S256 PKCE support is rejected',()=>{
 for(const methods of [undefined,[],['plain']]){
   assert.throws(()=>call({code_challenge_methods_supported:methods}),{code:'V2_PROVIDER_PKCE_S256_REQUIRED'});
 }
});
test('requested Commander scope must be advertised when metadata lists scopes',()=>{
 assert.throws(()=>call({scopes_supported:['read']}),{code:'V2_PROVIDER_SCOPE_NOT_ADVERTISED'});
 assert.equal(call({scopes_supported:undefined}).scope,'commander.workflow');
});
test('unsupported client registration modes are not guessed',()=>{
 assert.throws(()=>call({}, {clientRegistration:'unknown'}),{code:'V2_PROVIDER_CLIENT_REGISTRATION_REQUIRED'});
 assert.equal(call({}, {clientRegistration:'client-id-metadata'}).clientRegistration,'client-id-metadata');
 assert.throws(()=>call({client_id_metadata_document_supported:false},{clientRegistration:'client-id-metadata'}),
  {code:'V2_PROVIDER_CIMD_UNSUPPORTED'});
 assert.equal(call({}, {clientRegistration:'dynamic'}).clientRegistration,'dynamic');
 assert.throws(()=>call({registration_endpoint:undefined},{clientRegistration:'dynamic'}),
  {code:'V2_PROVIDER_REGISTRATION_UNAVAILABLE'});
});
test('issuer and audience are pinned identifiers rather than derived from HTTP request',()=>{
 assert.throws(()=>call({issuer:'https://idp.example.test/tenant/' }),
   {code:'V2_PROVIDER_ISSUER_MISMATCH'});
 assert.throws(()=>call({}, {resource:'http://localhost:1234/mcp'}),
   {code:'V2_PROVIDER_HTTPS_REQUIRED'});
});
test('malformed and header-injected provider URLs are rejected',()=>{
 assert.throws(()=>call({authorization_endpoint:'https://idp.example.test/auth\r\nX-Forged:yes'}),
   {code:'V2_PROVIDER_HTTPS_REQUIRED'});
 assert.throws(()=>call({jwks_uri:'https://u:p@idp.example.test/keys'}),
   {code:'V2_PROVIDER_HTTPS_REQUIRED'});
 assert.throws(()=>call({token_endpoint:'https://idp.example.test/token?q=steal'}),
   {code:'V2_PROVIDER_HTTPS_REQUIRED'});
});
test('token exchange methods must be published and compatible with ChatGPT client mode',()=>{
 for(const value of [undefined,[],['tls_client_auth'],['none',7]]){
  assert.throws(()=>call({token_endpoint_auth_methods_supported:value}),
   {code:'V2_PROVIDER_TOKEN_AUTH_METHOD_UNSUPPORTED'});
 }
 assert.deepEqual(call().tokenEndpointAuthMethods,['none','private_key_jwt']);
 assert.throws(()=>call({token_endpoint_auth_methods_supported:['client_secret_basic']},
   {clientRegistration:'client-id-metadata'}),
  {code:'V2_PROVIDER_CIMD_TOKEN_AUTH_METHOD_UNSUPPORTED'});
 assert.deepEqual(call({token_endpoint_auth_methods_supported:['client_secret_basic']}).tokenEndpointAuthMethods,
  ['client_secret_basic']);
});
test('multi-scope OAuth preflight rejects an IdP missing any required scope',()=>{
 const requiredScopes=['commander.workflow','commander.seat'];
 assert.throws(()=>call({}, {requiredScopes}),{code:'V2_PROVIDER_SCOPE_NOT_ADVERTISED'});
 const accepted=call({scopes_supported:requiredScopes},{requiredScopes});
 assert.deepEqual(accepted.scopes,requiredScopes);
 assert.equal(accepted.scope,'commander.workflow');
 assert.equal(Object.isFrozen(accepted.scopes),true);
 assert.deepEqual(call({scopes_supported:undefined},{requiredScopes}).scopes,requiredScopes);
 for(const invalid of [[],['commander.workflow','commander.workflow'],
   ['commander.workflow','bad scope'],['commander.workflow',42],
   ['commander.workflow', '\\r\\nInjected']]){
  assert.throws(()=>call({scopes_supported:requiredScopes},{requiredScopes:invalid}),
    {code:'V2_PROVIDER_SCOPE_INVALID'});
 }
});
