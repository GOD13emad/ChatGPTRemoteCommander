import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHmac } from 'node:crypto';
import { createOwnerRouteIdentity } from '../src/native-owner-route.mjs';
import { writeRouterStateAtomic } from '../src/stable-router.mjs';
import { startLinuxLocalManagement } from '../src/local-management-linux.mjs';
import { createWorkflowTools } from '../src/workflow-tools.mjs';

const supported=process.platform==='linux'&&typeof process.getuid==='function'&&process.getuid()>0;
const native=(name,fn)=>test(name,{skip:!supported,timeout:15000},fn);
const sha='1'.repeat(64),port=34123,profileId='default';
const core={deviceId:'fixture',profileId,configSha256:sha,port};
const route=(generation=1)=>({
  schema:1,profile:profileId,generation,
  active:{version:'0.10.25',commit:'a'.repeat(40),port,configSha256:sha},
});
function fixture(t){
 const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rcm-route-')));
 const routeFile=path.join(dir,'route.json');
 writeRouterStateAtomic(routeFile,route());
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {dir,routeFile,reader:()=>createOwnerRouteIdentity({routerStatePath:routeFile,...core})};
}

native('private validated Router state produces exact target, and generation changes on reread',t=>{
 const f=fixture(t),authority=f.reader();
 assert.deepEqual(authority.target,{deviceId:'fixture',profileId:'default',configSha256:sha,routeGeneration:1});
 assert.deepEqual(authority.readIdentity(),authority.target);
 writeRouterStateAtomic(f.routeFile,route(2),1);
 assert.equal(authority.readIdentity().routeGeneration,2);
 assert.equal(authority.target.routeGeneration,1);
});

native('mismatched active Core port/config/profile are denied before any native endpoint',t=>{
 const f=fixture(t);
 for(const changes of [{port:port+1},{configSha256:'2'.repeat(64)},{profileId:'other'}]){
  assert.throws(()=>createOwnerRouteIdentity({routerStatePath:f.routeFile,...core,...changes}),
    /MANAGEMENT_ROUTER_ACTIVE_CORE_MISMATCH/);
 }
 assert.deepEqual(fs.readdirSync(f.dir),['route.json']);
});

native('no pathname aliases, symlinks, unreadable group/world owner files or hardlinks accepted',t=>{
 const f=fixture(t),p=f.routeFile;
 const alias=path.join(f.dir,'alias.json');fs.symlinkSync(p,alias);
 assert.throws(()=>createOwnerRouteIdentity({routerStatePath:alias,...core}),/MANAGEMENT_ROUTE_/);
 fs.unlinkSync(alias);
 const directoryAlias=f.dir+'-alias';fs.symlinkSync(f.dir,directoryAlias);
 t.after(()=>fs.unlinkSync(directoryAlias));
 assert.throws(()=>createOwnerRouteIdentity({routerStatePath:path.join(directoryAlias,'route.json'),...core}),/MANAGEMENT_ROUTE_/);
 fs.chmodSync(p,0o644);
 assert.throws(f.reader,/MANAGEMENT_ROUTE_FILE_UNTRUSTED/);
 fs.chmodSync(p,0o600);
 fs.linkSync(p,alias);
 assert.throws(f.reader,/MANAGEMENT_ROUTE_FILE_UNTRUSTED/);
 fs.unlinkSync(alias);
 fs.chmodSync(f.dir,0o755);
 assert.throws(f.reader,/MANAGEMENT_ROUTE_DIRECTORY_UNTRUSTED/);
 fs.chmodSync(f.dir,0o700);
 assert.equal(f.reader().target.routeGeneration,1);
});

native('invalid and oversized Router state fails closed without side effects',t=>{
 const f=fixture(t);
 fs.writeFileSync(f.routeFile,'{"schema":1,"profile":"default","generation":1}',{mode:0o600});
 assert.throws(f.reader,/MANAGEMENT_ROUTE_READ_UNVERIFIED/);
 fs.writeFileSync(f.routeFile,'x'.repeat(35000),{mode:0o600});
 assert.throws(f.reader,/MANAGEMENT_ROUTE_FILE_UNTRUSTED/);
 assert.equal(fs.readdirSync(f.dir).length,1);
});

native('live Router rotation revokes original SO_PEERCRED/HMAC session before any Core control',async t=>{
 const f=fixture(t),authority=f.reader();
 const storeDir=path.join(f.dir,'workflows');
 const workflow=createWorkflowTools({config:{durableWorkflows:{enabled:true,directory:storeDir,scheduler:{enabled:false}}},
   roots:[f.dir],device:'fixture',configSha256:sha,lookup:()=>null,validateSchema:()=>[],
   dispatch:async()=>{assert.fail('No project execution from native management');}});
 let controls=0,endpoint=null,socket=null;
 t.after(async()=>{
  socket?.destroy();
  await endpoint?.close();
  await workflow.close();
 });
 await workflow.execute('workflow_create',{id:'sample',root:f.dir,goal:'Routing identity QA only',
   acceptance:['No external actions'],steps:[{id:'never',title:'No execution'}]});
 const resident={definitions:workflow.definitions,execute:(name,args)=>{
   if(name==='workflow_control')controls++;
   return workflow.execute(name,args);
 }};
 endpoint=await startLinuxLocalManagement({enabled:true,runtimeDirectory:f.dir,
   target:authority.target,readIdentity:authority.readIdentity,workflowTools:resident,
   sessionMs:10000,idleMs:3000,maxRequests:1});
 socket=net.createConnection(endpoint.endpoint);
 let buf='',boot=null;
 const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('NO_PEER_BOOTSTRAP')),4000);
  socket.on('error',reject);
  socket.on('data',chunk=>{
   buf+=chunk.toString('utf8');
   if(buf.includes('\n')){
    clearTimeout(timer);
    try{boot=JSON.parse(buf.split('\n')[0]);resolve(boot);}
    catch(e){reject(e);}
   }
  });
 });
 await done;
 assert.equal(boot.session.target.routeGeneration,1);
 const now=Date.now();
 const payload={schema:1,sessionId:boot.session.sessionId,target:boot.session.target,
   requestId:'rotating-1',action:'workflow.pause',workflowId:'sample',
   expectedRevision:1,issuedAtEpochMs:now,expiresAtEpochMs:now+5000};
 const mac=createHmac('sha256',Buffer.from(boot.keyHex,'hex')).update(JSON.stringify(payload)).digest('hex');
 writeRouterStateAtomic(f.routeFile,route(2),1);
 assert.equal(authority.readIdentity().routeGeneration,2);
 socket.write(JSON.stringify({payload,mac})+'\n');
 await new Promise(resolve=>{
  if(socket.destroyed)return resolve();
  socket.once('close',resolve);
  setTimeout(()=>{socket.destroy();resolve();},3000);
 });
 await endpoint.closed;
 assert.equal(controls,0);
 assert.equal((await workflow.execute('workflow_get',{id:'sample'})).state.revision,1);
 assert.equal(endpoint.status().phase,'REVOKED');
});
