import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createV012HostGlobalOperationLease} from '../src/v012-host-global-operation-lease.mjs';
import {createV012SharedPhysicalRootFence}
  from '../src/v012-shared-physical-root-fence.mjs';
import {WorkflowStore} from '../src/workflow-store.mjs';

const HOST='fixture-host';
const SHA='1'.repeat(64);
const route=(id='sample')=>({
  hostId:HOST,principalId:'owner',profileId:'default',
  conversationId:'chat-a',operationId:'op-a',
  target:{kind:'workflow-root',id}
});
function fixture(){
  const top=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc012-root-fence-'));
  const owner=path.join(top,'owner'),data=path.join(top,'data'),root=path.join(top,'project');
  for(const dir of [owner,data,root])fs.mkdirSync(dir,{mode:0o700});
  fs.writeFileSync(path.join(root,'proof.txt'),'read only\n');
  return {
    top,owner,data,root,
    cleanup:()=>fs.rmSync(top,{recursive:true,force:true})
  };
}
function newFence(f,{resolver=()=>f.root,allowedRoots=[f.root]}={}){
  const lease=createV012HostGlobalOperationLease({directory:f.owner,hostId:HOST});
  const native=Object.freeze({hostId:HOST,withLease:(key,work)=>lease.withLease(key,work)});
  return {
    fence:createV012SharedPhysicalRootFence({
      nativeHostLease:native,hostId:HOST,allowedRoots,resolveTrustedRouteRoot:resolver
    }),
    close:()=>lease.close()
  };
}
function newStore(f,physicalRootFence){
  const store=new WorkflowStore({
    directory:f.data,allowedRoots:[f.root],device:HOST,configSha256:SHA,
    authority:{profileId:'default',tier:'FULL_POWER',
      capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
    ...(physicalRootFence?{physicalRootFence}:{})
  });
  store.create({
    id:'sample',root:f.root,goal:'Cross-engine root lease contract',
    acceptance:['Shared host-pinned lease'],
    steps:[{id:'first',title:'Read',dependsOn:[]}]
  });
  return store;
}
async function invoke(store,dispatch){
  return store.call({
    id:'sample',stepId:'first',expectedRevision:1,
    tool:'read_text',arguments:{path:'proof.txt'}
  },{validate:async()=>{},dispatch});
}
function waitMarker(child,marker,timeoutMs=10000){
  return new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>{cleanup();reject(Error('CHILD_MARKER_TIMEOUT:'+output));},timeoutMs);
    function cleanup(){
      clearTimeout(timer);
      child.stdout.off('data',onData);
      child.off('exit',onExit);
    }
    function onData(chunk){
      output+=chunk.toString();
      if(output.includes(marker)){cleanup();resolve(output);}
    }
    function onExit(code){cleanup();reject(Error('CHILD_EXIT_BEFORE_MARKER:'+code+':'+output));}
    child.stdout.on('data',onData);child.on('exit',onExit);
  });
}
function waitExit(child,timeoutMs=10000){
  if(child.exitCode!==null)return Promise.resolve(child.exitCode);
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CHILD_EXIT_TIMEOUT')),timeoutMs);
    child.once('exit',code=>{clearTimeout(timer);resolve(code);});
  });
}
if(process.argv[2]==='--holder'){
  const [root,owner]=process.argv.slice(3);
  const lease=createV012HostGlobalOperationLease({directory:owner,hostId:HOST});
  const native={hostId:HOST,withLease:(resource,work)=>lease.withLease(resource,work)};
  const fence=createV012SharedPhysicalRootFence({
    nativeHostLease:native,hostId:HOST,allowedRoots:[root],resolveTrustedRouteRoot:()=>root
  });
  try{
    await fence.withDirectRouteLease(route(),async()=>{
      process.stdout.write('HOLDER_ACQUIRED\n');
      await new Promise((resolve,reject)=>{
        process.stdin.once('data',resolve);process.stdin.once('error',reject);
      });
    });
    process.stdout.write('HOLDER_RELEASED\n');
  }finally{lease.close();}
}else{
  test('two physical OS processes contend for the same canonical root and resume after release', {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture();let child=null;const holder=newFence(f),worker=newFence(f);
    let store;
    try{
      store=newStore(f,worker.fence);
      child=spawn(process.execPath,[new URL(import.meta.url).pathname,'--holder',f.root,f.owner],{
        stdio:['pipe','pipe','pipe']});
      let childErr='';
      child.stderr.on('data',v=>childErr+=v);
      await waitMarker(child,'HOLDER_ACQUIRED');
      let dispatched=0;
      await assert.rejects(
        ()=>invoke(store,async()=>{dispatched++;return{ok:true};}),
        e=>e?.code==='V012_NATIVE_LEASE_OCCUPIED'
      );
      assert.equal(dispatched,0,'no dispatch when another process holds the same root');
      child.stdin.write('done\n');child.stdin.end();
      assert.equal(await waitExit(child),0,childErr);
      child=null;
      const receipt=await invoke(store,async()=>{dispatched++;return{ok:true};});
      assert.equal(receipt?.outcome,'RECORDED_NOT_VALIDATED');
      assert.equal(dispatched,1);
    }finally{
      if(child){child.kill();await waitExit(child).catch(()=>{});}
      store?.close();worker.close();holder.close();f.cleanup();
    }
  });

  test('nested trusted WorkflowStore call reuses already-held direct root fence', {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture(),a=newFence(f);let store;
    try{
      store=newStore(f,a.fence);
      const r=await a.fence.withDirectRouteLease(route(),()=>invoke(store,async()=>({ok:true})));
      assert.equal(r.outcome,'RECORDED_NOT_VALIDATED');
      await assert.rejects(
        ()=>a.fence.withDirectRouteLease(route(),()=>a.fence.withDirectRouteLease(
          {...route(),target:{kind:'browser-target',id:'other'}},async()=>({ok:true}))),
        e=>e?.code==='V012_SHARED_ROOT_CROSS_RESOURCE_NESTING_DENIED'
      );
    }finally{store?.close();a.close();f.cleanup();}
  });

  test('nested separate adapters never bypass one another through async context', {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture(),first=newFence(f),second=newFence(f);
    try{
      await first.fence.withWorkflowRootLease(f.root,async()=>{
        await assert.rejects(
          ()=>second.fence.withWorkflowRootLease(f.root,async()=>({ok:true})),
          e=>e?.code==='V012_NATIVE_LEASE_OCCUPIED');
        return {ok:true};
      });
      const after=await second.fence.withWorkflowRootLease(f.root,async()=>({ok:true}));
      assert.deepEqual(after,{ok:true});
    }finally{second.close();first.close();f.cleanup();}
  });

  test('deferred descendant cannot reuse an inherited released AsyncLocalStorage lease',
    {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture(),a=newFence(f);
    let resume,detached,executed=0;
    const gate=new Promise(resolve=>{resume=resolve;});
    try{
      const outer=await a.fence.withWorkflowRootLease(f.root,async()=>{
        detached=(async()=>{
          await gate;
          return a.fence.withWorkflowRootLease(f.root,async()=>{
            executed++;return {ok:true};
          });
        })();
        return {ok:true};
      });
      assert.equal(outer.ok,true);
      resume();
      await assert.rejects(detached,e=>e?.code==='V012_SHARED_ROOT_STALE_CONTEXT_DENIED');
      assert.equal(executed,0);
      const later=await a.fence.withWorkflowRootLease(f.root,async()=>({ok:true}));
      assert.equal(later.ok,true);
    }finally{resume?.();await detached?.catch(()=>{});a.close();f.cleanup();}
  });

  test('unawaited in-flight descendant quarantines root before outer callback releases',
    {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture(),a=newFence(f);
    let finish,entered,child;
    const hold=new Promise(resolve=>{finish=resolve;});
    const started=new Promise(resolve=>{entered=resolve;});
    try{
      await assert.rejects(
        ()=>a.fence.withWorkflowRootLease(f.root,async()=>{
          child=a.fence.withWorkflowRootLease(f.root,async()=>{
            entered();await hold;return {ok:true};
          });
          await started;
          return {ok:true};
        }),
        e=>e?.code==='V012_SHARED_ROOT_DETACHED_EFFECT_QUARANTINED');
      await assert.rejects(
        ()=>a.fence.withWorkflowRootLease(f.root,async()=>({ok:true})),
        e=>e?.code==='V012_NATIVE_LEASE_OCCUPIED');
    }finally{finish?.();await child?.catch(()=>{});a.close();f.cleanup();}
  });

  test('pre-effect revision and validation denial free native root without dispatch',
    {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture(),a=newFence(f);let store,effects=0;
    try{
      store=newStore(f,a.fence);
      await assert.rejects(
        ()=>store.call({
          id:'sample',stepId:'first',expectedRevision:99,
          tool:'read_text',arguments:{path:'proof.txt'}
        },{validate:async()=>{},dispatch:async()=>{effects++;return{ok:true};}}),
        e=>(e?.workflowCode??e?.code)==='WORKFLOW_REVISION_CONFLICT');
      assert.equal(effects,0);
      await assert.rejects(
        ()=>store.call({
          id:'sample',stepId:'first',expectedRevision:1,
          tool:'read_text',arguments:{path:'proof.txt'}
        },{validate:async()=>{throw Object.assign(new Error('DENIED'),{code:'TEST_NO_GRANT'});},
          dispatch:async()=>{effects++;return{ok:true};}}),
        e=>e?.code==='TEST_NO_GRANT');
      assert.equal(effects,0);
      const good=await invoke(store,async()=>{effects++;return{ok:true};});
      assert.equal(good.outcome,'RECORDED_NOT_VALIDATED');
      assert.equal(effects,1);
    }finally{store?.close();a.close();f.cleanup();}
  });

  test('real WorkflowStore uncertain external dispatch retains native root quarantine',
    {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture(),a=newFence(f);let store;
    try{
      store=newStore(f,a.fence);
      const uncertain=await invoke(store,async()=>{throw Error('SYNTHETIC_TOOL_UNCERTAIN');});
      assert.equal(uncertain.outcome,'UNCERTAIN');
      await assert.rejects(
        ()=>a.fence.withWorkflowRootLease(f.root,async()=>({ok:true})),
        e=>e?.code==='V012_NATIVE_LEASE_OCCUPIED');
    }finally{store?.close();a.close();f.cleanup();}
  });

  test('an asynchronous nested effect cannot be released by outer pre-dispatch validation denial',
    {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture(),a=newFence(f);let store,release,entered,child;
    const hold=new Promise(resolve=>{release=resolve;});
    const began=new Promise(resolve=>{entered=resolve;});
    try{
      store=newStore(f,a.fence);
      await assert.rejects(
        ()=>store.call({
          id:'sample',stepId:'first',expectedRevision:1,
          tool:'read_text',arguments:{path:'proof.txt'}
        },{
          validate:async()=>{
            child=a.fence.withWorkflowRootLease(f.root,async()=>{
              entered();await hold;return {ok:true};
            });
            await began;
            throw Object.assign(new Error('DENIED'),{code:'TEST_DENY'});
          },
          dispatch:async()=>{throw Error('SHOULD_NOT_DISPATCH');}
        }),
        e=>e?.code==='V012_SHARED_ROOT_PRE_EFFECT_UNPROVEN');
      await assert.rejects(
        ()=>a.fence.withWorkflowRootLease(f.root,async()=>({ok:true})),
        e=>e?.code==='V012_NATIVE_LEASE_OCCUPIED');
    } finally {
      release?.();await child?.catch(()=>{});
      store?.close();a.close();f.cleanup();
    }
  });

  test('non-workflow direct host shell and desktop/browser routes cannot bypass active root owner lease',
    {skip:process.platform==='win32'?'Linux native fixture; Windows ACL separate':false},async()=>{
    const f=fixture(),first=newFence(f),second=newFence(f);
    try{
      let effects=0;
      await first.fence.withWorkflowRootLease(f.root,async()=>{
        for(const kind of ['host-shell','desktop-seat','browser-target']){
          await assert.rejects(
            ()=>second.fence.withDirectRouteLease({
              ...route(),target:{kind,id:'cross-kind-qa'}
            },async()=>{effects++;return {ok:true};}),
            e=>e?.code==='V012_NATIVE_LEASE_OCCUPIED');
        }
        assert.equal(effects,0,
          'shell/desktop/browser must not dispatch while physical project root is held');
        return {ok:true};
      });
      assert.equal((await second.fence.withDirectRouteLease({
        ...route(),target:{kind:'host-shell',id:'cross-kind-qa'}
      },async()=>({ok:true}))).ok,true);
    }finally{second.close();first.close();f.cleanup();}
  });

  test('uncertain workflow outcome returns receipt but quarantines native root lease', {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture(),a=newFence(f);
    try{
      const result=await a.fence.withWorkflowRootLease(f.root,async()=>({
        outcome:'UNCERTAIN',receipt:{errorCode:'UNTRUSTED_EFFECT'}
      }));
      assert.equal(result.outcome,'UNCERTAIN');
      await assert.rejects(
        ()=>a.fence.withWorkflowRootLease(f.root,async()=>({ok:true})),
        e=>e?.code==='V012_NATIVE_LEASE_OCCUPIED');
    }finally{a.close();f.cleanup();}
  });

  test('overlapping canonical nested project roots must share one host-wide native claim',
    {skip:process.platform==='win32'?'Linux native SQLite; native Windows ACL separately':false},async()=>{
    const f=fixture();
    const childRoot=path.join(f.root,'nested');
    fs.mkdirSync(childRoot,{mode:0o700});
    // Two independent Core processes may each enroll a different canonical
    // scope, yet parent and descendant effects MUST use the same host lock.
    const first=newFence(f,{allowedRoots:[f.root]});
    const second=newFence(f,{allowedRoots:[childRoot]});
    try{
      await first.fence.withWorkflowRootLease(f.root,async()=>{
        await assert.rejects(
          ()=>second.fence.withWorkflowRootLease(childRoot,async()=>({ok:true})),
          e=>e?.code==='V012_NATIVE_LEASE_OCCUPIED');
        return {ok:true};
      });
      const accepted=await second.fence.withWorkflowRootLease(childRoot,async()=>({ok:true}));
      assert.equal(accepted.ok,true);
    }finally{second.close();first.close();f.cleanup();}
  });

  test('trusted owner root mapping refuses paths outside enrollment and alias targets', {skip:process.platform==='win32'?'Linux native factory; Windows native ACL suite is separate':false},async()=>{
    const f=fixture();
    const outside=path.join(f.top,'outside');
    fs.mkdirSync(outside,{mode:0o700});
    const a=newFence(f,{resolver:()=>outside});
    try{
      await assert.rejects(
        ()=>a.fence.withDirectRouteLease(route(),async()=>({ok:true})),
        e=>e?.code==='V012_SHARED_ROOT_OUTSIDE_ENROLLMENT');
      if(process.platform!=='win32'){
        const alias=path.join(f.top,'alias');
        fs.symlinkSync(f.root,alias,'dir');
        await assert.rejects(
          ()=>a.fence.withWorkflowRootLease(alias,async()=>({ok:true})),
          e=>e?.code==='V012_SHARED_ROOT_ALIAS_DENIED');
      }
    }finally{a.close();f.cleanup();}
  });

  test('host-wide native resource key also covers shell desktop and browser route kinds',async()=>{
    const f=fixture(),used=[];
    try{
      const native={
        hostId:HOST,
        async withLease(key,work){
          used.push(key);
          return work({markEffectStarted(){},markSafePreEffectDenial(){}});
        }
      };
      const fence=createV012SharedPhysicalRootFence({
        nativeHostLease:native,hostId:HOST,
        allowedRoots:[f.root],resolveTrustedRouteRoot:()=>f.root
      });
      await fence.withWorkflowRootLease(f.root,async()=>({ok:true}));
      for(const kind of ['host-shell','desktop-seat','browser-target']){
        await fence.withDirectRouteLease({...route(),
          target:{kind,id:'protected-route'}
        },async()=>({ok:true}));
      }
      assert.equal(used.length,4);
      assert.equal(new Set(used).size,1,
        'all potentially project-mutating route kinds need one host-wide owner fence');
    }finally{f.cleanup();}
  });

  test('pure root-to-key contract is deterministic across route and WorkflowStore shapes',async()=>{
    const f=fixture(),used=[];
    const trustedNative={
      hostId:HOST,
      async withLease(key,work){
        used.push(key);
        return work({markEffectStarted(){},markSafePreEffectDenial(){}});
      }
    };
    const fence=createV012SharedPhysicalRootFence({
      nativeHostLease:trustedNative,hostId:HOST,
      allowedRoots:[f.root],resolveTrustedRouteRoot:()=>f.root
    });
    try{
      await fence.withDirectRouteLease(route(),async()=>({ok:true}));
      await fence.withWorkflowRootLease(f.root,async()=>({ok:true}));
      assert.equal(used.length,2);
      assert.equal(used[0],used[1]);
      const parsed=JSON.parse(used[0]);
      assert.equal(parsed[0],1);
      assert.equal(parsed[1],HOST);
      assert.equal(parsed[2],'workflow-root');
      assert.match(parsed[3],/^[a-f0-9]{64}$/);
      await assert.rejects(
        ()=>fence.withDirectRouteLease({...route(),hostId:'different-host'},async()=>({ok:true})),
        e=>e?.code==='V012_SHARED_ROOT_HOST_MISMATCH');
    }finally{f.cleanup();}
  });

  test('platform-neutral stale descendant requires fresh native admission instead of inherited context',async()=>{
    const f=fixture();
    let acquisitions=0,resume,late,executed=0;
    const gate=new Promise(resolve=>{resume=resolve;});
    const native={
      hostId:HOST,
      async withLease(key,work){
        acquisitions++;
        return work({markEffectStarted(){},markSafePreEffectDenial(){}});
      }
    };
    const bridge=createV012SharedPhysicalRootFence({
      nativeHostLease:native,hostId:HOST,
      allowedRoots:[f.root],resolveTrustedRouteRoot:()=>f.root
    });
    try{
      await bridge.withWorkflowRootLease(f.root,async()=>{
        late=(async()=>{
          await gate;
          return bridge.withWorkflowRootLease(f.root,async()=>{executed++;return{ok:true};});
        })();
        return{ok:true};
      });
      resume();
      await assert.rejects(late,e=>e?.code==='V012_SHARED_ROOT_STALE_CONTEXT_DENIED');
      assert.equal(executed,0);
      assert.equal(acquisitions,1);
      await bridge.withWorkflowRootLease(f.root,async()=>({ok:true}));
      assert.equal(acquisitions,2);
    }finally{resume?.();await late?.catch(()=>{});f.cleanup();}
  });

  test('queued direct operation receipt cannot release the root before its external worker finishes',async()=>{
    const f=fixture();let held=false,quarantined=false,effects=0;
    const native={hostId:HOST,async withLease(_key,work){
      if(held)throw Object.assign(Error('occupied'),{code:'V012_NATIVE_LEASE_OCCUPIED'});
      held=true;
      let completed=false;
      try{
        const result=await work({markEffectStarted(){},markSafePreEffectDenial(){}});
        completed=true;
        return result;
      }finally{
        if(completed)held=false;
        else quarantined=true;
      }
    }};
    const fence=createV012SharedPhysicalRootFence({
      nativeHostLease:native,hostId:HOST,allowedRoots:[f.root],
      resolveTrustedRouteRoot:()=>f.root
    });
    try{
      const receipt={operationId:'detached-worker',status:'QUEUED'};
      assert.equal(await fence.withDirectRouteLease(route(),async()=>receipt),receipt);
      await assert.rejects(
        fence.withWorkflowRootLease(f.root,async()=>{effects++;}),
        {code:'V012_NATIVE_LEASE_OCCUPIED'});
      assert.equal(effects,0);
      assert.equal(quarantined,true);
    }finally{f.cleanup();}
  });

  test('real native SQLite keeps a queued direct operation fenced from WorkflowStore',{
    skip:process.platform==='win32'?'POSIX native factory; Windows native ACL suite is separate':false
  },async()=>{
    const f=fixture(),direct=newFence(f),worker=newFence(f);let store,effects=0;
    try{
      store=newStore(f,worker.fence);
      const receipt={operationId:'queued-native-worker',status:'QUEUED'};
      assert.equal(await direct.fence.withDirectRouteLease(route(),async()=>receipt),receipt);
      await assert.rejects(invoke(store,async()=>{effects++;return{ok:true};}),
        {code:'V012_NATIVE_LEASE_OCCUPIED'});
      assert.equal(effects,0);
    }finally{store?.close();worker.close();direct.close();f.cleanup();}
  });

  test('root admission requires an owner-enrolled canonical map and pinned native host',()=>{
    const f=fixture();
    try{
      assert.throws(()=>createV012SharedPhysicalRootFence({
        nativeHostLease:{hostId:HOST,withLease:async()=>{}},
        hostId:HOST,allowedRoots:[f.root]
      }),e=>e?.code==='V012_SHARED_ROOT_BOOTSTRAP_REQUIRED');
      assert.throws(()=>createV012SharedPhysicalRootFence({
        nativeHostLease:{hostId:'other',withLease:async()=>{}},
        hostId:HOST,allowedRoots:[f.root],resolveTrustedRouteRoot:()=>f.root
      }),e=>e?.code==='V012_SHARED_ROOT_BOOTSTRAP_REQUIRED');
    }finally{f.cleanup();}
  });
}
