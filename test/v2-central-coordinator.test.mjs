import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { V2CentralCoordinator } from '../src/v2-central-coordinator.mjs';

const base=Object.freeze({hostId:'host-a',principalId:'owner',
  profileId:'default',conversationId:'chat-a',operationId:'op-a',
  target:{kind:'workflow-root',id:'project-a'}});
const alternate=Object.freeze({...base,conversationId:'chat-b',operationId:'op-b'});
const otherHost=Object.freeze({...base,hostId:'host-b'});
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-central-'));
 let clock=50000,authorize=true;
 const open=()=>new V2CentralCoordinator({directory:dir,now:()=>clock,
   authorizeLease:async()=>authorize});
 return {dir,open,advance:n=>clock+=n,rollback:n=>clock-=n,
   authorize:n=>authorize=n,
   cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('two independent coordinator clients serialize same resource and fence each successor',async()=>{
 const f=fixture(),a=f.open(),b=f.open();
 try{
  const first=await a.acquire({route:base});
  assert.equal(first.fence,1);
  await assert.rejects(b.acquire({route:alternate}),{code:'V2_COORDINATOR_RESOURCE_BUSY'});
  const retry=await b.acquire({route:base});
  assert.deepEqual(retry,first,'lost acknowledgement must not mint another lease');
  assert.equal(await a.assertCurrent({route:base,lease:first}),true);
  assert.equal(await a.release({route:base,lease:first}),true);
  const next=await b.acquire({route:alternate});
  assert.equal(next.fence,2);
  assert.notEqual(next.id,first.id);
  await assert.rejects(a.assertCurrent({route:base,lease:first}),{code:'V2_COORDINATOR_STALE_LEASE'});
  assert.equal(await a.release({route:base,lease:first}),false);
  assert.equal(await b.release({route:alternate,lease:next}),true);
 }finally{a.close();b.close();f.cleanup();}
});
test('an expired original lease cannot renew, release or check after successor fencing',async()=>{
 const f=fixture(),a=f.open(),b=f.open();
 try{
  const old=await a.acquire({route:base,ttlMs:1000});
  f.advance(1001);
  const newer=await b.acquire({route:alternate});
  assert.equal(newer.fence,old.fence+1);
  await assert.rejects(a.renew({route:base,lease:old}),{code:'V2_COORDINATOR_STALE_LEASE'});
  assert.equal(await a.release({route:base,lease:old}),false);
  assert.equal(await b.assertCurrent({route:alternate,lease:newer}),true);
 }finally{a.close();b.close();f.cleanup();}
});
test('closing a coordinator preserves outstanding leases across restart',async()=>{
 const f=fixture();let a=f.open(),b;
 try{
  const original=await a.acquire({route:base,ttlMs:1000});
  a.close();a=null;
  b=f.open();
  await assert.rejects(b.acquire({route:alternate}),{code:'V2_COORDINATOR_RESOURCE_BUSY'});
  f.advance(1000);
  const successor=await b.acquire({route:alternate});
  assert.equal(successor.fence,original.fence+1);
 }finally{a?.close();b?.close();f.cleanup();}
});
test('identity-bound authorization revocation, invalid time and rollback fail closed',async()=>{
 const f=fixture(),a=f.open();
 try{
  f.authorize(false);
  await assert.rejects(a.acquire({route:base}),{code:'V2_COORDINATOR_AUTH_REQUIRED'});
  f.authorize(true);
  const lease=await a.acquire({route:base});
  f.authorize(false);
  await assert.rejects(a.assertCurrent({route:base,lease}),{code:'V2_COORDINATOR_AUTH_REQUIRED'});
  f.authorize(true);
  const changed=await a.renew({route:base,lease});
  f.rollback(1);
  await assert.rejects(a.release({route:base,lease:changed}),{code:'V2_COORDINATOR_CLOCK_ROLLBACK'});
  f.advance(1);
  assert.equal(await a.release({route:base,lease:changed}),true);
 }finally{a.close();f.cleanup();}
});
test('independent hosts are separate resources, but a different chat never borrows a lease',async()=>{
 const f=fixture(),a=f.open(),b=f.open();
 try{
  const first=await a.acquire({route:base});
  const second=await b.acquire({route:otherHost});
  assert.equal(second.fence,1);
  await assert.rejects(b.assertCurrent({route:alternate,lease:first}),
    {code:'V2_COORDINATOR_STALE_LEASE'});
 }finally{a.close();b.close();f.cleanup();}
});
test('fenced worker releases after successful work and rejected work without replay',async()=>{
 const f=fixture(),a=f.open();
 try {
  const out=await a.withFencedLease({route:base,run:async({lease,assertCurrent})=>{
    assert.equal(lease.fence,1);await assertCurrent();return 'read-only-result';
  }});
  assert.equal(out,'read-only-result');
  await assert.rejects(a.withFencedLease({route:base,run:async()=>{throw Error('blocked');}}),/blocked/);
  const successor=await a.acquire({route:alternate});
  assert.equal(successor.fence,3);
 }finally{a.close();f.cleanup();}
});
test('OS process cannot independently take a held cross-process SQLite lease',async()=>{
 const f=fixture(),a=f.open();
 try{
  await a.acquire({route:base});
  const importUrl=new URL('../src/v2-central-coordinator.mjs',import.meta.url).href;
  const code=`import {V2CentralCoordinator} from ${JSON.stringify(importUrl)};
    const c=new V2CentralCoordinator({directory:process.argv[1],
      now:()=>50000,authorizeLease:async()=>true});
    const route=JSON.parse(process.argv[2]);
    try { await c.acquire({route}); process.stdout.write('UNEXPECTED'); process.exitCode=2; }
    catch(e) { process.stdout.write(e.code||'ERROR'); }
    finally {c.close();}`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,f.dir,JSON.stringify(alternate)],
    {encoding:'utf8',timeout:3000});
  assert.equal(child.status,0,child.stderr);
  assert.equal(child.stdout,'V2_COORDINATOR_RESOURCE_BUSY');
 }finally{a.close();f.cleanup();}
});
test('symlink and world-readable coordinator root are refused',()=>{
 const f=fixture();
 try{
  if(process.platform!=='win32'){
    const alias=f.dir+'-alias';
    fs.symlinkSync(f.dir,alias);
    try{
     assert.throws(()=>new V2CentralCoordinator({directory:alias,authorizeLease:()=>true}),
       {code:'V2_COORDINATOR_ALIAS_FORBIDDEN'});
    }finally{fs.rmSync(alias);}
    fs.chmodSync(f.dir,0o755);
    assert.throws(()=>f.open(),{code:'V2_COORDINATOR_PRIVATE_ROOT_REQUIRED'});
  }
 }finally{f.cleanup();}
});

