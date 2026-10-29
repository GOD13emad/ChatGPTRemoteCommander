import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkflowStore } from '../src/workflow-store.mjs';
import { V2GrantRegistry } from '../src/v2-grant-registry.mjs';
import { v2ActionDigest } from '../src/v2-caller-assertion.mjs';
import { createV2JwksTokenVerifier } from '../src/v2-oauth-jwks.mjs';
import { createV2CandidateMcpDispatcher } from '../src/v2-mcp-workflow-dispatcher.mjs';

const NOW=1780000000000;
const issuer='https://idp.example.test';
const resource='https://commander.example.test/mcp-v2';
const jwksUri='https://idp.example.test/jwks';
const oauth=generateKeyPairSync('ed25519'),native=generateKeyPairSync('ed25519');
const jwtFields=['issuer','audience','hostId','principalId','profileId',
 'conversationId','operationId','targetKind','targetId','osSessionId',
 'tool','argumentsHash','issuedAtMs','expiresAtMs','nonce'];
const signedRoute=(r,args)=> {
 const claims={
  issuer:'native-issuer',audience:'commander-v2',hostId:r.hostId,
  principalId:r.principalId,profileId:r.profileId,conversationId:r.conversationId,
  operationId:r.operationId,targetKind:r.target.kind,targetId:r.target.id,
  osSessionId:'owner-session-1',tool:'write_text',
  argumentsHash:v2ActionDigest('write_text',args),issuedAtMs:NOW-1000,
  expiresAtMs:NOW+60000,nonce:'nonce-native'
 };
 const payload=Buffer.from(JSON.stringify([2,'owner-public',...jwtFields.map(f=>claims[f])]));
 return {schema:2,keyId:'owner-public',claims,
   signature:sign(null,payload,native.privateKey).toString('base64url')};
};
function jwt(overrides={}){
 const header=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'at+jwt',kid:'oauth-key'})).toString('base64url');
 const claims=Buffer.from(JSON.stringify({
  iss:issuer,aud:resource,sub:'oauth-principal',scope:'commander.workflow',
  exp:Math.floor((NOW+60000)/1000),nbf:Math.floor((NOW-1000)/1000),...overrides
 })).toString('base64url');
 const p=header+'.'+claims;
 return p+'.'+sign(null,Buffer.from(p),oauth.privateKey).toString('base64url');
}
function resourceVerifier(){
 const publicJwk={...oauth.publicKey.export({format:'jwk'}),
  kid:'oauth-key',alg:'EdDSA',use:'sig'};
 return createV2JwksTokenVerifier({
  issuer,audience:resource,jwksUri,now:()=>NOW,
  request:async()=>new Response(JSON.stringify({keys:[publicJwk]}),{status:200})
 });
}
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-g1-unified-'));
 const project=path.join(dir,'project');fs.mkdirSync(project);
 const store=new WorkflowStore({
  directory:path.join(dir,'workflows'),
  rootLeaseDirectory:path.join(dir,'leases'),allowedRoots:[dir],
  device:'host',configSha256:'1'.repeat(64),
  authority:{profileId:'alice',tier:'FULL_POWER',
    capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
  schedulerPolicy:{enabled:true,oneWriterPerRoot:true,maxConcurrentProjects:1,
    leaseMs:5000,intervalMs:1000,retryBudget:3}
 });
 const grants=new V2GrantRegistry({
  directory:path.join(dir,'grants'),authorizeAdministration:({actor})=>actor==='admin'
 });
 const route={hostId:'host',principalId:'user',profileId:'alice',conversationId:'chat-a',
   operationId:'write',target:{kind:'workflow-root',id:'flow-a'}};
 const args={path:path.join(project,'a.txt'),content:'approved'};
 store.create({id:'flow-a',root:project,goal:'bounded operation',
   acceptance:['one successful step'],steps:[{id:'write',title:'write a file'}]});
 grants.change({route,tool:'write_text',status:'ENABLED',
   expectedRevision:0,actor:'admin',reason:'candidate integration fixture'});
 let effects=0;
 const invocation={route,assertion:signedRoute(route,args)};
 const verifiedAccess=resourceVerifier();
 const base={
  resource,authorizationServers:[issuer],issuer,audience:resource,
  assertionTrust:{issuer:'native-issuer',audience:'commander-v2',
    publicKeys:new Map([['owner-public',native.publicKey]])},
  verifyAccessToken:verifiedAccess,
  resolvePrincipal:async(subject)=>subject==='oauth-principal'?'user':null,
  observedNativeSession:async()=> 'owner-session-1',
  resolveTrustedInvocation:async()=>invocation,
  workflowStore:store,grantRegistry:grants,
  authorizeTool:async(tool,a)=>
    tool==='write_text'&&a.path===args.path&&a.content===args.content,
  dispatch:async(_tool,a)=>{
    fs.writeFileSync(a.path,a.content);effects++;return {ok:true};
  },
  now:()=>NOW
 };
 const input={tool:'write_text',arguments:args,stepId:'write',expectedRevision:1};
 const mk=(override={})=>createV2CandidateMcpDispatcher({...base,...override});
 return {route,args,grants,store,dir,project,input,base,mk,
  effects:()=>effects,
  close(){grants.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
 };
}
test('candidate MCP dispatcher lists only OAuth-protected V2 workflow tool',()=>{
 const f=fixture();try{
  const d=f.mk();
  assert.deepEqual(d.descriptor.securitySchemes,[{type:'oauth2',scopes:['commander.workflow']}]);
  assert.equal(d.protectedResource.body.resource,resource);
  assert.equal(d.descriptor.name,'v2_workflow_step');
 }finally{f.close();}
});
test('missing and malformed token never enter trusted chat resolution or dispatch',async()=>{
 const f=fixture();try{
  let lookups=0;
  const d=f.mk({resolveTrustedInvocation:async()=>{lookups++;throw Error('should not run');}});
  for(const authorization of [undefined,null,'Basic wrong']){
   const r=await d.call({authorization,toolName:'v2_workflow_step',args:f.input});
   assert.equal(r.isError,true);
   assert.ok(r._meta['mcp/www_authenticate']);
  }
  assert.equal(lookups,0);assert.equal(f.effects(),0);
 }finally{f.close();}
});
test('valid signed OAuth JWT + native session assertion drives one actual WorkflowStore step',async()=>{
 const f=fixture();try{
  const d=f.mk(),auth='Bearer '+jwt();
  const result=await d.call({authorization:auth,toolName:'v2_workflow_step',args:f.input});
  assert.equal(result.isError,undefined);
  assert.equal(result.structuredContent.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(f.effects(),1);
  assert.equal(fs.readFileSync(f.args.path,'utf8'),'approved');
  const replay=await d.call({authorization:auth,toolName:'v2_workflow_step',args:f.input});
  assert.equal(replay.structuredContent.cachedReceipt,true);
  assert.equal(f.effects(),1);
 }finally{f.close();}
});
test('native action resolver sees exact tool payload but no bearer, chat or route authority',async()=>{
 const f=fixture();try{
  let looked=0;
  const d=f.mk({resolveTrustedInvocation:async(action)=>{
    looked++;
    assert.deepEqual(Object.keys(action).sort(),
      ['arguments','expectedRevision','stepId','tool'].sort());
    assert.equal(Object.isFrozen(action),true);
    assert.equal(action.tool,'write_text');
    assert.equal(action.stepId,'write');
    assert.equal(action.expectedRevision,1);
    assert.deepEqual(action.arguments,f.args);
    assert.notEqual(action.arguments,f.args);
    assert.equal(action.sessionHandle,undefined);
    return f.base.resolveTrustedInvocation();
  }});
  const r=await d.call({authorization:'Bearer '+jwt(),
    toolName:'v2_workflow_step',args:f.input});
  assert.equal(r.isError,undefined);
  assert.equal(looked,1);
  assert.equal(f.effects(),1);
 }finally{f.close();}
});
test('missing independently attested conversation rejects an otherwise valid OAuth user',async()=>{
 const f=fixture();try{
  const d=f.mk({resolveTrustedInvocation:async()=>null});
  const r=await d.call({
   authorization:'Bearer '+jwt(),toolName:'v2_workflow_step',args:f.input
  });
  assert.equal(r.isError,true);
  assert.match(r.content[0].text,/V2_MCP_CHAT_ATTESTATION_REQUIRED/);
  assert.equal(r._meta,undefined);
  assert.equal(f.effects(),0);
 }finally{f.close();}
});
test('model-supplied route and conversation replacement denied before execution',async()=>{
 const f=fixture();try{
  const d=f.mk();
  const r=await d.call({authorization:'Bearer '+jwt(),
   toolName:'v2_workflow_step',args:{...f.input,conversationId:'chat-b'}});
  assert.equal(r.isError,true);assert.match(r.content[0].text,/V2_MCP_INPUT_INVALID/);
  const extra=await d.call({authorization:'Bearer '+jwt(),
   toolName:'v2_workflow_step',args:{...f.input,arguments:{...f.args,content:'forged'}}});
  assert.equal(extra.isError,true);
  assert.equal(f.effects(),0);
 }finally{f.close();}
});
test('foreign OAuth subject and wrong native session fail before WorkflowStore effects',async()=>{
 const f=fixture();try{
  const d=f.mk();
  const foreign=await d.call({
   authorization:'Bearer '+jwt({sub:'foreign'}),
   toolName:'v2_workflow_step',args:f.input
  });
  assert.equal(foreign.isError,true);
  const nativeWrong=f.mk({observedNativeSession:async()=> 'other-session'});
  const mismatch=await nativeWrong.call({
   authorization:'Bearer '+jwt(),toolName:'v2_workflow_step',args:f.input
  });
  assert.equal(mismatch.isError,true);assert.equal(f.effects(),0);
 }finally{f.close();}
});
test('grant revocation blocks even a cached successful workflow receipt',async()=>{
 const f=fixture();try{
  const d=f.mk(),auth='Bearer '+jwt();
  assert.equal((await d.call({authorization:auth,toolName:'v2_workflow_step',args:f.input})).isError,undefined);
  f.grants.change({route:f.route,tool:'write_text',status:'REVOKED',
    expectedRevision:1,actor:'admin',reason:'test revoke after success'});
  const revoked=await d.call({authorization:auth,toolName:'v2_workflow_step',args:f.input});
  assert.equal(revoked.isError,true);
  assert.match(revoked.content[0].text,/V2_GRANT_REQUIRED/);
  assert.equal(f.effects(),1);
 }finally{f.close();}
});
test('MCP JSON-RPC candidate correctly handles list, call, wrong method and invalid envelope',async()=>{
 const f=fixture();try{
  const d=f.mk(),authorization='Bearer '+jwt();
  const list=await d.handleRpc({
   authorization,message:{jsonrpc:'2.0',id:1,method:'tools/list'}
  });
  assert.equal(list.result.tools[0].name,'v2_workflow_step');
  const call=await d.handleRpc({
   authorization,message:{jsonrpc:'2.0',id:2,method:'tools/call',
    params:{name:'v2_workflow_step',arguments:f.input}}
  });
  assert.equal(call.result.structuredContent.outcome,'RECORDED_NOT_VALIDATED');
  const invalid=await d.handleRpc({
   authorization,message:{jsonrpc:'2.0',id:'',method:'tools/list'}
  });
  assert.equal(invalid.error.code,-32600);
  const unknown=await d.handleRpc({
   authorization,message:{jsonrpc:'2.0',id:3,method:'mutation/run'}
  });
  assert.equal(unknown.error.code,-32601);
  assert.equal(f.effects(),1);
 }finally{f.close();}
});
test('unconfigured native attestor or missing WorkflowStore cannot produce executable candidate',()=>{
 const f=fixture();try{
  assert.throws(()=>f.mk({resolveTrustedInvocation:null}),{code:'V2_MCP_TRUSTED_BOOTSTRAP_REQUIRED'});
  assert.throws(()=>f.mk({workflowStore:null}),{code:'V2_MCP_TRUSTED_BOOTSTRAP_REQUIRED'});
 }finally{f.close();}
});


test('forged signed bearer and wrong OAuth audience cannot touch native owner resolver',async()=>{
 const f=fixture();try{
   let nativeReads=0;
   const d=f.mk({resolveTrustedInvocation:async()=>{
     nativeReads++;throw Error('should not call native');
   }});
   const malformed=await d.call({
     authorization:'Bearer malformed',
     toolName:'v2_workflow_step',args:f.input
   });
   assert.equal(malformed.isError,true);
   assert.ok(malformed._meta['mcp/www_authenticate']);
   const wrongAudience=await d.call({
     authorization:'Bearer '+jwt({aud:'https://foreign-app.example.test/mcp'}),
     toolName:'v2_workflow_step',args:f.input
   });
   assert.equal(wrongAudience.isError,true);
   assert.ok(wrongAudience._meta['mcp/www_authenticate']);
   assert.equal(nativeReads,0);
   assert.equal(f.effects(),0);
 }finally{f.close();}
});
test('two separately owner-attested candidate sessions contend for one WorkflowStore root',async()=>{
 const f=fixture();let unblock,entered;
 const held=new Promise(resolve=>unblock=resolve);
 const started=new Promise(resolve=>entered=resolve);
 try{
   const other={...f.route,conversationId:'chat-b',
     target:{kind:'workflow-root',id:'flow-b'}};
   const bArgs={path:path.join(f.project,'b.txt'),content:'separate'};
   f.store.create({id:'flow-b',root:f.project,goal:'second authorized chat',
      acceptance:['one step'],steps:[{id:'write',title:'write B'}]});
   f.grants.change({route:other,tool:'write_text',status:'ENABLED',
     expectedRevision:0,actor:'admin',reason:'independently owner-attested second chat'});
   let aEffects=0,bEffects=0;
   const a=f.mk({dispatch:async(_tool,args)=>{
     entered();await held;fs.writeFileSync(args.path,args.content);aEffects++;return {ok:true};
   }});
   const b=f.mk({
     resolveTrustedInvocation:async()=>({route:other,assertion:signedRoute(other,bArgs)}),
     authorizeTool:async(_tool,args)=>args.path===bArgs.path&&args.content===bArgs.content,
     dispatch:async(_tool,args)=>{fs.writeFileSync(args.path,args.content);bEffects++;return {ok:true};}
   });
   const auth='Bearer '+jwt();
   const aCall=a.call({authorization:auth,toolName:'v2_workflow_step',args:f.input});
   await started;
   const attempted=b.call({authorization:auth,toolName:'v2_workflow_step',
       args:{...f.input,arguments:bArgs}});
   const locked=await attempted;
   assert.equal(locked.isError,true);
   assert.equal(aEffects,0);assert.equal(bEffects,0);
   unblock();
   assert.equal((await aCall).isError,undefined);
   const bResult=await b.call({authorization:auth,toolName:'v2_workflow_step',
       args:{...f.input,arguments:bArgs}});
   assert.equal(bResult.isError,undefined);
   assert.equal(aEffects,1);assert.equal(bEffects,1);
   f.grants.change({route:other,tool:'write_text',status:'REVOKED',
     expectedRevision:1,actor:'admin',reason:'second chat grant revoked'});
   const deniedB=await b.call({authorization:auth,toolName:'v2_workflow_step',
       args:{...f.input,arguments:bArgs}});
   assert.equal(deniedB.isError,true);
   assert.match(deniedB.content[0].text,/V2_GRANT_REQUIRED/);
   assert.equal(aEffects,1);assert.equal(bEffects,1);
 }finally{unblock?.();f.close();}
});


test('legacy MCP handshake, tool enumeration, string request ID and notification lifecycle',async()=>{
 const f=fixture();try{
  const d=f.mk();
  const initialize=await d.handleRpc({
   message:{jsonrpc:'2.0',id:'init-a',method:'initialize',
     params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1.0'}}}
  });
  assert.equal(initialize.id,'init-a');
  assert.equal(initialize.result.protocolVersion,'2025-11-25');
  assert.deepEqual(initialize.result.capabilities,{tools:{}});
  assert.equal(initialize.result.serverInfo.name,'chatgpt-remote-commander-v2-candidate');
  const notify=await d.handleRpc({message:{jsonrpc:'2.0',method:'notifications/initialized'}});
  assert.equal(notify,null);
  const list=await d.handleRpc({message:{jsonrpc:'2.0',id:'list-b',method:'tools/list'}});
  assert.equal(list.id,'list-b');
  assert.equal(list.result.tools.length,1);
  assert.equal(list.result.resultType,undefined);
 }finally{f.close();}
});
test('modern MCP 2026-07-28 discovery returns versioned stateless tool capabilities',async()=>{
 const f=fixture();try{
  const d=f.mk();
  const modernMeta={'io.modelcontextprotocol/protocolVersion':'2026-07-28',
    'io.modelcontextprotocol/clientCapabilities':{}};
  const discover=await d.handleRpc({message:{jsonrpc:'2.0',id:1,
    method:'server/discover',params:{_meta:modernMeta}}});
  assert.equal(discover.result.resultType,'complete');
  assert.deepEqual(discover.result.supportedVersions,['2026-07-28']);
  assert.deepEqual(discover.result.capabilities,{tools:{}});
  const list=await d.handleRpc({message:{jsonrpc:'2.0',id:2,
    method:'tools/list',params:{_meta:modernMeta}}});
  assert.equal(list.result.resultType,'complete');
  assert.equal(list.result.tools[0].name,'v2_workflow_step');
  assert.equal(list.result._meta['io.modelcontextprotocol/serverInfo'].name,
    'chatgpt-remote-commander-v2-candidate');
  const noAuth=await d.handleRpc({message:{jsonrpc:'2.0',id:3,
    method:'tools/call',params:{name:'v2_workflow_step',arguments:f.input,_meta:modernMeta}}});
  assert.equal(noAuth.result.resultType,'complete');
  assert.equal(noAuth.result.isError,true);
  assert.equal(noAuth.result._meta['mcp/www_authenticate'].length,1);
  assert.equal(f.effects(),0);
 }finally{f.close();}
});
test('unsupported modern version and missing capabilities fail closed without effects',async()=>{
 const f=fixture();try{
  const d=f.mk();
  const wrong=await d.handleRpc({message:{jsonrpc:'2.0',id:1,
    method:'tools/list',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-10-01'}}}});
  assert.equal(wrong.error.code,-32022);
  const missing=await d.handleRpc({message:{jsonrpc:'2.0',id:2,
    method:'tools/list',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}}});
  assert.equal(missing.error.code,-32021);
  assert.equal(f.effects(),0);
 }finally{f.close();}
});

test('multiple advertised OAuth scopes are all enforced before native lookup or effects',async()=>{
 const f=fixture();try{
  let lookups=0;
  const required=['commander.workflow','commander.seat'];
  const d=f.mk({scopes:required,resolveTrustedInvocation:async()=>{
   lookups++;return f.base.resolveTrustedInvocation();
  }});
  assert.deepEqual(d.descriptor.securitySchemes,[{type:'oauth2',scopes:required}]);
  const partial=await d.call({authorization:'Bearer '+jwt(),toolName:'v2_workflow_step',args:f.input});
  assert.equal(partial.isError,true);
  assert.match(partial._meta['mcp/www_authenticate'][0],/insufficient_scope/);
  assert.equal(lookups,0);
  assert.equal(f.effects(),0);
  const full=await d.call({
   authorization:'Bearer '+jwt({scope:'commander.workflow commander.seat'}),
   toolName:'v2_workflow_step',args:f.input
  });
  assert.equal(full.isError,undefined);
  assert.equal(lookups,1);
  assert.equal(f.effects(),1);
 }finally{f.close();}
});

test('scope downgrade after entry OAuth check never reaches WorkflowStore effects',async()=>{
 const f=fixture();try{
  let verified=0,lookups=0;
  const required=['commander.workflow','commander.seat'];
  const fullScopes=Object.freeze([...required]);
  const d=f.mk({
   scopes:required,
   verifyAccessToken:async token=>{
    const c=await f.base.verifyAccessToken(token);
    verified++;
    return {...c,scopes:verified===1?fullScopes:['commander.workflow']};
   },
   resolveTrustedInvocation:async action=>{
    lookups++;return f.base.resolveTrustedInvocation(action);
   }
  });
  required.splice(1,1);
  const result=await d.call({
   authorization:'Bearer '+jwt({scope:'commander.workflow commander.seat'}),
   toolName:'v2_workflow_step',args:f.input
  });
  assert.equal(result.isError,true);
  assert.match(result._meta['mcp/www_authenticate'][0],/insufficient_scope/);
  assert.equal(verified,2);
  assert.equal(lookups,1);
  assert.equal(f.effects(),0);
 }finally{f.close();}
});
