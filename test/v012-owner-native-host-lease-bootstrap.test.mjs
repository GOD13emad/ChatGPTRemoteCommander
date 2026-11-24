import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createV012OwnerNativeHostLease}
  from '../src/v012-owner-native-host-lease-bootstrap.mjs';
import {ensureWindowsMonitorDirectories}
  from '../src/browser-companion-windows-private.mjs';

const win=process.platform==='win32';
const linux=process.platform==='linux';
const hostId='qa-owner-host';
const key=JSON.stringify([1,hostId,'workflow-root','qa-root']);
async function freshOwnerRoot(){
  const root=path.join(os.tmpdir(),'rc012-owner-host-lease-'+randomUUID());
  if(win)await ensureWindowsMonitorDirectories([root],{create:true});
  else fs.mkdirSync(root,{mode:0o700});
  return fs.realpathSync.native(root);
}
test('owner bootstrap refuses ambiguous host or missing pre-existing private directory',{
  skip:!win&&!linux,timeout:20000
},async()=>{
  const absent=path.join(os.tmpdir(),'rc012-no-existing-host-'+randomUUID());
  await assert.rejects(createV012OwnerNativeHostLease({
    directory:absent,hostId:'..'
  }),{code:'V012_OWNER_HOST_LEASE_CONFIGURATION_REQUIRED'});
  await assert.rejects(createV012OwnerNativeHostLease({
    directory:absent,hostId
  }));
  assert.equal(fs.existsSync(absent),false,
    'bootstrap never creates the native host lease directory');
});
test('two independently opened native host leases fence effects and preserve uncertainty',{
  skip:!win&&!linux,timeout:75000
},async()=>{
  const root=await freshOwnerRoot();
  let first,second;
  try{
    first=await createV012OwnerNativeHostLease({directory:root,hostId});
    second=await createV012OwnerNativeHostLease({directory:root,hostId});
    assert.equal(first.hostId,hostId);
    assert.equal(Object.isFrozen(first),true);
    await assert.rejects(first.withLease(
      JSON.stringify([1,'wrong-host','workflow-root','qa-root']),
      async()=>{}),{code:'V012_NATIVE_LEASE_RESOURCE_INVALID'});
    let entered,release;
    const acquired=new Promise(resolve=>entered=resolve);
    const held=new Promise(resolve=>release=resolve);
    const running=first.withLease(key,async()=>{
      entered();
      await held;
      return 'first';
    });
    await acquired;
    try{
      await assert.rejects(second.withLease(key,async()=>{
        throw Error('must not execute');
      }),{code:'V012_NATIVE_LEASE_OCCUPIED'});
    }finally{release();}
    assert.equal(await running,'first');
    assert.equal(await second.withLease(key,async()=> 'second'),'second');
    await assert.rejects(first.withLease(key,async()=>{
      throw Error('unknown external effect');
    }),/unknown external effect/);
    await assert.rejects(second.withLease(key,async()=> 'unsafe retry'),
      {code:'V012_NATIVE_LEASE_OCCUPIED'});
  }finally{
    first?.close();
    second?.close();
    // Only the unique synthetic directory created above is removed.
    fs.rmSync(root,{recursive:true,force:true});
  }
});
