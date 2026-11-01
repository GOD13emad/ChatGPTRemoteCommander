// Read-only, non-secret OAuth issuer preflight for the MMZ V2 operator.
// This module NEVER authenticates a user, issues an access token or starts MCP.
import fs from 'node:fs';
import path from 'node:path';
import {validateV2OAuthProvider} from './v2-oauth-provider-preflight.mjs';
import {fetchV2Jwks} from './v2-oauth-jwks.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code})};
function record(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 [Object.prototype,null].includes(Object.getPrototypeOf(v));}
function safeUri(value){
 if(typeof value!=='string'||value.length>2048)fail('V2_OAUTH_PREFLIGHT_URI_INVALID');
 let u;try{u=new URL(value)}catch{fail('V2_OAUTH_PREFLIGHT_URI_INVALID')}
 if(u.protocol!=='https:'||!u.hostname||u.username||u.password||
  u.search||u.hash||(u.port&&u.port!=='443'))fail('V2_OAUTH_PREFLIGHT_URI_INVALID');
 return u;
}
async function readJson(uri,request,timeoutMs){
 const target=safeUri(uri);
 let response;
 try{response=await request(target.href,{method:'GET',redirect:'error',
  headers:{accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)})}
 catch{fail('V2_OAUTH_PREFLIGHT_METADATA_FETCH_FAILED')}
 if(response.status!==200||!response.ok||
  (response.url&&new URL(response.url).href!==target.href))
  fail('V2_OAUTH_PREFLIGHT_METADATA_FETCH_FAILED');
 const length=Number(response.headers?.get?.('content-length'));
 if(Number.isFinite(length)&&length>65536)
  fail('V2_OAUTH_PREFLIGHT_METADATA_TOO_LARGE');
 let total=0,chunks=[];
 try{
  if(!response.body?.getReader)fail('V2_OAUTH_PREFLIGHT_METADATA_FETCH_FAILED');
  const reader=response.body.getReader();
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>65536){
    await reader.cancel();fail('V2_OAUTH_PREFLIGHT_METADATA_TOO_LARGE');
   }
   chunks.push(value);
  }
 }catch(e){
  if(e?.code==='V2_OAUTH_PREFLIGHT_METADATA_TOO_LARGE')throw e;
  fail('V2_OAUTH_PREFLIGHT_METADATA_FETCH_FAILED');
 }
 try{
  const data=JSON.parse(Buffer.concat(chunks,total).toString('utf8'));
  if(!record(data))fail('V2_OAUTH_PREFLIGHT_METADATA_INVALID');
  return data;
 }catch(e){
  if(e?.code==='V2_OAUTH_PREFLIGHT_METADATA_INVALID')throw e;
  fail('V2_OAUTH_PREFLIGHT_METADATA_INVALID');
 }
}
/** An absent owner-private provider file is BLOCKED, not setup success. */
export async function inspectV2OAuthProvider({
 file,request=fetch,ownerUid=typeof process.getuid==='function'?process.getuid():null,
 timeoutMs=5000
}={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||typeof request!=='function'||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000||
  !Number.isSafeInteger(ownerUid)||ownerUid<1)
  fail('V2_OAUTH_PREFLIGHT_CONFIG_INVALID');
 // Inspect the entry rather than existsSync so a dangling symlink is
 // explicitly rejected instead of misrepresented as absent configuration.
 let st;
 try{st=fs.lstatSync(file)}
 catch(e){
  if(e?.code==='ENOENT')
   return Object.freeze({status:'BLOCKED_PROVIDER_CONFIG_MISSING',
    oauthLoginVerified:false,ownerSessionVerified:false,privateToolsActivated:false});
  fail('V2_OAUTH_PREFLIGHT_CONFIG_UNTRUSTED');
 }
 let cursor=path.parse(file).root;
 for(const part of path.dirname(file).slice(cursor.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  const parent=fs.lstatSync(cursor);
  if(parent.isSymbolicLink()||!parent.isDirectory())
   fail('V2_OAUTH_PREFLIGHT_CONFIG_UNTRUSTED');
 }
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
  st.uid!==ownerUid||(st.mode&0o077)!==0||st.size<2||st.size>8192)
  fail('V2_OAUTH_PREFLIGHT_CONFIG_UNTRUSTED');
 let c;
 try{c=JSON.parse(fs.readFileSync(file,'utf8'))}catch{fail('V2_OAUTH_PREFLIGHT_CONFIG_INVALID')}
 if(!record(c)||Object.keys(c).length!==5||
  !['issuer','resource','metadataUrl','scopes','clientRegistration']
   .every(k=>Object.hasOwn(c,k)))
  fail('V2_OAUTH_PREFLIGHT_CONFIG_INVALID');
 const i=safeUri(c.issuer),r=safeUri(c.resource),m=safeUri(c.metadataUrl);
 if(m.origin!==i.origin||!Array.isArray(c.scopes)||c.scopes.length===0)
  fail('V2_OAUTH_PREFLIGHT_CONFIG_INVALID');
 const metadata=await readJson(m.href,request,timeoutMs);
 const verified=validateV2OAuthProvider({
  issuer:c.issuer,resource:c.resource,metadata,requiredScopes:c.scopes,
  clientRegistration:c.clientRegistration
 });
 // This is public signing-key discovery, NOT an authenticated login.
 const keys=await fetchV2Jwks(verified.jwksUri,{request,timeoutMs});
 if(!Array.isArray(keys.keys)||keys.keys.length===0)
  fail('V2_OAUTH_PREFLIGHT_SIGNING_KEYS_MISSING');
 return Object.freeze({status:'PUBLIC_PROVIDER_DISCOVERY_PASS_OWNER_LOGIN_PENDING',
  issuerMetadataVerified:true,publicSigningKeysPresent:true,
  clientRegistration:verified.clientRegistration,
  requiredScopes:Object.freeze([...verified.scopes]),
  oauthLoginVerified:false,ownerSessionVerified:false,privateToolsActivated:false});
}
