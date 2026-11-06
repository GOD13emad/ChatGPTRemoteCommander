import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceController} from '../src/workspace-tools.mjs';
import {createMemoryWorkspaceJournal} from '../src/workspace-target-journal.mjs';
test('read-only observation revives only the exact target session before reading',async()=>{
 const calls=[];
 const ctl=createWorkspaceController({platform:'win32',ownerSession:async()=>true,journal:createMemoryWorkspaceJournal(),callDriver:async(name,args)=>{calls.push({name,args});return name==='start_session'?{status:'ok'}:{snapshot_id:'s00000012',elements:[]};}});
 const out=await ctl.execute('workspace_window_observe',{pid:1234,windowId:5678});
 assert.deepEqual(calls.map(x=>x.name),['start_session','get_window_state']);
 assert.ok(calls.every(x=>x.args.session==='rcws-1234-5678'));
 assert.equal(out.focusChanged,false);assert.equal(out.mode,'READ_ONLY');
});
test('spectator preview session cannot inject input and failed admission prevents capture',async()=>{
 const calls=[];
 const ctl=createWorkspaceController({platform:'win32',ownerSession:async()=>true,journal:createMemoryWorkspaceJournal(),callDriver:async(name,args)=>{calls.push({name,args});return {status:'ok'};},previewDriver:async args=>{calls.push({name:'preview',args});return {imageBytes:Buffer.from('fixture-only')};}});
 const out=await ctl.execute('workspace_window_preview',{pid:1234,windowId:5678});
 assert.deepEqual(calls.map(x=>x.name),['start_session','preview']);
 assert.ok(calls.every(x=>x.args.session==='rcws-view-1234-5678'));
 assert.equal(out.__structuredContent.physicalInputTouched,false);assert.equal(out.__structuredContent.focusChanged,false);
 let captured=false;
 const failed=createWorkspaceController({platform:'win32',ownerSession:async()=>true,journal:createMemoryWorkspaceJournal(),callDriver:async()=>{throw Error('SESSION_DENIED');},previewDriver:async()=>{captured=true;}});
 await assert.rejects(failed.execute('workspace_window_preview',{pid:1234,windowId:5678}),/SESSION_DENIED/);assert.equal(captured,false);
});
