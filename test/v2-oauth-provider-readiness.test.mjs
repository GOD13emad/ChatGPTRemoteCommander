import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectV2OAuthProvider} from '../src/v2-oauth-provider-readiness.mjs';
// POSIX owner/UID, local HOME and native review fixtures are Linux-specific.
// Windows must exercise its separate owner/Win32 adapters, not emulate POSIX authorization.
const posixTest = process.platform === 'win32' ? test.skip : test;
const issuer='https://id.example.test',resource='https://mmz.example.test/mcp-v2';
const cfg={issuer,resource,metadataUrl:issuer+'/.well-known/oauth-authorization-server',
 scopes:['commander.full'],clientRegistration:'client-id-metadata'};
const metadata={
 issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',
 jwks_uri:issuer+'/keys',response_types_supported:['code'],
 grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],
 scopes_supported:['commander.full'],token_endpoint_auth_methods_supported:['none'],
 authorization_response_iss_parameter_supported:true,
 client_id_metadata_document_supported:true
};
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'v2-provider-readiness-'));
const put=(f,data,mode=0o600)=>{fs.writeFileSync(f,JSON.stringify(data));fs.chmodSync(f,mode)};
const fake=async url=>new Response(JSON.stringify(url.endsWith('/keys')
 ?{keys:[{kid:'test-public'}]}:metadata),{status:200});
posixTest('absent config means BLOCKED and does not trigger network, login or private tools',async()=>{
 const root=dir();try{
  let network=0;
  const s=await inspectV2OAuthProvider({file:path.join(root,'missing.json'),
   request:async()=>{network++},ownerUid:process.getuid()});
  assert.equal(s.status,'BLOCKED_PROVIDER_CONFIG_MISSING');
  assert.equal(s.privateToolsActivated,false);
  assert.equal(network,0);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
posixTest('pinned metadata and public JWKS discovery pass without claiming owner login',async()=>{
 const root=dir(),file=path.join(root,'provider.json');
 try{
  put(file,cfg);
  const urls=[];
  const result=await inspectV2OAuthProvider({file,
   ownerUid:process.getuid(),request:async url=>{urls.push(url);return fake(url)}});
  assert.equal(result.status,'PUBLIC_PROVIDER_DISCOVERY_PASS_OWNER_LOGIN_PENDING');
  assert.equal(result.issuerMetadataVerified,true);
  assert.equal(result.publicSigningKeysPresent,true);
  assert.equal(result.oauthLoginVerified,false);
  assert.equal(result.ownerSessionVerified,false);
  assert.equal(result.privateToolsActivated,false);
  assert.deepEqual(urls,[cfg.metadataUrl,issuer+'/keys']);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
posixTest('world-readable or alias config is rejected before metadata fetch',async()=>{
 const root=dir(),file=path.join(root,'provider.json'),link=path.join(root,'alias.json');
 try{
  put(file,cfg,0o644);
  let count=0;
  const check=f=>inspectV2OAuthProvider({file:f,
   ownerUid:process.getuid(),request:async()=>{count++;return fake('')}});
  await assert.rejects(()=>check(file),{code:'V2_OAUTH_PREFLIGHT_CONFIG_UNTRUSTED'});
  fs.chmodSync(file,0o600);fs.symlinkSync(file,link);
  await assert.rejects(()=>check(link),{code:'V2_OAUTH_PREFLIGHT_CONFIG_UNTRUSTED'});
  assert.equal(count,0);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
posixTest('discovery cannot override pinned issuer or evade PKCE S256',async()=>{
 const root=dir(),file=path.join(root,'provider.json');
 try{
  put(file,cfg);
  const fetchBad=bad=>inspectV2OAuthProvider({file,
   ownerUid:process.getuid(),request:async url=>new Response(JSON.stringify(
    url.endsWith('/keys')?{keys:[{kid:'key'}]}:{...metadata,...bad}),{status:200})});
  await assert.rejects(()=>fetchBad({issuer:'https://foreign.example.test'}),
   {code:'V2_PROVIDER_ISSUER_MISMATCH'});
  await assert.rejects(()=>fetchBad({code_challenge_methods_supported:['plain']}),
   {code:'V2_PROVIDER_PKCE_S256_REQUIRED'});
  assert.equal(fs.statSync(file).mode&0o077,0);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

posixTest('missing symlink target and symlinked parent never masquerade as absent provider',async()=>{
 const root=dir(),real=path.join(root,'real'),alias=path.join(root,'alias');
 try{
  fs.mkdirSync(real);
  const broken=path.join(root,'missing-link.json');
  fs.symlinkSync(path.join(root,'not-present.json'),broken);
  await assert.rejects(()=>inspectV2OAuthProvider({
   file:broken,ownerUid:process.getuid(),request:fake
  }),{code:'V2_OAUTH_PREFLIGHT_CONFIG_UNTRUSTED'});
  put(path.join(real,'provider.json'),cfg);
  fs.symlinkSync(real,alias);
  await assert.rejects(()=>inspectV2OAuthProvider({
   file:path.join(alias,'provider.json'),ownerUid:process.getuid(),request:fake
  }),{code:'V2_OAUTH_PREFLIGHT_CONFIG_UNTRUSTED'});
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
