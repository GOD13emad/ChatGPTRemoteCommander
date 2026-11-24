import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';
import {createV2PrivatePairOperationGate} from '../src/v2-private-pair-operation-gate.mjs';
import {v2ResourceLeaseKey} from '../src/v2-routing-contract.mjs';
import {readText} from '../src/tools-v0.3.mjs';
import {canonicalizeRoots} from '../src/security-v0.3.mjs';
import {ensureWindowsMonitorDirectories}
  from '../src/browser-companion-windows-private.mjs';
import {createV012HostGlobalOperationLease,
  createV012WindowsHostGlobalOperationLease}
  from '../src/v012-host-global-operation-lease.mjs';

const WINDOWS=process.platform==='win32';
const hostId='qa-owner-host';
const key=JSON.stringify([1,hostId,'workflow-root','owned-fixture']);
const moduleFile=fileURLToPath(new URL('../src/v012-host-global-operation-lease.mjs',import.meta.url));
const makeRoot=async()=>{
  const root=path.join(os.tmpdir(),'rc012-ntfs-host-lease-'+randomUUID());
  await ensureWindowsMonitorDirectories([root],{create:true});
  return root;
};
const discard=root=>{
  if(fs.existsSync(root)&&!fs.lstatSync(root).isSymbolicLink())
    fs.rmSync(root,{recursive:true,force:true});
};

test('Windows native owner-only ACL host lease rejects invalid directories and public bypass', {
  skip:!WINDOWS,timeout:20000
},async()=>{
  const missing=path.join(os.tmpdir(),'rc012-no-such-owner-dir-'+randomUUID());
  await assert.rejects(createV012WindowsHostGlobalOperationLease({
    directory:missing,hostId
  }),/V012_WINDOWS_NATIVE_LEASE_(?:STORAGE_UNTRUSTED|PRIVATE_DIRECTORY_REQUIRED)/);
  assert.equal(fs.existsSync(missing),false,'never create an owner directory implicitly');
  assert.throws(()=>createV012HostGlobalOperationLease({
    directory:missing,hostId,windows:true,verifyWindowsStorage:()=>{}
  }),{code:'V012_NATIVE_LEASE_OWNER_DIRECTORY_REQUIRED'},
  'generic Linux API cannot enable Windows mode via caller-supplied options');
});

test('Windows native ACL-checked SQLite host leases serialize two connections and preserve safe denial', {
  skip:!WINDOWS,timeout:45000
},async()=>{
  const root=await makeRoot();
  let first,second;
  try{
    first=await createV012WindowsHostGlobalOperationLease({directory:root,hostId});
    second=await createV012WindowsHostGlobalOperationLease({directory:root,hostId});
    let entered,unlock;
    const waiting=new Promise(resolve=>entered=resolve);
    const held=new Promise(resolve=>unlock=resolve);
    const running=first.withLease(key,async()=>{
      entered();
      await held;
      return 'first-ok';
    });
    await waiting;
    try{
      await assert.rejects(second.withLease(key,async()=>'SHOULD_NOT_RUN'),
        {code:'V012_NATIVE_LEASE_OCCUPIED'});
    }finally{unlock();}
    assert.equal(await running,'first-ok');
    assert.equal(await second.withLease(key,async()=> 'second-ok'),'second-ok');
    await assert.rejects(first.withLease(key,async()=>{
      throw Error('synthetic unknown effect');
    }),/synthetic unknown effect/);
    await assert.rejects(second.withLease(key,async()=> 'SHOULD_NOT_RUN'),
      {code:'V012_NATIVE_LEASE_OCCUPIED'});
  }finally{first?.close();second?.close();discard(root);}
});

