import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createV012HostGlobalOperationLease} from '../src/v012-host-global-operation-lease.mjs';

const LINUX=process.platform==='linux';
const host='qa-owner-host';
const key=(kind='workflow-root',id='project-one')=>JSON.stringify([1,host,kind,id]);
const setup=t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-native-global-lease-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return directory;
};

test('exact resource is serialized across independently opened host processes', {skip:!LINUX},async t=>{
  const directory=setup(t);
  const a=createV012HostGlobalOperationLease({directory,hostId:host});
  const b=createV012HostGlobalOperationLease({directory,hostId:host});
  t.after(()=>{a.close();b.close();});
  let complete;const hold=new Promise(resolve=>{complete=resolve;});
  const first=a.withLease(key(),async()=>{await hold;return 'first';});
  await assert.rejects(b.withLease(key(),async()=>{throw Error('must not execute');}),
    {code:'V012_NATIVE_LEASE_OCCUPIED'});
  assert.equal(await b.withLease(key('browser-target','other-target'),async()=>42),42);
  assert.throws(()=>a.close(),{code:'V012_NATIVE_LEASE_IN_FLIGHT'});
  complete();assert.equal(await first,'first');
  assert.equal(await b.withLease(key(),async()=>99),99);
});

test('callback failure releases only its owned lease, without converting denial to success', {skip:!LINUX},async t=>{
  const directory=setup(t);
  const a=createV012HostGlobalOperationLease({directory,hostId:host});
  const b=createV012HostGlobalOperationLease({directory,hostId:host});
  t.after(()=>{a.close();b.close();});
  await assert.rejects(a.withLease(key(),async()=>{throw Error('effect failure');}),/effect failure/);
  assert.equal(await b.withLease(key(),async()=>true),true);
});

test('crashed process holds durable denial until separate native reconciliation', {skip:!LINUX},async t=>{
  const directory=setup(t);
  const module=fileURLToPath(new URL('../src/v012-host-global-operation-lease.mjs',import.meta.url));
  const childCode='import {createV012HostGlobalOperationLease} from '+
    JSON.stringify(pathToFileURL(module).href)+';'+
    'const l=createV012HostGlobalOperationLease({directory:process.argv[1],hostId:process.argv[2]});'+
    'l.withLease(process.argv[3],()=>{process.exit(23)});';
  const child=spawnSync(process.execPath,
    ['--input-type=module','-e',childCode,directory,host,key()],
    {encoding:'utf8',timeout:15000});
  assert.equal(child.status,23,child.stderr);
  const check=createV012HostGlobalOperationLease({directory,hostId:host});
  t.after(()=>check.close());
  let effects=0;
  await assert.rejects(check.withLease(key(),async()=>{effects++;}),
    {code:'V012_NATIVE_LEASE_OCCUPIED'});
  assert.equal(effects,0);
});

test('rejects foreign host, JSON alias, malformed callback and unauthorized directory', {skip:!LINUX},async t=>{
  const directory=setup(t);
  const l=createV012HostGlobalOperationLease({directory,hostId:host});
  t.after(()=>l.close());
  let effects=0;
  for(const invalid of [JSON.stringify([1,'foreign','workflow-root','project-one']),
    JSON.stringify([1,host,'random','project-one']),JSON.stringify([1,host,'workflow-root','..']),
    ' [1,"qa-owner-host","workflow-root","project-one"]',JSON.stringify([2,host,'workflow-root','project-one'])]){
    await assert.rejects(l.withLease(invalid,async()=>{effects++;}),
      {code:'V012_NATIVE_LEASE_RESOURCE_INVALID'});
  }
  await assert.rejects(l.withLease(key(),null),{code:'V012_NATIVE_LEASE_CALLBACK_REQUIRED'});
  assert.equal(effects,0);
  fs.chmodSync(directory,0o755);
  assert.throws(()=>createV012HostGlobalOperationLease({directory,hostId:host}),
    {code:'V012_NATIVE_LEASE_DIRECTORY_NOT_PRIVATE'});
  fs.chmodSync(directory,0o700);
});

test('rejects aliased SQLite file instead of opening a foreign database', {skip:!LINUX},t=>{
  const directory=setup(t);
  fs.symlinkSync(path.join(directory,'other-file'),path.join(directory,'v012-native-operation-leases.sqlite'));
  assert.throws(()=>createV012HostGlobalOperationLease({directory,hostId:host}),
    {code:'V012_NATIVE_LEASE_DATABASE_UNTRUSTED'});
});
