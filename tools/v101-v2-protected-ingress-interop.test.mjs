// V1-01 source-only, isolated compatibility gate for a separately pinned V2 tree.
// Invoke with RC_V2_CANDIDATE_ROOT=<verified git-archive root>
//   node --test tools/v101-v2-protected-ingress-interop.test.mjs
// NEVER install the two unbound fixture listeners or interpret this as live G1 acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {legacyPrivilegedMcpQuarantine, rejectLegacyPrivilegedMcp} from '../src/full-access-http-quarantine.mjs';
import {createHash} from 'node:crypto';
import {createV101V2ProtectedDispatcherFactory} from '../src/v101-v2-protected-dispatcher.mjs';
import {probeInstalledG1} from './v1-01/installed-g1-readonly-probe.mjs';


const RESOURCE='https://commander.example.test/mcp-v2';
const AUTH_SERVER='https://idp.example.test';
const high={ok:true,isAdmin:true,isSystem:false,elevation:'high',source:'local-process-token'};
const owner={ok:true,isAdmin:false,isSystem:false,elevation:'standard',source:'local-process-token'};
const action=(method='tools/list',metadata)=>({
  jsonrpc:'2.0',id:1,method,
  params:{...(method==='tools/call'?{name:'v2_workflow_step',arguments:{}}:{}),
    ...(metadata?{_meta:metadata}:{})}
});
function failDecision(tier='FULL_ACCESS',token=high,strict=false){
  return legacyPrivilegedMcpQuarantine({
    platform:'win32',configuredTier:tier,windowsAdminToken:token,requireTrustedIngress:strict
  });
}
async function fetchRpc(base,pathName,msg,headers={}){
  const res=await fetch(base+pathName,{
    method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(msg)
  });
  return {status:res.status,body:await res.json(),noStore:res.headers.get('cache-control')==='no-store'};
}
test('V1-01 quarantined legacy and V2 transport-bound source ingress coexist without cross-route authority',async t=>{
  const root=process.env.RC_V2_CANDIDATE_ROOT;
  assert.ok(typeof root==='string'&&path.isAbsolute(root),'RC_V2_CANDIDATE_ROOT must be an explicit absolute isolated source path');
  const file=path.join(root,'src','v2-mcp-http-ingress.mjs');
  assert.equal((await stat(file)).isFile(),true,'V2 source snapshot must be present');
  const {createV2CandidateHttpIngress}=await import(pathToFileURL(file).href);
  const strictLegacy=failDecision();
  assert.equal(strictLegacy.quarantine,true);
  let trusted=false,attestorCalls=0,dispatched=0,deniedActionCalls=0,legacyEffects=0;
  const ingress=createV2CandidateHttpIngress({
    resource:RESOURCE,authorizationServers:[AUTH_SERVER],
    // Controlled test fixture, NOT a production mTLS/ChatGPT authenticator.
    attestTransport:async()=>{attestorCalls++;return {authenticated:trusted,sessionHandle:'owner-chat'};},
    dispatcherFactory:async(verified)=>{
      assert.deepEqual(verified,{authenticated:true,sessionHandle:'owner-chat'});
      return {
        protectedResource:ingress.protectedResource,
        handleRpc:async({authorization,message})=>{
          dispatched++;
          if(message.method==='tools/list')
            return {jsonrpc:'2.0',id:message.id,result:{tools:[]}};
          // This intentionally denies ALL actions. The separate pinned V2
          // e2e suite proves JWT/JWKS, owner signature and grant effects.
          if(message.method==='tools/call'){
            deniedActionCalls++;
            return {jsonrpc:'2.0',id:message.id,result:{
              isError:true,content:[{type:'text',text:'owner_fixture_denies_actions'}]
            }};
          }
          return {jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}};
        }
      };
    }
  });
  const server=http.createServer((req,res)=>{
    if(req.url==='/mcp'){
      if(rejectLegacyPrivilegedMcp(req,res,strictLegacy))return;
      legacyEffects++;res.writeHead(200);res.end('unsafe');
      return;
    }
    ingress.handle(req,res);
  });
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
    const base='http://127.0.0.1:'+server.address().port;
    await t.test('anonymous and forged identity headers cannot reach the privileged legacy dispatcher',async()=>{
      for(const headers of [
        {},{authorization:'Bearer fake'},
        {'mcp-session-id':'owner-chat','x-chat-id':'owner-chat'},
        {'x-mtls-verified':'true','x-openai-session':'owner-chat'}
      ]){
        for(const method of ['tools/list','tools/call']){
          const r=await fetchRpc(base,'/mcp',action(method),headers);
          assert.equal(r.status,403);
          assert.deepEqual(r.body,{error:'trusted_transport_required'});
          assert.equal(r.noStore,true);
        }
      }
      assert.equal(legacyEffects,0);
    });
    await t.test('anonymous or forged V2 transport cannot open discovery, tools or effects',async()=>{
      const before=attestorCalls;
      const anonymous=await fetchRpc(base,'/mcp-v2',action());
      assert.equal(anonymous.status,403);
      assert.deepEqual(anonymous.body,{error:'trusted_transport_required'});
      const forged=await fetchRpc(base,'/mcp-v2',action('tools/call'),{
        authorization:'Bearer fake',
        'x-mtls-verified':'true','x-chat-id':'owner-chat'
      });
      assert.equal(forged.status,403);
      assert.ok(attestorCalls>=before+2);
      assert.equal(dispatched,0);
      assert.equal(deniedActionCalls,0);
    });
    await t.test('public OAuth resource metadata is non-executable',async()=>{
      const before=attestorCalls;
      const res=await fetch(base+ingress.protectedResource.metadataPath);
      assert.equal(res.status,200);
      assert.deepEqual((await res.json()).authorization_servers,[AUTH_SERVER]);
      assert.equal(attestorCalls,before);
      assert.equal(dispatched,0);
    });
    await t.test('server-side transport trust permits discovery, but cannot grant tool effects',async()=>{
      trusted=true;
      const list=await fetchRpc(base,'/mcp-v2',action());
      assert.equal(list.status,200);
      assert.deepEqual(list.body.result.tools,[]);
      const withBearer=await fetchRpc(base,'/mcp-v2',action('tools/call'),{
        authorization:'Bearer fake'
      });
      assert.equal(withBearer.status,200);
      assert.equal(withBearer.body.result.isError,true);
      assert.equal(deniedActionCalls,1);
      assert.equal(legacyEffects,0);
    });
    await t.test('untrusted session metadata cannot override the server-side identity',async()=>{
      const r=await fetchRpc(base,'/mcp-v2',action('tools/call',{'openai/session':'another-chat'}));
      assert.equal(r.status,403);
      assert.deepEqual(r.body,{error:'platform_session_mismatch'});
      assert.equal(deniedActionCalls,1);
    });
    await t.test('losing trusted transport immediately restores denial',async()=>{
      const before=dispatched;
      trusted=false;
      const r=await fetchRpc(base,'/mcp-v2',action('tools/call'),{authorization:'Bearer fake'});
      assert.equal(r.status,403);
      assert.equal(dispatched,before);
    });
    await t.test('FULL_POWER remains quarantined and strict STANDARD is not a bypass',()=>{
      for(const q of [failDecision('FULL_POWER',owner),failDecision('FULL_ACCESS',owner),
        failDecision('STANDARD',owner,true),failDecision('STANDARD',null)]){
        assert.equal(q.quarantine,true);
      }
      assert.equal(failDecision('STANDARD',owner,false).quarantine,false);
    });
    assert.equal(deniedActionCalls,1);
  }finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});


