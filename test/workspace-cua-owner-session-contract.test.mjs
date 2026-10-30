import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWorkspaceController} from '../src/workspace-tools.mjs';
import {createMemoryWorkspaceJournal} from '../src/workspace-target-journal.mjs';

const makeController=(driver)=>createWorkspaceController({
 ownerSession:async()=>true,
 now:()=>5000,
 journal:createMemoryWorkspaceJournal(),
 callDriver:driver
});

test('browser inspect and attach revive exact native CUA session before use',async()=>{
 const calls=[];
 const ctl=makeController(async(name,args)=>{
  calls.push({name,args});
  if(name==='start_session')return {status:'ok'};
  if(name==='get_browser_state')return {status:'refused',refusal:{code:'browser_consent_required'}};
  if(name==='browser_prepare')return {status:'refused',refusal:{code:'browser_route_unavailable'}};
  throw new Error('UNEXPECTED_CUA_TOOL_'+name);
 });
 const pid=32092,windowId=133238;
 const inspected=await ctl.execute('workspace_browser_inspect',{pid,windowId});
 assert.equal(inspected.ok,false);
 assert.equal(inspected.code,'browser_consent_required');
 const attach=await ctl.execute('workspace_browser_attach',{pid,windowId,
  explicitUserAuthorization:'Owner authorized exact-session browser attach for this contract test'});
 assert.equal(attach.ok,false);
 assert.equal(attach.errorCode,'browser_route_unavailable');
 assert.deepEqual(calls.map(v=>v.name),
  ['start_session','get_browser_state','start_session','browser_prepare']);
 assert.ok(calls.every(v=>v.args.session==='rcws-32092-133238'));
});

test('invalid window requestId fails before driver effects, valid click is at most once',async()=>{
 let effects=0;
 const ctl=makeController(async(name)=>{
  if(name==='get_window_state')return {snapshot_id:'s00000012',elements:[]};
  if(name==='click'){effects++;return {effect:'confirmed',verified:true};}
  throw new Error('UNEXPECTED_DRIVER_CALL_'+name);
 });
 const input={pid:32092,windowId:133238,elementToken:'s00000012:1',
  explicitUserAuthorization:'Owner authorized one synthetic isolated click'};
 await ctl.execute('workspace_window_observe',input);
 for(const requestId of [undefined,null,1,{},true])
  await assert.rejects(ctl.execute('workspace_window_click',{...input,requestId}),
   /WORKSPACE_BINDING_INVALID/);
 assert.equal(effects,0);
 const command={...input,requestId:'rc011-contract-once-01'};
 assert.equal((await ctl.execute('workspace_window_click',command)).ok,true);
 assert.equal(effects,1);
 await assert.rejects(ctl.execute('workspace_window_click',command),
  /WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY/);
 assert.equal(effects,1);
});

test('server preserves the caller requestId in delegated background window and browser effects',async()=>{
 const server=await readFile(new URL('../src/server-v0.3.mjs',import.meta.url),'utf8');
 assert.match(server,/const forwarded = name==='workspace_window_click'\|\|name==='workspace_browser_click'/);
 assert.match(server,/executeToolEffect\(name, forwarded, \{ requestId \}\)/);
});
