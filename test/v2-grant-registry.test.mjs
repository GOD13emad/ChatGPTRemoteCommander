import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { V2GrantRegistry } from '../src/v2-grant-registry.mjs';
import { executeV2BoundOperation } from '../src/v2-authorized-operation.mjs';
import { MutationIdempotencyStore } from '../src/mutation-idempotency.mjs';
const route = (patch={}) => ({
  hostId:'emad-win',principalId:'owner',profileId:'default',
  conversationId:'chat-one',operationId:'op-one',
  target:{kind:'workflow-root',id:'root-one'},...patch
});
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-grants-'));
  const auth=({actor})=>actor==='verified-admin';
  const a=new V2GrantRegistry({directory:dir,authorizeAdministration:auth});
  const b=new V2GrantRegistry({directory:dir,authorizeAdministration:auth});
  return {a,b,dir,close(){a.close();b.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
const change=(r,status,expectedRevision,actor='verified-admin')=>({
  route:r,tool:'workflow_call',status,expectedRevision,actor,reason:'approved for test fixture'
});
test('default deny without a grant across all conversations',()=>{
  const f=fixture();try{assert.equal(f.a.read(route(),'workflow_call'),null);assert.equal(f.a.isAllowed(route(),'workflow_call'),false);}
  finally{f.close();}
});
test('grant and revoke are observed by another process-style store handle',()=>{
  const f=fixture();try{
    assert.equal(f.a.change(change(route(),'ENABLED',0)).revision,1);
    assert.equal(f.b.isAllowed(route(),'workflow_call'),true);
    assert.equal(f.b.isAllowed(route({conversationId:'chat-two'}),'workflow_call'),false);
    assert.equal(f.b.change(change(route(),'REVOKED',1)).revision,2);
    assert.equal(f.a.isAllowed(route(),'workflow_call'),false);
    assert.equal(f.a.events(route(),'workflow_call').length,2);
  }finally{f.close();}
});
test('stale revision conflicts and NO_OP do not create extra audit events',()=>{
  const f=fixture();try{
    f.a.change(change(route(),'ENABLED',0));
    assert.equal(f.b.change(change(route(),'ENABLED',1)).revision,1);
    assert.equal(f.a.events(route(),'workflow_call').length,1);
    assert.throws(()=>f.b.change(change(route(),'REVOKED',0)),{code:'V2_GRANT_REVISION_CONFLICT'});
    assert.equal(f.b.events(route(),'workflow_call').length,1);
  }finally{f.close();}
});
test('unverified administrator cannot grant or revoke',()=>{
  const f=fixture();try{
    assert.throws(()=>f.a.change(change(route(),'ENABLED',0,'ordinary-user')),{code:'V2_GRANT_ADMIN_AUTH_REQUIRED'});
    assert.equal(f.a.read(route(),'workflow_call'),null);
  }finally{f.close();}
});
test('principal, profile, host, resource and tool are distinct',()=>{
  const f=fixture();try{
    f.a.change(change(route(),'ENABLED',0));
    for(const r of [route({principalId:'saeed'}),route({profileId:'other'}),route({hostId:'mmz-linux'}),
      route({target:{kind:'workflow-root',id:'root-two'}}),route({target:{kind:'desktop-seat',id:'root-one'}})]) {
      assert.equal(f.b.isAllowed(r,'workflow_call'),false);
    }
    assert.equal(f.b.isAllowed(route(),'write_text'),false);
  }finally{f.close();}
});
test('regrant after revoke has new revision; prior receipts are not silently reauthorized',()=>{
  const f=fixture();try{
    f.a.change(change(route(),'ENABLED',0));
    f.a.change(change(route(),'REVOKED',1));
    assert.equal(f.b.isAllowed(route(),'workflow_call'),false);
    assert.equal(f.b.change(change(route(),'ENABLED',2)).revision,3);
    assert.deepEqual(f.a.events(route(),'workflow_call').map(x=>x.revision),[1,2,3]);
  }finally{f.close();}
});
test('refuse absent admin callback and invalid revision without modifying data',()=>{
  const f=fixture();try{
    assert.throws(()=>new V2GrantRegistry({directory:f.dir}),{code:'V2_GRANT_ADMIN_PROVIDER_REQUIRED'});
    assert.throws(()=>f.a.change(change(route(),'ENABLED',-1)),{code:'V2_GRANT_EXPECTED_REVISION_REQUIRED'});
    assert.throws(()=>f.a.change(change(route(),'REVOKED',0)),{code:'V2_GRANT_NOT_FOUND'});
    assert.equal(f.a.events(route(),'workflow_call').length,0);
  }finally{f.close();}
});
test('grant registry drives bound adapter and revoke blocks further actions',async()=>{
  const f=fixture();
  const receiptStore = new MutationIdempotencyStore({directory:path.join(f.dir,'receipts'),scope:'test'});
  let effects=0;
  try{
    const services={
      observedCaller:async()=>({hostId:'emad-win',principalId:'owner',profileId:'default',conversationId:'chat-one'}),
      hasGrant:async(r,tool)=>f.b.isAllowed(r,tool),
      withLease:async(_key,fn)=>fn(),receiptStore,
      execute:async()=>{effects++;return {effects};}
    };
    await assert.rejects(executeV2BoundOperation(route(),services,'workflow_call'),{code:'V2_GRANT_REQUIRED'});
    f.a.change(change(route(),'ENABLED',0));
    assert.equal((await executeV2BoundOperation(route(),services,'workflow_call')).effects,1);
    f.a.change(change(route(),'REVOKED',1));
    await assert.rejects(executeV2BoundOperation(route({operationId:'op-two'}),services,'workflow_call'),{code:'V2_GRANT_REQUIRED'});
    assert.equal(effects,1);
  }finally{receiptStore.close();f.close();}
});

test('a second Node process sees committed revocation and rejects stale CAS', async()=>{
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const grantUrl = new URL('../src/v2-grant-registry.mjs', import.meta.url).href;
  const f=fixture();
  try{
    const current=route();
    f.a.change(change(current,'ENABLED',0));
    const script = `
      import { V2GrantRegistry } from ${JSON.stringify(grantUrl)};
      const directory = process.argv[1];
      const route = JSON.parse(process.argv[2]);
      const store=new V2GrantRegistry({directory,authorizeAdministration:({actor})=>actor==='verified-admin'});
      try {
        const before=store.isAllowed(route,'workflow_call');
        const state=store.change({route,tool:'workflow_call',status:'REVOKED',expectedRevision:1,actor:'verified-admin',reason:'scoped revoke fixture'});
        process.stdout.write(JSON.stringify({before,after:state.status,revision:state.revision}));
      } finally {store.close();}
    `;
    const child=spawnSync(process.execPath,['--input-type=module','--eval',script,f.dir,JSON.stringify(current)],{encoding:'utf8',timeout:5000,windowsHide:true});
    assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),{before:true,after:'REVOKED',revision:2});
    assert.equal(f.a.isAllowed(current,'workflow_call'),false);
    assert.throws(()=>f.a.change(change(current,'ENABLED',1)),{code:'V2_GRANT_REVISION_CONFLICT'});
  }finally{f.close();}
});

