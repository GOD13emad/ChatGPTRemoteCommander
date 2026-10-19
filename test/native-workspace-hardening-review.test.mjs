import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeWorkspaceCoordinator} from '../src/native-workspace-coordinator.mjs';

// Independent synthetic security review: no physical display, process or GUI is touched.
const ctx=name=>({trusted:true,subject:name,conversationId:'review-'+name});
const identify=c=>c?.trusted===true
  ? {authenticated:true,conversationBound:true,subject:c.subject,conversationId:c.conversationId}
  : null;
const deferred=()=>{
  let resolve;
  const promise=new Promise(r=>{resolve=r;});
  return {promise,resolve};
};
const native=(id,{invalid=false,closeFailure=false,display=':1868',pid=60868}={})=>({
  kind:'native-private-x11',physicalDesktopInput:invalid,
  displayId:display,serverPid:pid,
  observe:async()=>{throw Error('SYNTHETIC_OBSERVATION_NOT_CALLED');},
  input:async()=>({submitted:true}),
  close:async()=>{if(closeFailure)throw Error('SYNTHETIC_UNCERTAIN_TEARDOWN');}
});
const journal=()=>({
  prepare:async()=>({}),
  acknowledge:async()=>({submitted:true}),
  inspect:async()=>({releaseAuthorized:false})
});

test('unknown native cleanup must quarantine the pool before the next launch',async()=>{
  let launched=0;
  const pool=createNativeWorkspaceCoordinator({
    capacity:3,identityResolver:identify,
    launchWorkspace:async()=>{
      const id=++launched;
      return native(id,{display:':'+(1860+id),pid:60860+id,
        invalid:id===1,closeFailure:id===1});
    }
  });
  try{
    await assert.rejects(pool.open(ctx('a')),/NATIVE_WORKSPACE_BACKEND_UNTRUSTED/);
    assert.equal(pool.status(ctx('a')).cleanupFailures,1);
    assert.equal(pool.status(ctx('a')).availableSlots,0,
      'Unknown native cleanup cannot advertise reusable worker capacity');
    await assert.rejects(pool.open(ctx('b')),/NATIVE_WORKSPACE_QUARANTINED/);
    assert.equal(launched,1,'No fresh native worker may launch after uncertainty');
  }finally{
    await pool.close().catch(()=>{});
  }
});

test('concurrent opens may not accept duplicate native display/pid across awaited journal',async()=>{
  const firstEntered=deferred(),releaseJournal=deferred();
  let launched=0;
  const pool=createNativeWorkspaceCoordinator({
    capacity:2,identityResolver:identify,
    launchWorkspace:async()=>{
      ++launched;
      return native(launched,{display:':1877',pid:60877});
    },
    durableJournalFactory:async()=>{
      firstEntered.resolve();
      await releaseJournal.promise;
      return journal();
    }
  });
  const first=pool.open(ctx('a'));
  await firstEntered.promise;
  const second=pool.open(ctx('b'));
  const results=Promise.allSettled([first,second]);
  try{
    await new Promise(resolve=>setImmediate(resolve));
    releaseJournal.resolve();
    const outcome=await results;
    assert.equal(outcome.filter(x=>x.status==='fulfilled').length,0,
      'Unknown duplicate native owner must quarantine both unfinished admissions');
    assert.ok(outcome.some(x=>x.status==='rejected'&&
      /NATIVE_WORKSPACE_TARGET_COLLISION/.test(String(x.reason))),
      'The duplicate target must not be admitted');
    assert.equal(pool.status(ctx('a')).availableSlots,0);
  }finally{
    releaseJournal.resolve();
    await results;
    await pool.close().catch(()=>{});
  }
});

test('in-flight launcher cannot commit after another worker cleanup becomes uncertain',async()=>{
  const started=deferred(),release=deferred();
  let launched=0,closedHealthy=0;
  const pool=createNativeWorkspaceCoordinator({
    capacity:2,identityResolver:identify,
    launchWorkspace:async()=>{
      const id=++launched;
      if(id===1){
        started.resolve();
        await release.promise;
        return {...native(id,{display:':1881',pid:60881}),
          close:async()=>{closedHealthy++;}};
      }
      return native(id,{display:':1882',pid:60882,invalid:true,closeFailure:true});
    }
  });
  const first=pool.open(ctx('a'));
  await started.promise;
  try{
    await assert.rejects(pool.open(ctx('b')),/NATIVE_WORKSPACE_BACKEND_UNTRUSTED/);
    assert.equal(pool.status(ctx('a')).cleanupFailures,1);
    release.resolve();
    await assert.rejects(first,/NATIVE_WORKSPACE_QUARANTINED/);
    assert.equal(closedHealthy,1,'Only the newly launched synthetic worker is closed');
    assert.equal(pool.status(ctx('a')).availableSlots,0);
  }finally{
    release.resolve();
    await first.catch(()=>{});
    await pool.close().catch(()=>{});
  }
});

test('clean rejection of invalid backend does not poison the next admission',async()=>{
  let launched=0;
  const pool=createNativeWorkspaceCoordinator({
    capacity:1,identityResolver:identify,
    launchWorkspace:async()=>{
      const id=++launched;
      return native(id,{display:':'+(1885+id),pid:60885+id,invalid:id===1});
    }
  });
  try{
    await assert.rejects(pool.open(ctx('a')),/NATIVE_WORKSPACE_BACKEND_UNTRUSTED/);
    assert.equal(pool.status(ctx('a')).cleanupFailures,0);
    assert.equal(pool.status(ctx('a')).availableSlots,1);
    const accepted=await pool.open(ctx('b'));
    await pool.end(ctx('b'),accepted.lease);
    assert.equal(launched,2);
  }finally{
    await pool.close();
  }
});