test('V1 owner-bound dispatcher composes with pinned V2 HTTP ingress without trusting caller headers', async t=>{
  const root=process.env.RC_V2_CANDIDATE_ROOT;
  assert.ok(typeof root==='string'&&path.isAbsolute(root));
  const file=path.join(root,'src','v2-mcp-http-ingress.mjs');
  assert.equal((await stat(file)).isFile(),true);
  const {createV2CandidateHttpIngress}=await import(pathToFileURL(file).href);
  const token='SYNTHETIC_OWNER_TOKEN_ONLY_ABCDEF0123456789';
  const digest=createHash('sha256').update(token).digest('hex');
  const T=1000000000000;
  const state={trust:false,consent:true,grant:true,changed:false,sidChanged:false,dispatch:0,exactPolicies:0};
  const route=()=>({
    hostId:'host',profileId:'profile',principalId:'principal',
    conversationId:'owner-chat',operationId:'step-a',
    target:{kind:'workflow-root',id:'workflow-a'}
  });
  let ingress;
  const dispatcherFactory=createV101V2ProtectedDispatcherFactory({
    hostId:'host',profileId:'profile',issuer:AUTH_SERVER,audience:RESOURCE,now:()=>T,
    verifyAccessToken:async received=>received===token?{
      issuer:AUTH_SERVER,audience:RESOURCE,subject:'user',notBeforeMs:T-1000,
      expiresAtMs:T+60000,scopes:['commander.workflow']
    }:null,
    resolvePrincipal:async subject=>subject==='user'?'principal':null,
    resolveAttestedTokenBinding:async sha=>state.consent&&sha===digest?{
      source:'native-owner-attested',tokenSha256:digest,
      sessionHandle:state.changed?'another-chat':'owner-chat',
      bindingId:'b'.repeat(64),ownerSidHash:'c'.repeat(64),expiresAtMs:T+50000
    }:null,
    nativeSessionBindings:{
      resolveNativeRoute:async()=>route(),
      resolveNativeOwnerContext:async session=>state.consent&&session==='owner-chat'&&!state.changed?{
        source:'native-owner-attested',hostId:'host',profileId:'profile',principalId:'principal',
        conversationId:'owner-chat',bindingId:'b'.repeat(64),ownerSidHash:(state.sidChanged?'d':'c').repeat(64),expiresAtMs:T+50000
      }:null
    },
    grantRegistry:{isAllowed:()=>state.grant},
    authorizeExactInvocation:async (_route,invocation)=>{
      state.exactPolicies++;
      return invocation.tool==='write_text'
        &&invocation.arguments.path==='safe.txt'
        &&invocation.arguments.content==='allowed';
    },
    createTrustedDispatcher:async proof=>{
      assert.deepEqual(proof,{authenticated:true,sessionHandle:'owner-chat'});
      return {
        protectedResource:{metadataUrl:ingress.protectedResource.metadataUrl},
        async handleRpc({authorization,message}){
          if(!authorization)return {jsonrpc:'2.0',id:message.id,
            result:{isError:true,code:'oauth_required'}};
          if(message.method!=='tools/call'){
            state.dispatch++;
            return {jsonrpc:'2.0',id:message.id,result:{isError:false,ok:true}};
          }
          assert.equal(Object.isFrozen(message.params.arguments.arguments),true);
          assert.equal(message.params.arguments.arguments.content,'allowed');
          state.dispatch++;
          return {jsonrpc:'2.0',id:message.id,result:{isError:false,ok:true}};
        }
      };
    }
  });
  ingress=createV2CandidateHttpIngress({
    resource:RESOURCE,authorizationServers:[AUTH_SERVER],
    attestTransport:async()=>({
      authenticated:state.trust,sessionHandle:'owner-chat'
    }),
    dispatcherFactory
  });
  const server=ingress.createUnboundServer();
  const message=(content='allowed')=>({
    jsonrpc:'2.0',id:42,method:'tools/call',params:{
      name:'v2_workflow_step',arguments:{
        tool:'write_text',arguments:{path:'safe.txt',content},
        stepId:'step-a',expectedRevision:1
      },_meta:{'openai/session':'owner-chat'}
    }
  });
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
    const base='http://127.0.0.1:'+server.address().port;
    const send=(msg=message(),auth='Bearer '+token,headers={})=>
      fetchRpc(base,'/mcp-v2',msg,{authorization:auth,...headers});
    await t.test('unattested request is denied before OAuth or action',async()=>{
      const result=await send();
      assert.equal(result.status,403);
      assert.equal(state.dispatch,0);
      assert.equal(state.exactPolicies,0);
    });
    state.trust=true;
    await t.test('trusted transport without bearer is not an owner authorization',async()=>{
      const result=await fetchRpc(base,'/mcp-v2',message());
      assert.equal(result.status,200);
      assert.equal(result.body.result.isError,true);
      assert.equal(state.dispatch,0);
    });
    await t.test('verified token and independent native owner approval admit exact action',async()=>{
      const result=await send();
      assert.equal(result.status,200);
      assert.equal(result.body.result.ok,true);
      assert.equal(state.dispatch,1);
      assert.equal(state.exactPolicies,1);
    });
    await t.test('forged bearer, wrong args, and unknown V2 tool never dispatch',async()=>{
      const wrongBearer=await send(message(),'Bearer '+'forged-long-unverified-token');
      assert.equal(wrongBearer.body.result.isError,true);
      const badArgs=await send(message('forged'));
      assert.equal(badArgs.body.result.isError,true);
      const future=message();future.params.name='v2_future_unreviewed_tool';
      const badTool=await send(future);
      assert.equal(badTool.body.result.isError,true);
      assert.equal(state.dispatch,1);
    });
    await t.test('future RPC methods fail closed before canonical dispatcher',async()=>{
      for(const method of ['resources/read','prompts/get','tasks/cancel','future/privileged']){
        const future=message();future.method=method;
        const result=await send(future);
        assert.equal(result.status,200);
        assert.equal(result.body.result.isError,true);
        assert.equal(state.dispatch,1);
      }
    });
    await t.test('grant revocation and independently changed owner session deny without effects',async()=>{
      state.grant=false;
      assert.equal((await send()).body.result.isError,true);
      state.grant=true;state.changed=true;
      assert.equal((await send()).body.result.isError,true);
      assert.equal(state.dispatch,1);
    });
    await t.test('independently changed native owner SID denies a still-valid token',async()=>{
      state.changed=false;state.sidChanged=true;
      try{
        const result=await send();
        assert.equal(result.status,200);
        assert.equal(result.body.result.isError,true);
        assert.equal(state.dispatch,1);
      }finally{state.sidChanged=false;state.changed=true;}
    });
    await t.test('reviewed protocol bootstrap RPC still reaches V2',async()=>{
      const ping={jsonrpc:'2.0',id:44,method:'ping',
        params:{_meta:{'openai/session':'owner-chat'}}};
      const result=await send(ping);
      assert.equal(result.status,200);
      assert.equal(result.body.result.ok,true);
      assert.equal(state.dispatch,2);
    });
    await t.test('transport revocation denies even a previously valid signed token',async()=>{
      state.trust=false;state.changed=false;
      const result=await send();
      assert.equal(result.status,403);
      assert.equal(state.dispatch,2);
    });
  }finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});
