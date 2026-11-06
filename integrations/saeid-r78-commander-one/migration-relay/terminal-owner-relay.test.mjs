import test from 'node:test';import assert from 'node:assert/strict';
import {createTerminalOwnerRelay,TERMINAL_METADATA_PROBE} from './terminal-owner-relay.mjs';
import {coreFingerprint,deriveInactiveStage,assessLegacyDrain} from './legacy-r75-adapter.mjs';
import {createHash} from 'node:crypto';import path from 'node:path';
const hash=x=>createHash('sha256').update(x).digest('hex');
const oldCore={device:'saeid',profile:'legacy',pid:1001,creationFileTime:'134383698807009294',port:48935,configSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64)};
const newCore={...oldCore,profile:'candidate',pid:1002,creationFileTime:'134383698807009295',port:48938,configSha256:'c'.repeat(64),sourceSha256:'d'.repeat(64)};
function mock(id,expectedCore,has){
 const s={core:{...expectedCore},sessions:new Map(has?[['term-1',{id:'term-1',pid:71,running:true,interactive:true,stdout:'SYNTHETIC_UNREAD_OUTPUT',stderr:'SYNTHETIC_ERROR',cursor:3,input:[]}]]:[]),probe:0,original:0,requests:[],leak:false,badError:false,lostAck:false,afterProbe:null};
 const backend={id,expectedCore,readIdentity:async()=>({core:{...s.core},observedAtMs:1000}),callMcp:async({body,purpose,expectedCore:bound})=>{
  assert.equal(coreFingerprint(bound),coreFingerprint(s.core));const q=JSON.parse(body);s.requests.push({purpose,q});assert.equal(q.method,'tools/call');
  const a=q.params.arguments,session=s.sessions.get(a.id);
  if(purpose==='METADATA_OWNER_PROBE_ONLY'){
   s.probe++;assert.deepEqual(a,{id:'term-1',...TERMINAL_METADATA_PROBE});
   if(!session)return JSON.stringify({jsonrpc:'2.0',id:q.id,result:{isError:true,content:[{type:'text',text:s.badError?'unauthorized':`unknown terminal session: ${a.id}`}]}});
   const snapshot={id:a.id,pid:session.pid,running:session.running,exitCode:null,signal:null,stdout:s.leak?session.stdout:'',stderr:'',stdoutOffset:session.stdout.length,stderrOffset:session.stderr.length,nextStdoutOffset:null,nextStderrOffset:null,stdoutRemainingChars:0,stderrRemainingChars:0,maxChars:1,truncated:false,interactive:session.interactive,autoClose:!session.interactive};
   s.afterProbe?.();return JSON.stringify({jsonrpc:'2.0',id:q.id,result:{content:[{type:'text',text:JSON.stringify(snapshot,null,2)}],structuredContent:snapshot,isError:false}});
  }
  s.original++;assert.ok(session);if(q.params.name==='send_terminal')session.input.push(a.input);if(s.lostAck)throw Error('OWN_SYNTHETIC_LOST_ACK');
  return JSON.stringify({jsonrpc:'2.0',id:q.id,result:{content:[{type:'text',text:'SYNTHETIC_REQUEST_APPLIED_ONCE'}],isError:false}});
 }};return {s,backend};
}
function fixture(oldHas=true,newHas=false){const a=mock('legacy',oldCore,oldHas),b=mock('candidate',newCore,newHas),consumed=new Set();let auth=true;
 const relay=createTerminalOwnerRelay({backends:[a.backend,b.backend],clock:()=>1000,authorizeFreshRequest:async()=>auth,consumeFreshIntent:async({requestKey,requestDigest})=>{if(consumed.has(requestKey))return {consumed:false,requestDigest};consumed.add(requestKey);return {consumed:true,requestDigest};}});
 const request={name:'read_terminal',arguments:{id:'term-1',consume:false,stdoutOffset:0,stderrOffset:0,maxChars:256,waitMs:0}};
 return {a,b,relay,request,consumed,auth:v=>{auth=v;},run:(requestKey='1'.repeat(64),r=request)=>relay.routeFresh({requestKey,request:r,authorization:{currentUserTask:true}})};
}
test('serialized metadata probes find old owner without reading output or moving cursor; one original read remains on old backend',async()=>{
 const f=fixture();const result=await f.run();assert.equal(result.ownerBackend,'legacy');assert.equal(f.a.s.probe,1);assert.equal(f.b.s.probe,1);assert.equal(f.a.s.original,1);assert.equal(f.b.s.original,0);assert.equal(f.a.s.sessions.get('term-1').cursor,3);assert.equal(result.globalDrainRequired,false);
});
test('new backend owner is selected while old backend stays alive',async()=>{const f=fixture(false,true);assert.equal((await f.run()).ownerBackend,'candidate');assert.equal(f.a.s.original,0);assert.equal(f.b.s.original,1);});
test('both owners reject ambiguity without an original dispatch',async()=>{const f=fixture(true,true);await assert.rejects(f.run(),/OWNER_AMBIGUOUS/);assert.equal(f.a.s.original+f.b.s.original,0);assert.equal(f.consumed.size,0);});
test('unknown ownership does not retry the original request on any backend',async()=>{const f=fixture(false,false);await assert.rejects(f.run(),/OWNER_UNKNOWN/);assert.equal(f.a.s.original+f.b.s.original,0);});
test('authorization error is not treated as owner absence',async()=>{const f=fixture();f.b.s.badError=true;await assert.rejects(f.run(),/PROBE_UNPROVEN/);assert.equal(f.a.s.original+f.b.s.original,0);});
test('unexpected output in a metadata probe fails closed',async()=>{const f=fixture();f.a.s.leak=true;await assert.rejects(f.run(),/PROBE_UNPROVEN/);assert.equal(f.a.s.original,0);});
test('a reused PID or changed source/config generation never borrows old ownership',async()=>{const f=fixture();f.a.s.afterProbe=()=>{f.a.s.core.creationFileTime='134383698807009296';};await assert.rejects(f.run(),/IDENTITY_CHANGED/);assert.equal(f.a.s.original,0);});
test('fresh send is dispatched once only; duplicate request key never repeats input',async()=>{const f=fixture();const r={name:'send_terminal',arguments:{id:'term-1',input:'SYNTHETIC_NEW_INPUT',newline:false}};await f.run('2'.repeat(64),r);await assert.rejects(f.run('2'.repeat(64),r),/INTENT_ALREADY_CONSUMED/);assert.deepEqual(f.a.s.sessions.get('term-1').input,['SYNTHETIC_NEW_INPUT']);});
test('lost original acknowledgement retains consumed intent; no alternate backend fallback or retry',async()=>{const f=fixture();f.a.s.lostAck=true;const r={name:'send_terminal',arguments:{id:'term-1',input:'SYNTHETIC_NEW_INPUT'}};await assert.rejects(f.run('3'.repeat(64),r),/DISPATCH_UNCERTAIN_NO_REPLAY/);await assert.rejects(f.run('3'.repeat(64),r),/INTENT_ALREADY_CONSUMED/);assert.equal(f.a.s.original,1);assert.equal(f.b.s.original,0);});
test('start, stop and general execution tools are rejected before probing',async()=>{for(const name of ['start_terminal','stop_terminal','operation_start','run_shell']){const f=fixture();await assert.rejects(f.run('4'.repeat(64),{name,arguments:{id:'term-1'}}),/ALLOWLIST/);assert.equal(f.a.s.probe+f.b.s.probe,0);}});
test('nonconsuming absolute reads required; no default cursor-consuming read enters relay',async()=>{const f=fixture();delete f.request.arguments.consume;await assert.rejects(f.run(),/REQUEST/);assert.equal(f.a.s.probe,0);});
test('current authorization is required before all probes',async()=>{const f=fixture();f.auth(false);await assert.rejects(f.run(),/CURRENT_AUTHORIZATION_REQUIRED/);assert.equal(f.a.s.probe+f.b.s.probe,0);});
test('uncertain write-ahead intent consumption never dispatches and cannot be consumed again in this process',async()=>{
 const a=mock('legacy',oldCore,true),b=mock('candidate',newCore,false);let claims=0;
 const relay=createTerminalOwnerRelay({backends:[a.backend,b.backend],clock:()=>1000,authorizeFreshRequest:async()=>true,consumeFreshIntent:async()=>{claims++;throw Error('SYNTHETIC_FSYNC_UNCERTAIN');}});
 const arg={requestKey:'5'.repeat(64),authorization:{currentUserTask:true},request:{name:'send_terminal',arguments:{id:'term-1',input:'SYNTHETIC_INPUT'}}};
 await assert.rejects(relay.routeFresh(arg),/INTENT_UNCERTAIN_NO_REPLAY/);await assert.rejects(relay.routeFresh(arg),/INTENT_ALREADY_CONSUMED/);assert.equal(claims,1);assert.equal(a.s.original+b.s.original,0);
});

