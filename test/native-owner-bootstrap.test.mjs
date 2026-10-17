import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWorkflowTools} from '../src/workflow-tools.mjs';
import {createOwnerRouteIdentity} from '../src/native-owner-route.mjs';
import {writeRouterStateAtomic} from '../src/stable-router.mjs';
import {startResidentOwnerGtk} from '../src/native-owner-bootstrap.mjs';

const supported=process.platform==='linux' && process.getuid?.()>0;
const native=(name,fn)=>test(name,{skip:!supported,timeout:15000},fn);
const configSha256='1'.repeat(64);
const expected={deviceId:'fixture',profileId:'default',configSha256,port:33129};
const runner=fileURLToPath(new URL('./fixtures/local-management-native-client.py',import.meta.url));
const route=()=>({schema:1,profile:'default',generation:8,
  active:{version:'0.10.25',commit:'a'.repeat(40),port:expected.port,configSha256}});

async function fixture(t){
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rcm-foreground-')));
 const routeFile=path.join(root,'route.json'),runtime=path.join(root,'run'),
   state=path.join(root,'state'),outbox=path.join(root,'outbox');
 for(const p of [runtime,state,outbox])fs.mkdirSync(p,{mode:0o700});
 writeRouterStateAtomic(routeFile,route());
 let sideEffects=0;
 const tools=createWorkflowTools({config:{durableWorkflows:{
   enabled:true,directory:state,scheduler:{enabled:false}}},
   roots:[root],device:'fixture',configSha256,lookup:()=>null,
   validateSchema:()=>[],dispatch:async()=>{sideEffects++;assert.fail('Never dispatch a workflow step');}});
 await tools.execute('workflow_create',{id:'sample',root,goal:'Trusted owner bootstrap isolated QA',
   acceptance:['No effects'],steps:[{id:'never',title:'Never execute'}]});
 t.after(async()=>{await tools.close();fs.rmSync(root,{recursive:true,force:true});});
 const args={enabled:true,localOwnerConsole:true,routerStatePath:routeFile,
   xdgRuntimeDirectory:runtime,workflowDirectory:state,ownerStateDirectory:outbox,
   workflowTools:tools, trustedTestRunner:runner,...expected};
 return {root,routeFile,runtime,outbox,state,tools,args,sideEffects:()=>sideEffects};
}

native('source-only opt-in rejects missing owner request without opening sockets',async t=>{
 const f=await fixture(t);
 await assert.rejects(startResidentOwnerGtk({...f.args,enabled:false}),/MANAGEMENT_NOT_ENABLED/);
 await assert.rejects(startResidentOwnerGtk({...f.args,localOwnerConsole:false}),/MANAGEMENT_OWNER_CONSOLE_REQUIRED/);
 assert.deepEqual(fs.readdirSync(f.runtime),[]);
 assert.equal(f.sideEffects(),0);
});

native('active route binding must match the running Core before any GUI process',async t=>{
 const f=await fixture(t);
 for(const change of [{port:expected.port+1},{configSha256:'2'.repeat(64)},{profileId:'wrong'}]){
  await assert.rejects(startResidentOwnerGtk({...f.args,...change}),/MANAGEMENT_ROUTER_ACTIVE_CORE_MISMATCH/);
 }
 assert.deepEqual(fs.readdirSync(f.runtime),[]);
 assert.equal(f.sideEffects(),0);
});

native('private owner directory permissions block all client/process side effects',async t=>{
 const f=await fixture(t);
 fs.chmodSync(f.outbox,0o755);
 await assert.rejects(startResidentOwnerGtk(f.args),/MANAGEMENT_OWNER_DIRECTORY_UNTRUSTED/);
 assert.deepEqual(fs.readdirSync(f.runtime),[]);
 fs.chmodSync(f.outbox,0o700);
 const alias=path.join(f.root,'link-owner');
 fs.symlinkSync(f.outbox,alias,{type:'dir'});
 await assert.rejects(startResidentOwnerGtk({...f.args,ownerStateDirectory:alias}),/MANAGEMENT_OWNER_DIRECTORY_UNTRUSTED/);
 assert.equal(f.sideEffects(),0);
});

native('already opened WorkflowStore and OS-pinned Python child share one safe session',async t=>{
 const f=await fixture(t);
 const owner=await startResidentOwnerGtk(f.args);
 t.after(async()=>owner.close());
 assert.equal(owner.status().authentication,'LINUX_SO_PEERCRED_PINNED_OWNER_CHILD');
 assert.equal(owner.target.routeGeneration,8);
 const closed=await owner.closed;
 assert.equal(closed.closed,true);
 assert.equal(closed.childExited,true);
 assert.equal(closed.helperExited,true);
 assert.deepEqual(fs.readdirSync(f.runtime),[]);
 assert.equal((await f.tools.execute('workflow_get',{id:'sample'})).state.revision,1);
 assert.equal(f.sideEffects(),0);
});

native('unchanged active Core is required and route rotation is observed afresh',async t=>{
 const f=await fixture(t);
 const authority=createOwnerRouteIdentity({routerStatePath:f.routeFile,...expected});
 assert.equal(authority.target.routeGeneration,8);
 writeRouterStateAtomic(f.routeFile,{...route(),generation:9},8);
 assert.equal(authority.readIdentity().routeGeneration,9);
 const owner=await startResidentOwnerGtk(f.args);
 t.after(()=>owner.close());
 assert.equal(owner.target.routeGeneration,9);
 const result=await owner.closed;
 assert.equal(result.childExited,true);
 assert.equal(f.sideEffects(),0);
});

native('missing or wrong worklow DB never spawns a native GUI',async t=>{
 const f=await fixture(t);
 await f.tools.close();
 const db=path.join(f.state,'workflows.sqlite');
 fs.renameSync(db,db+'.bak');
 await assert.rejects(startResidentOwnerGtk(f.args),/MANAGEMENT_OWNER_FILE_UNTRUSTED/);
 assert.deepEqual(fs.readdirSync(f.runtime),[]);
 fs.renameSync(db+'.bak',db);
});


test('resident server exposes only explicit local CLI flag, not a new MCP tool or web handler',()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('../src/server-v0.3.mjs',import.meta.url)),'utf8');
  assert.match(source,/OWNER_NATIVE_PREVIEW_REQUESTED = process.argv.includes\('--owner-native-gtk-preview'\)/);
  assert.match(source,/process\.stdin\.isTTY !== true/);
  assert.match(source,/await import\('\.\/native-owner-bootstrap\.mjs'\)/);
  assert.match(source,/workflowTools,[\s\S]{0,340}MANAGEMENT_NATIVE_OWNER_PREVIEW_STARTED/);
  assert.equal(source.slice(0,source.indexOf('const server = http.createServer'))
    .includes('startResidentOwnerGtk('),false);
  assert.equal(source.includes("TOOLS.push(...nativeOwner"),false);
});
