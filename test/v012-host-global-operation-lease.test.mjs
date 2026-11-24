import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createV012HostGlobalOperationLease} from '../src/v012-host-global-operation-lease.mjs';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';

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

test('unknown callback outcome quarantines its resource, leaving independent keys usable', {skip:!LINUX},async t=>{
  const directory=setup(t);
  const a=createV012HostGlobalOperationLease({directory,hostId:host});
  const b=createV012HostGlobalOperationLease({directory,hostId:host});
  t.after(()=>{a.close();b.close();});
  let effects=0;
  await assert.rejects(a.withLease(key(),async()=>{
    effects++;
    throw Object.assign(Error('external effect outcome unknown'),{code:'OUTCOME_UNCERTAIN'});
  }),{code:'OUTCOME_UNCERTAIN'});
  await assert.rejects(b.withLease(key(),async()=>{effects++;}),{code:'V012_NATIVE_LEASE_OCCUPIED'});
  assert.equal(effects,1,'unknown-effect resource must not be replayed');
  assert.equal(await b.withLease(key('workflow-root','unrelated-target'),async()=>42),42);
  assert.equal(await a.withLease(key('workflow-root','unrelated-target'),async()=>43),43);
});

test('real durable receipts cannot authorize a second requestId after an unknown effect', {skip:!LINUX},async t=>{
  const directory=setup(t);
  const a=createV012HostGlobalOperationLease({directory,hostId:host});
  const b=createV012HostGlobalOperationLease({directory,hostId:host});
  const receipts=new MutationIdempotencyStore({directory:path.join(directory,'receipts'),scope:'quarantine-qa'});
  t.after(()=>{receipts.close();a.close();b.close();});
  let effects=0;
  const run=(lease,requestId,shouldFail)=>lease.withLease(key(),()=>receipts.execute({
    requestId,tool:'run_project_command',input:{step:requestId}
  },async()=>{
    effects++;
    if(shouldFail)throw Object.assign(Error('effect may still be running'),{code:'OUTCOME_UNCERTAIN'});
    return {ok:true};
  }));
  await assert.rejects(run(a,'first',true),{code:'OUTCOME_UNCERTAIN'});
  assert.deepEqual(receipts.status().states,{UNCERTAIN:1});
  await assert.rejects(run(b,'second',false),{code:'V012_NATIVE_LEASE_OCCUPIED'});
  assert.equal(effects,1,'different requestId must not bypass a resource-level quarantine');
  assert.deepEqual(receipts.status().states,{UNCERTAIN:1});
  // A separate resource retains forward progress without releasing unknown work.
  assert.equal(await b.withLease(key('browser-target','separate'),async()=>42),42);
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

test('new lease database is private even with permissive process umask', {skip:!LINUX},t=>{
  const directory=setup(t);
  const prior=process.umask(0o000);
  try{
    const l=createV012HostGlobalOperationLease({directory,hostId:host});
    l.close();
  }finally{process.umask(prior);}
  const file=path.join(directory,'v012-native-operation-leases.sqlite');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
});

test('rejects aliased SQLite file instead of opening a foreign database', {skip:!LINUX},t=>{
  const directory=setup(t);
  fs.symlinkSync(path.join(directory,'other-file'),path.join(directory,'v012-native-operation-leases.sqlite'));
  assert.throws(()=>createV012HostGlobalOperationLease({directory,hostId:host}),
    {code:'V012_NATIVE_LEASE_DATABASE_UNTRUSTED'});
});