test('persistent revoke during lease wait blocks first effect without a receipt', async()=>{
  const f=fixture();
  const receipts=new MutationIdempotencyStore({directory:path.join(f.dir,'receipts-revoke'),scope:'owner-test'});
  let effects=0;
  let entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  let resume;
  const held=new Promise(resolve=>{resume=resolve;});
  try {
    f.a.change(change(route(),'ENABLED',0));
    const services={
      observedCaller:async()=>({hostId:'emad-win',principalId:'owner',profileId:'default',conversationId:'chat-one'}),
      hasGrant:async(r,tool)=>f.b.isAllowed(r,tool),
      withLease:async(_key,run)=>{entered();await held;return run();},
      receiptStore:receipts,
      execute:async()=>{effects++;return {effects};}
    };
    const pending=executeV2BoundOperation(route(),services,'workflow_call');
    await waiting;
    assert.equal(f.a.change(change(route(),'REVOKED',1)).status,'REVOKED');
    resume();
    await assert.rejects(pending,{code:'V2_GRANT_REQUIRED'});
    assert.equal(effects,0);
    assert.deepEqual(receipts.status().states,{});
  }finally{receipts.close();f.close();}
});

test('two chats of the same user require separate grants and isolated revocations',()=>{
 const f=fixture();
 try{
   const a=route(),b=route({conversationId:'chat-two'});
   f.a.change(change(a,'ENABLED',0));
   assert.equal(f.b.isAllowed(b,'workflow_call'),false);
   assert.equal(f.b.read(b,'workflow_call'),null);
   f.b.change(change(b,'ENABLED',0));
   assert.equal(f.a.isAllowed(a,'workflow_call'),true);
   assert.equal(f.a.isAllowed(b,'workflow_call'),true);
   f.a.change(change(a,'REVOKED',1));
   assert.equal(f.b.isAllowed(a,'workflow_call'),false);
   assert.equal(f.b.isAllowed(b,'workflow_call'),true);
   assert.deepEqual(f.a.events(a,'workflow_call').map(e=>e.revision),[1,2]);
   assert.deepEqual(f.a.events(b,'workflow_call').map(e=>e.revision),[1]);
 }finally{f.close();}
});
test('legacy grant schema v1 fails closed, not silently sharing chat grants',async()=>{
 const { DatabaseSync } = await import('node:sqlite');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-grants-v1-'));
 const old=new DatabaseSync(path.join(dir,'v2-access.sqlite'));
 try{old.exec('PRAGMA user_version=1;');}finally{old.close();}
 try{assert.throws(()=>new V2GrantRegistry({directory:dir,authorizeAdministration:()=>true}),
    {code:'V2_GRANT_SCHEMA_MIGRATION_REQUIRED'});}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