test('inactive stage retains opaque unknown config fields but isolates all known live state references',()=>{
 const stageRoot=path.resolve('G:/CodexWork/RemoteCommander_ConnectionRecovery_20261027/commander-one-integration-r78/reviews/product/migration-adapter/fixtures/synthetic-stage');
 const config={host:'127.0.0.1',port:48935,unknownFuture:{mustRemain:['opaque',9]},powerMode:{enabled:true,fullFilesystem:true,guiControl:{enabled:true,allowMouse:true},browserControl:{enabled:true,profileRoot:'G:/SYNTHETIC_OLD_BROWSER'}},durableWorkflows:{enabled:true,directory:'G:/SYNTHETIC_OLD_DB',scheduler:{enabled:true},continuation:{enabled:true}},asyncOperations:{enabled:true,stateDir:'G:/SYNTHETIC_OLD_ASYNC'},durableDelivery:{directory:'G:/SYNTHETIC_OLD_DELIVERY'},agentExtensions:{enabled:true},autoUpdate:{enabled:true}};
 const bytes=Buffer.from(JSON.stringify(config)),digest=hash(bytes),adjuncts=[{name:'companion',version:'1.1.2',root:path.resolve('G:/SYNTHETIC_COMPANION'),registrySha256:'e'.repeat(64)},{name:'safeRecovery',version:'1.0.0',root:path.resolve('G:/SYNTHETIC_RECOVERY'),registrySha256:'f'.repeat(64)}];
 const out=deriveInactiveStage({originalConfigBytes:bytes,expectedConfigSha256:digest,stageRoot,targetPort:48938,adjuncts,route:{generation:47,sha256:'1'.repeat(64),port:48935}});
 assert.deepEqual(out.targetConfig.unknownFuture,config.unknownFuture);assert.equal(out.sourceConfigSha256,digest);assert.equal(hash(bytes),digest);assert.equal(out.targetConfig.durableWorkflows.enabled,false);assert.ok(out.targetConfig.durableWorkflows.directory.startsWith(stageRoot));assert.equal(out.targetConfig.asyncOperations.enabled,false);assert.equal(out.targetConfig.powerMode.browserControl.enabled,false);assert.equal(out.startupAllowed,false);assert.equal(out.routeReference.action,'KEEP_OLD_ROUTE');assert.deepEqual(out.adjunctReferences,adjuncts);
});
test('incomplete inventory retains old core but is not a blocker for owner-specific relay',async()=>{
 const registry={schema:1,core:oldCore,observedAtMs:1000,inventoryComplete:false,inventoryReceiptSha256:null,owners:[]};const drain=assessLegacyDrain({registry,currentCore:oldCore,nowMs:1000});assert.equal(drain.status,'KEEP_OLD_CORE_AND_ROUTE');assert.equal(drain.canStopOldCore,false);assert.equal((await fixture().run()).ownerBackend,'legacy');
});
