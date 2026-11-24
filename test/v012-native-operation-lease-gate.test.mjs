import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createV012HostGlobalOperationLease} from '../src/v012-host-global-operation-lease.mjs';
import {createV2PrivatePairOperationGate} from '../src/v2-private-pair-operation-gate.mjs';
import {v2ResourceLeaseKey} from '../src/v2-routing-contract.mjs';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';
import {readText} from '../src/tools-v0.3.mjs';

const LINUX=process.platform==='linux';
const SID='a'.repeat(64),TUNNEL='b'.repeat(64),BINDING='c'.repeat(64);

test('real Core read_text runs only after verified synthetic native grant, durable receipt and host-global lease', {skip:!LINUX},async t=>{
  // Synthetic native identity is intentionally NOT a live owner grant.
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc012-global-gate-')));
  const approved=path.join(root,'approved.txt'),other=path.join(root,'other.txt');
  fs.writeFileSync(approved,'approved fixture\n');
  fs.writeFileSync(other,'other fixture\n');
  const a=createV012HostGlobalOperationLease({directory:root,hostId:'qa-owner-host'});
  const b=createV012HostGlobalOperationLease({directory:root,hostId:'qa-owner-host'});
  const receipts=new MutationIdempotencyStore({directory:path.join(root,'receipts'),scope:'private-gate-lease-qa'});
  t.after(()=>{receipts.close();a.close();b.close();fs.rmSync(root,{recursive:true,force:true});});
  const route={hostId:'qa-owner-host',profileId:'qa-profile',principalId:'qa-account',
    conversationId:'qa-pair',operationId:'qa-operation',target:{kind:'workflow-root',id:'qa-target'}};
  let granted=true,reads=0;
  const ctx={roots:[root],auditLog:path.join(root,'audit.jsonl'),
    config:{allowedRoots:[root],maxReadBytes:524288,powerMode:{enabled:false,fullFilesystem:false}}};
  const gate=createV2PrivatePairOperationGate({
    hostId:route.hostId,profileId:route.profileId,principalId:route.principalId,
    expectedTunnelIdHash:TUNNEL,expectedOwnerSidHash:SID,
    attestTransport:async()=>({authenticated:true,peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'}),
    resolveOwnerContext:async()=>({source:'native-owner-attested',hostId:route.hostId,
      profileId:route.profileId,principalId:route.principalId,conversationId:route.conversationId,
      bindingId:BINDING,ownerSidHash:SID,tunnelIdHash:TUNNEL,expiresAtMs:Date.now()+60000}),
    readCurrentOwnerSidHash:async()=>SID,
    verifyExactNativeGrant:async({tool,arguments:args})=>granted&&tool==='read_text'
      &&[approved,other].includes(args.path),
    withLease:a.withLease,receiptStore:receipts,
    execute:async(_route,args,tool)=>{
      assert.equal(tool,'read_text');
      reads++;return readText(ctx,args);
    }
  });
  const call=(file=approved)=>({request:{},route,tool:'read_text',arguments:{path:file}});
  assert.equal((await gate.execute(call())).text,'approved fixture\n');
  assert.equal((await gate.execute(call())).text,'approved fixture\n');
  assert.equal(reads,1,'receipt replay cannot execute twice');
  await assert.rejects(gate.execute(call(other)),e=>e?.mutationIdempotencyCode==='MUTATION_REQUEST_ID_CONFLICT');
  assert.equal(reads,1);
  granted=false;
  await assert.rejects(gate.execute(call()),{code:'V2_GRANT_REQUIRED'});
  assert.equal(reads,1);
  granted=true;
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  const block=b.withLease(v2ResourceLeaseKey(route),async()=>{await held;});
  try{
    await assert.rejects(gate.execute(call()),{code:'V012_NATIVE_LEASE_OCCUPIED'});
    assert.equal(reads,1);
  }finally{release();await block;}
});