test('Windows native crash preserves an independently held SQLite lease across processes', {
  skip:!WINDOWS,timeout:30000
},async()=>{
  const root=await makeRoot();
  let lease;
  try{
    const childCode=[
      "import {createV012WindowsHostGlobalOperationLease} from "+JSON.stringify(
        new URL('../src/v012-host-global-operation-lease.mjs',import.meta.url).href)+";",
      "const x=await createV012WindowsHostGlobalOperationLease({directory:process.argv[1],hostId:"+JSON.stringify(hostId)+"});",
      "await x.withLease(process.argv[2],async()=>{console.log('QA_LEASE_ACQUIRED');await new Promise(()=>setInterval(()=>{},1000));});"
    ].join('\n');
    const child=spawnSync(process.execPath,
      ['--input-type=module','-e',childCode,root,key],{
        encoding:'utf8',windowsHide:true,timeout:5500,maxBuffer:4096
      });
    assert.equal(child.error?.code,'ETIMEDOUT',
      'child must be force-terminated with lease held');
    assert.match(child.stdout,/QA_LEASE_ACQUIRED/);
    lease=await createV012WindowsHostGlobalOperationLease({directory:root,hostId});
    await assert.rejects(lease.withLease(key,async()=> 'SHOULD_NOT_RUN'),
      {code:'V012_NATIVE_LEASE_OCCUPIED'});
  }finally{lease?.close();discard(root);}
});