test('dev23 isolated candidate passes the exact six-request installed G1 negative preflight without action authority',async()=>{
  const root=process.env.RC_V2_CANDIDATE_ROOT;
  assert.ok(typeof root==='string'&&path.isAbsolute(root));
  const file=path.join(root,'src','v2-mcp-http-ingress.mjs');
  assert.equal((await stat(file)).isFile(),true);
  const {createV2CandidateHttpIngress}=await import(pathToFileURL(file).href);
  let dispatched=0,attested=0;
  const candidate=createV2CandidateHttpIngress({
    resource:RESOURCE,authorizationServers:[AUTH_SERVER],
    // In this NEGATIVE-ONLY canary NO caller can be authorized. Real mTLS,
    // IdP/owner login and native grant remain separate installed gates.
    attestTransport:async()=>{attested++;return {authenticated:false};},
    dispatcherFactory:async()=>{dispatched++;throw Error('UNREACHABLE_PRIVILEGED_DISPATCHER');}
  });
  const server=http.createServer((req,res)=>{
    if(req.method==='GET'&&req.url==='/health'){
      const body=JSON.stringify({status:'candidate-locked'});
      res.writeHead(200,{
        'content-type':'application/json; charset=utf-8',
        'cache-control':'no-store',
        'content-length':Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }
    candidate.handle(req,res);
  });
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
    const address=server.address();
    assert.equal(address.address,'127.0.0.1');
    assert.ok(address.port>1023);
    const receipt=await probeInstalledG1(address.port);
    assert.equal(receipt.gate,'V101_INSTALLED_G1_INGRESS_PREFLIGHT');
    assert.equal(receipt.status,'NEGATIVE_PREFLIGHT_PASS');
    assert.equal(receipt.code,'ANONYMOUS_AND_FORGED_DENIAL_ONLY');
    assert.equal(receipt.legacyMode,'retired');
    assert.deepEqual(Object.fromEntries(Object.entries(receipt.observations)
      .map(([k,v])=>[k,v.status])),{
        health:200,legacyAnonymous:404,legacyForged:404,
        v2Anonymous:403,v2Forged:403,metadata:200
      });
    for(const claim of [
      'authenticatedCallerProved','signedChatIdentityProved',
      'nativeOwnerGrantProved','authorizedEffectProved',
      'rollbackProved','productionReleaseAuthorized','operationalFullAccessProved'
    ])assert.equal(receipt[claim],false,claim);
    const unauthorized=await fetchRpc('http://127.0.0.1:'+address.port,
      '/mcp-v2',action('tools/call'),
      {'authorization':'Bearer '+'cannot-supply-g1-authority'});
    assert.equal(unauthorized.status,403);
    assert.equal(unauthorized.body.error,'trusted_transport_required');
    assert.equal(unauthorized.noStore,true);
    assert.equal(dispatched,0,'locked candidate must never reach the dispatcher');
    assert.ok(attested>=3,'real V2 transport guard must process each RPC');
  }finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    assert.equal(server.listening,false);
  }
});
