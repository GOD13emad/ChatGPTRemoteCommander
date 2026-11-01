import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createV2NativeOwnerAssertionIssuer} from '../src/v2-caller-assertion.mjs';
import {createV2OAuthV1McpDispatcher} from '../src/v2-oauth-v1-mcp-dispatcher.mjs';
const NOW=1780000000000;
const issuer='https://auth.example.test';
const resource='https://mmz.example.test/mcp-v2';
const args={command:'true'};
const route={hostId:'mmz',principalId:'owner',profileId:'default',
 conversationId:'chat-a',operationId:'op-1',target:{kind:'host-shell',id:'mmz'}};
async function fixture(){
 const key=generateKeyPairSync('ed25519');
 const native=createV2NativeOwnerAssertionIssuer({
  issuer:'native-test',audience:'v2-private',keyId:'native-kid',privateKey:key.privateKey,
  resolveNativeRoute:async()=>route,observedNativeSession:async()=> 'seat-a',
  authorizeIssue:async()=>true,now:()=>NOW,nonce:()=> 'nonce-one'
 });
 const proof=await native({sessionHandle:'tested-native-session',tool:'run_shell',args});
 let calls=0,granted=true;
 const config={resource,authorizationServers:[issuer],issuer,audience:resource,
  verifyAccessToken:async value=>{
   if(value!=='verified-test-bearer')throw Object.assign(new Error('bad jwt'),{code:'V2_JWT_SIGNATURE_INVALID'});
   return {issuer,audience:resource,subject:'owner-sub',
    notBeforeMs:NOW-1000,expiresAtMs:NOW+60000,scopes:['commander.full']};
  },
  resolvePrincipal:async sub=>sub==='owner-sub'?'owner':null,
  resolveTrustedInvocation:async()=>proof,
  assertionTrust:{issuer:'native-test',audience:'v2-private',
   publicKeys:new Map([['native-kid',key.publicKey]])},
  observedNativeSession:async()=> 'seat-a',
  grantRegistry:{isAllowed:()=>granted},
  withLease:async(_key,fn)=>fn(),
  receiptStore:{execute:async(_opts,fn)=>fn()},
  localGateway:{call:async()=>{calls++;return {result:{
   isError:false,structuredContent:{exitCode:0,stdout:'private'}}};}},
  now:()=>NOW};
 return {dispatcher:createV2OAuthV1McpDispatcher(config),get calls(){return calls},
  revoke:()=>granted=false};
}
test('protected tool lists OAuth scope and never appears as NoAuth',async()=>{
 const f=await fixture(),d=f.dispatcher;
 assert.equal(d.descriptor.name,'v2_v1_protected_call');
 assert.deepEqual(d.descriptor.securitySchemes,[{type:'oauth2',scopes:['commander.full']}]);
 assert.equal(d.protectedResource.body.resource,resource);
 assert.deepEqual((await d.handleRpc({message:{jsonrpc:'2.0',id:1,
  method:'tools/list'}})).result.tools,[d.descriptor]);
});
test('missing OAuth challenge and forged OAuth do not dispatch',async()=>{
 const f=await fixture(),d=f.dispatcher;
 for(const authorization of [undefined,'Bearer false-token']){
  const r=await d.call({authorization,args:{tool:'run_shell',arguments:args}});
  assert.equal(r.isError,true);
  assert.ok(r._meta?.['mcp/www_authenticate']);
 }
 assert.equal(f.calls,0);
});
test('OAuth+native consent+grant returns V1 tool data; revocation blocks',async()=>{
 const f=await fixture(),d=f.dispatcher;
 const invocation={authorization:'Bearer verified-test-bearer',
  args:{tool:'run_shell',arguments:args}};
 const ok=await d.call(invocation);
 assert.equal(ok.isError,false);
 assert.equal(ok.structuredContent.exitCode,0);
 assert.equal(f.calls,1);
 f.revoke();
 const denied=await d.call(invocation);
 assert.equal(denied.isError,true);
 assert.equal(denied._meta,undefined);
 assert.match(denied.content[0].text,/DENIED/);
 assert.equal(f.calls,1);
});
test('noauth cannot pass forged principal/route or unapproved tool input',async()=>{
 const f=await fixture(),d=f.dispatcher;
 const auth='Bearer verified-test-bearer';
 for(const argumentsValue of [{tool:'run_shell',arguments:args,principalId:'owner'},
  {tool:'run_shell',arguments:args,route:{...route}},{tool:'run_shell'}]){
  const result=await d.call({authorization:auth,args:argumentsValue});
  assert.equal(result.isError,true);
 }
 assert.equal(f.calls,0);
});
