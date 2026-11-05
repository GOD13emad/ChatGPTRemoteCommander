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
 return {dispatcher:createV2OAuthV1McpDispatcher(config),config,get calls(){return calls},
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
 const invocation={authorization:['Bearer','verified-test-bearer'].join(' '),
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
 const auth=['Bearer','verified-test-bearer'].join(' ');
 for(const argumentsValue of [{tool:'run_shell',arguments:args,principalId:'owner'},
  {tool:'run_shell',arguments:args,route:{...route}},{tool:'run_shell'}]){
  const result=await d.call({authorization:auth,args:argumentsValue});
  assert.equal(result.isError,true);
 }
 assert.equal(f.calls,0);
});


test('protected MCP dispatcher takes native owner transport and rejects unauthenticated and revoked calls',async()=>{
 const f=await fixture();
 const {localGateway:_untrusted,...trusted}=f.config;
 let identity=true;
 const calls=[];
 const dispatcher=createV2OAuthV1McpDispatcher({
  ...trusted,
  nativeOwnerTransport:{
   attestLocalOwner:async()=>identity,
   rpc:async(method,params)=>{
    calls.push({method,params});
    if(method==='tools/list')return {tools:[{name:'run_shell',inputSchema:{
     type:'object',properties:{command:{type:'string'},requestId:{type:'string'}}
    }}]};
    if(method==='tools/call')return {isError:false,structuredContent:{exitCode:0,stdout:'live-native-tool-qa'}};
    throw Error('UNEXPECTED_NATIVE_RPC');
   }
  }
 });
 const act={tool:'run_shell',arguments:args};
 const noBearer=await dispatcher.call({args:act});
 assert.equal(noBearer.isError,true);
 assert.equal(calls.length,0);
 const approved=await dispatcher.call({authorization:'Bearer verified-test-bearer',args:act});
 assert.equal(approved.isError,false);
 assert.equal(approved.structuredContent.stdout,'live-native-tool-qa');
 assert.equal(calls.filter(x=>x.method==='tools/call').length,1);
 assert.ok(calls.find(x=>x.method==='tools/call').params.arguments.requestId.startsWith('v2-'));
 f.revoke();
 identity=false;
 const revoked=await dispatcher.call({authorization:'Bearer verified-test-bearer',args:act});
 assert.equal(revoked.isError,true);
 assert.equal(calls.filter(x=>x.method==='tools/call').length,1);
});
test('protected dispatcher denies native peer revocation before physical tool invocation',async()=>{
 const f=await fixture();
 const {localGateway:_unused,...trusted}=f.config;
 let allow=true,physical=0;
 const d=createV2OAuthV1McpDispatcher({
  ...trusted,
  nativeOwnerTransport:{
   attestLocalOwner:async()=>allow,
   rpc:async method=>{
    if(method==='tools/list'){
     allow=false;return {tools:[{name:'run_shell',inputSchema:{
      type:'object',properties:{command:{type:'string'},requestId:{type:'string'}}
     }}]};
    }
    physical++;throw Error('NATIVE_PEER_REVOKED');
   }
  }
 });
 const r=await d.call({authorization:'Bearer verified-test-bearer',args:{
  tool:'run_shell',arguments:args
 }});
 assert.equal(r.isError,true);
 assert.equal(physical,0);
 assert.equal(r.content[0].text,'V2_PROTECTED_ACTION_DENIED');
});
test('native owner transport cannot be mixed with a prebuilt gateway or untrusted extra keys',async()=>{
 const f=await fixture();
 assert.throws(()=>createV2OAuthV1McpDispatcher({
  ...f.config,nativeOwnerTransport:{rpc:async()=>({}),attestLocalOwner:async()=>true}
 }),{code:'V2_AUTH_PARITY_NATIVE_BOOTSTRAP_REQUIRED'});
 const {localGateway:_unused,...trusted}=f.config;
 assert.throws(()=>createV2OAuthV1McpDispatcher({
  ...trusted,nativeOwnerTransport:{rpc:async()=>({}),attestLocalOwner:async()=>true,overrides:true}
 }),{code:'V2_PROTECTED_NATIVE_TRANSPORT_INVALID'});
});