test('expired work is never marked successfully fenced after the worker returns',async()=>{
 const f=fixture(),a=f.open();
 try{
  await assert.rejects(a.withFencedLease({route:base,ttlMs:1000,
    run:async({assertCurrent})=>{await assertCurrent();f.advance(1001);return 'not-confirmed';}
  }),{code:'V2_COORDINATOR_STALE_LEASE'});
 }finally{a.close();f.cleanup();}
});

test('trusted global inventory forces two different hosts onto the same durable fence',async()=>{
 const f=fixture();
 const options={directory:f.dir,now:()=>50000,authorizeLease:async()=>true,
   requireGlobalResource:true,resolveGlobalResource:async r=>
     r.target.kind==='workflow-root'?'company-shared-root-a':null};
 const a=new V2CentralCoordinator(options),b=new V2CentralCoordinator(options);
 try {
  const original=await a.acquire({route:base});
  assert.equal(original.resource,'["global-v1","workflow-root","company-shared-root-a"]');
  assert.equal(original.fence,1);
  await assert.rejects(b.acquire({route:otherHost}),{code:'V2_COORDINATOR_RESOURCE_BUSY'});
  await a.release({route:base,lease:original});
  const successor=await b.acquire({route:otherHost});
  assert.equal(successor.fence,2);
  assert.equal(successor.resource,original.resource);
  await assert.rejects(a.assertCurrent({route:base,lease:original}),
    {code:'V2_COORDINATOR_STALE_LEASE'});
 }finally {a.close();b.close();f.cleanup();}
});

test('global mode refuses missing, invalid or caller-shaped global inventory',async()=>{
 const f=fixture();
 try {
  assert.throws(()=>new V2CentralCoordinator({directory:f.dir,
   authorizeLease:async()=>true,requireGlobalResource:true}),
   {code:'V2_COORDINATOR_GLOBAL_RESOLVER_REQUIRED'});
  const samples=[null,undefined,'','../root','outside/root',{identity:'shared'}];
  for(const sample of samples){
   const c=new V2CentralCoordinator({directory:f.dir,authorizeLease:async()=>true,
     requireGlobalResource:true,resolveGlobalResource:async()=>sample});
   try {
    await assert.rejects(c.acquire({route:base}),{
      code:sample===null?'V2_COORDINATOR_GLOBAL_RESOURCE_UNMAPPED':
        'V2_COORDINATOR_GLOBAL_RESOURCE_INVALID'});
   }finally{c.close();}
  }
 }finally{f.cleanup();}
});

test('trusted global mapping change invalidates previous lease and prevents false completion',async()=>{
 const f=fixture();let identity='physical-volume-a';
 const c=new V2CentralCoordinator({directory:f.dir,authorizeLease:async()=>true,
   resolveGlobalResource:async()=>identity,requireGlobalResource:true});
 try{
  const lease=await c.acquire({route:base});
  identity='physical-volume-b';
  await assert.rejects(c.assertCurrent({route:base,lease}),
    {code:'V2_COORDINATOR_STALE_LEASE'});
  await assert.rejects(c.withFencedLease({route:base,run:async({resource})=>{
   assert.equal(resource,'["global-v1","workflow-root","physical-volume-b"]');
   identity='physical-volume-c';
   return 'should never confirm';
  }}),{code:'V2_COORDINATOR_STALE_LEASE'});
 }finally{c.close();f.cleanup();}
});

test('global resource and immutable fence travel together to the trusted actuator callback',async()=>{
 const f=fixture();
 const c=new V2CentralCoordinator({directory:f.dir,authorizeLease:async()=>true,
  resolveGlobalResource:async()=> 'global-coordinated-root',requireGlobalResource:true});
 try {
  const out=await c.withFencedLease({route:base,run:async({lease,resource,assertCurrent})=>{
   assert.equal(resource,lease.resource);
   assert.equal(resource,'["global-v1","workflow-root","global-coordinated-root"]');
   assert.equal(lease.fence,1);
   await assertCurrent();
   return 'read-only-check';
  }});
  assert.equal(out,'read-only-check');
 }finally{c.close();f.cleanup();}
});