test('Windows native lease rejects broad ACL added to its live SQLite file', {
  skip:!WINDOWS,timeout:30000
},async()=>{
  const root=await makeRoot();
  let lease;
  try{
    lease=await createV012WindowsHostGlobalOperationLease({directory:root,hostId});
    const file=path.join(root,'v012-native-operation-leases.sqlite');
    const script=[
      "$ErrorActionPreference='Stop'",
      "$p=$env:RC012_QA_LEASE_FILE",
      "$f=[IO.FileInfo]::new($p)",
      "$acl=$f.GetAccessControl([Security.AccessControl.AccessControlSections]'Owner,Access')",
      "$world=[Security.Principal.SecurityIdentifier]::new('S-1-1-0')",
      "$allow=[Security.AccessControl.FileSystemAccessRule]::new($world,",
      "  [Security.AccessControl.FileSystemRights]::Read,",
      "  [Security.AccessControl.AccessControlType]::Allow)",
      "$acl.AddAccessRule($allow)",
      "$f.SetAccessControl($acl)",
      "[Console]::Write('QA_BROAD_ACL_INJECTED')"
    ].join('\n');
    const result=execFileSync(
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      ['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
        env:{...process.env,RC012_QA_LEASE_FILE:file},
        encoding:'utf8',timeout:8000,windowsHide:true
      });
    assert.equal(result,'QA_BROAD_ACL_INJECTED');
    await assert.rejects(lease.withLease(key,async()=>'SHOULD_NOT_RUN'),
      /V012_WINDOWS_NATIVE_LEASE_STORAGE_UNTRUSTED/);
    await assert.rejects(createV012WindowsHostGlobalOperationLease({
      directory:root,hostId
    }),/V012_WINDOWS_NATIVE_LEASE_STORAGE_UNTRUSTED/);
  }finally{lease?.close();discard(root);}
});
test('Windows native host lease rejects a hardlinked SQLite database', {
  skip:!WINDOWS,timeout:30000
},async t=>{
  const root=await makeRoot();
  let lease;
  try{
    lease=await createV012WindowsHostGlobalOperationLease({directory:root,hostId});
    lease.close();lease=null;
    const database=path.join(root,'v012-native-operation-leases.sqlite');
    try{fs.linkSync(database,path.join(root,'test-alias.sqlite'));}
    catch(error){
      if(['EPERM','EACCES','ENOTSUP'].includes(error?.code))
        return t.skip('NTFS hardlink creation is restricted for this user');
      throw error;
    }
    assert.ok(fs.lstatSync(database).nlink>1);
    await assert.rejects(createV012WindowsHostGlobalOperationLease({
      directory:root,hostId
    }),{code:'V012_NATIVE_LEASE_DATABASE_UNTRUSTED'});
  }finally{lease?.close();discard(root);}
});
test('Windows native protected operation gate runs real Core read_text under durable receipt and host lease', {
  skip:!WINDOWS,timeout:60000
},async()=>{
  const root=await makeRoot();
  const approved=path.join(root,'approved.txt'),other=path.join(root,'other.txt');
  let a,b,receipts;
  try{
    fs.writeFileSync(approved,'windows-owner-fixture\n');
    fs.writeFileSync(other,'different-fixture\n');
    const roots=await canonicalizeRoots([root]);
    a=await createV012WindowsHostGlobalOperationLease({directory:root,hostId});
    b=await createV012WindowsHostGlobalOperationLease({directory:root,hostId});
    receipts=new MutationIdempotencyStore({
      directory:path.join(root,'receipts'),scope:'synthetic-windows-protected'
    });
    const sid='a'.repeat(64),tunnel='b'.repeat(64),binding='c'.repeat(64);
    const route={hostId,profileId:'qa-profile',principalId:'qa-account',
      conversationId:'qa-pair',operationId:'read-one',
      target:{kind:'workflow-root',id:'owned-fixture'}};
    const context={roots,auditLog:path.join(root,'audit.jsonl'),
      config:{allowedRoots:roots,maxReadBytes:524288,
        powerMode:{enabled:false,fullFilesystem:false}}};
    let allowed=false,reads=0,unknown=false;
    const gate=createV2PrivatePairOperationGate({
      hostId,profileId:route.profileId,principalId:route.principalId,
      expectedTunnelIdHash:tunnel,expectedOwnerSidHash:sid,
      attestTransport:async()=>({authenticated:true,
        peerType:'owner-pinned-private-tunnel-mtls',
        sessionSource:'native-owner-private-pair'}),
      resolveOwnerContext:async()=>({
        source:'native-owner-attested',hostId,profileId:route.profileId,
        principalId:route.principalId,conversationId:route.conversationId,
        bindingId:binding,ownerSidHash:sid,tunnelIdHash:tunnel,
        expiresAtMs:Date.now()+60000
      }),
      readCurrentOwnerSidHash:async()=>sid,
      verifyExactNativeGrant:async({tool,arguments:args})=>
        allowed&&tool==='read_text'&&[approved,other].includes(args.path),
      withLease:a.withLease,receiptStore:receipts,
      execute:async(_route,args,tool)=>{
        assert.equal(tool,'read_text');
        reads++;
        if(unknown)throw Error('QA_UNKNOWN_CORE_EFFECT');
        return readText(context,args);
      }
    });
    const invoke=(r=route,p=approved)=>gate.execute({
      request:{},route:r,tool:'read_text',arguments:{path:p}
    });
    await assert.rejects(invoke(),{code:'V2_GRANT_REQUIRED'});
    assert.equal(reads,0);
    allowed=true;
    assert.equal((await invoke()).text,'windows-owner-fixture\n');
    assert.equal((await invoke()).text,'windows-owner-fixture\n');
    assert.equal(reads,1,'one durable receipt must prevent duplicate Core effects');
    await assert.rejects(invoke(route,other),
      {mutationIdempotencyCode:'MUTATION_REQUEST_ID_CONFLICT'});
    const blocked={...route,operationId:'blocked-read'};
    let entered,release;
    const acquired=new Promise(resolve=>entered=resolve);
    const keep=new Promise(resolve=>release=resolve);
    const held=b.withLease(v2ResourceLeaseKey(route),async()=>{
      entered();await keep;
    });
    await acquired;
    try{
      await assert.rejects(invoke(blocked),{code:'V012_NATIVE_LEASE_OCCUPIED'});
      assert.equal(reads,1);
    }finally{release();await held;}
    allowed=false;
    await assert.rejects(invoke({...route,operationId:'after-revoke'}),
      {code:'V2_GRANT_REQUIRED'});
    assert.equal(reads,1);
    allowed=true;
    unknown=true;
    await assert.rejects(invoke({...route,operationId:'unknown-effect'}),
      /QA_UNKNOWN_CORE_EFFECT/);
    assert.equal(reads,2);
    await assert.rejects(invoke({...route,operationId:'another-effect'}),
      {code:'V012_NATIVE_LEASE_OCCUPIED'});
    assert.equal(reads,2,'uncertain effect fences independent operation IDs');
  }finally{receipts?.close();a?.close();b?.close();discard(root);}
});