import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkspaceTargetJournal} from '../src/workspace-target-journal.mjs';
import {createWorkspaceController} from '../src/workspace-tools.mjs';
async function withDir(fn){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-workspace-journal-'));
 try{return await fn(dir);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
}
test('target-specific incident survives a new journal process without blocking other target',()=>withDir(async dir=>{
 const a=createWorkspaceTargetJournal({dir}),b=createWorkspaceTargetJournal({dir});
 const receipt=await a.begin('a:808:22','workspace_window_click','unique-action-one');
 assert.equal((await b.pending('a:808:22')).id,receipt.id);
 assert.equal(await b.pending('a:808:23'),null);
 const other=await b.begin('a:808:23','workspace_window_click','unique-action-two');
 assert.ok((await b.pending('a:808:23')).id);
 await b.resolve('a:808:23',other);
 assert.equal(await b.pending('a:808:23'),null);
 await assert.rejects(a.begin('a:808:22','workspace_window_click','no-replay'),/WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
 await a.resolve('a:808:22',receipt);
 assert.equal(await b.pending('a:808:22'),null);
}));
test('concurrent controllers may not dispatch the same exact target twice',()=>withDir(async dir=>{
 const j1=createWorkspaceTargetJournal({dir}),j2=createWorkspaceTargetJournal({dir});
 const settled=await Promise.allSettled([
  j1.begin('browser:909:12','workspace_browser_click','race-1'),
  j2.begin('browser:909:12','workspace_browser_click','race-2')
 ]);
 assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(settled.filter(x=>x.status==='rejected').length,1);
 const j=createWorkspaceTargetJournal({dir});
 assert.ok(await j.pending('browser:909:12'));
}));
test('private evidence is minimal, non-secret and owner-private',()=>withDir(async dir=>{
 const store=createWorkspaceTargetJournal({dir});
 await store.begin('b:400:22','workspace_window_click','never-persist-untrusted-auth-header');
 const files=await fs.readdir(dir);
 assert.equal(files.length,1);
 assert.match(files[0],/^[a-f0-9]{64}\.json$/);
 const body=await fs.readFile(path.join(dir,files[0]),'utf8');
 assert.equal(body.includes('never-persist'),false);
 assert.equal(body.includes('b:400:22'),false);
 assert.equal(JSON.parse(body).status,'PENDING_TARGET_EFFECT');
 if(process.platform!=='win32'){
  assert.equal((await fs.stat(dir)).mode&0o077,0);
  assert.equal((await fs.stat(path.join(dir,files[0]))).mode&0o077,0);
 }
}));
test('corrupt evidence locks only its own exact target, not other windows',()=>withDir(async dir=>{
 const store=createWorkspaceTargetJournal({dir});
 await store.begin('a:101:1','workspace_window_click','action-a');
 const files=await fs.readdir(dir);
 await fs.writeFile(path.join(dir,files[0]),'CORRUPT');
 await assert.rejects(store.pending('a:101:1'),/WORKSPACE_JOURNAL_UNAVAILABLE/);
 const next=await store.begin('a:101:2','workspace_window_click','action-b');
 assert.ok(next.id);
}));
test('wrong resolution handle cannot clear pending input',()=>withDir(async dir=>{
 const store=createWorkspaceTargetJournal({dir});
 const a=await store.begin('a:101:1','workspace_window_click','action-a');
 await assert.rejects(store.resolve('a:101:1',{...a,id:'00000000-0000-0000-0000-000000000000'}),
 /WORKSPACE_JOURNAL_RESOLUTION_MISMATCH/);
 assert.equal((await store.pending('a:101:1')).id,a.id);
}));
test('unknown native effect from controller A persists through fresh controller, B unaffected',()=>withDir(async dir=>{
 const opts={ownerSession:async()=>true,now:()=>12345,
  callDriver:async(tool,args)=>{
   if(tool==='get_window_state')return {snapshot_id:args.pid===101?'s00000001':'s00000002',elements:[]};
   if(tool==='click'&&args.target.pid===101)throw Error('native ack lost');
   if(tool==='click')return {ok:true,effect:'confirmed',verified:true};
  }};
 const a=createWorkspaceController({...opts,journal:createWorkspaceTargetJournal({dir})});
 await a.execute('workspace_window_observe',{pid:101,windowId:1});
 let v=await a.execute('workspace_window_click',{pid:101,windowId:1,elementToken:'s00000001:1',
 requestId:'durable-click-owner-1',explicitUserAuthorization:'Authorized test action only'});
 assert.equal(v.decision.status,'RECONCILE_TARGET');
 const b=createWorkspaceController({...opts,journal:createWorkspaceTargetJournal({dir})});
 let s=await b.execute('workspace_window_observe',{pid:101,windowId:1});
 assert.equal(s.targetUncertain,true);
 await assert.rejects(b.execute('workspace_window_click',{pid:101,windowId:1,elementToken:'s00000001:1',
 requestId:'do-not-duplicate',explicitUserAuthorization:'Authorized test action only'}),
 /WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
 await b.execute('workspace_window_observe',{pid:102,windowId:1});
 const other=await b.execute('workspace_window_click',{pid:102,windowId:1,elementToken:'s00000002:1',
 requestId:'durable-independent-click-2',explicitUserAuthorization:'Authorized test action only'});
 assert.equal(other.decision.status,'CONFIRMED');
 const rec=await b.execute('workspace_target_reconcile',{pid:101,windowId:1,
 snapshotId:s.snapshotId,determination:'EFFECT_OBSERVED'});
 assert.equal(rec.ok,true);
 assert.equal(await createWorkspaceTargetJournal({dir}).pending('101:1'),null);
}));
