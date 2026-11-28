import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLinuxOwnerWorkerKeyEvidence}
  from '../src/v012-owner-worker-key-evidence-linux.mjs';
const OWNER='a'.repeat(64),CLIENT='b'.repeat(64),KEY='c'.repeat(64);
function fixture(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-key-evidence-fixture-'));
  const pair=path.join(home,'.config/chatgpt-remote-commander/private-pair/qa-profile');
  fs.mkdirSync(pair,{recursive:true,mode:0o700});
  const now=Date.now(),pin={schema:1,kind:'linux-owner-private-one-tunnel',
    hostId:'qa-host',profileId:'qa-profile',ownerSidHash:OWNER,
    expectedExecutablePath:'/usr/bin/qa-tunnel',
    expectedExecutableSha256:'d'.repeat(64),healthPort:47831,
    expectedClientLeafDerSha256:CLIENT,enrolledAtMs:now-60000};
  fs.writeFileSync(path.join(pair,'owner-tunnel-trust.json'),JSON.stringify(pin)+'\n',{mode:0o600});
  const state={now,ownerSidHash:OWNER,keyId:KEY,calls:0,
    transport:()=>({
      source:'native-tunnel-attestor',provider:'openai-secure-mcp-tunnel',
      profileId:'qa-profile',tunnelIdHash:'f'.repeat(64),
      ownerSidHash:OWNER,authenticated:true,controlPlanePollOk:true,
      healthzStatus:200,readyzStatus:200,
      lastPollAtMs:state.now-1000,expiresAtMs:state.now+4000
    })
  };
  const make=()=>createLinuxOwnerWorkerKeyEvidence({
    home,profile:'qa-profile',hostId:'qa-host',
    resolveOwnerSidHash:async()=>state.ownerSidHash,
    resolveTransportIdentity:async()=>state.transport(),
    now:()=>state.now,
    inspect:({profile,identity})=>{
      state.calls++;
      assert.equal(profile,'qa-profile');
      assert.equal(identity.hostId,'qa-host');
      assert.equal(identity.expectedClientLeafDerSha256,CLIENT);
      return {profileId:'qa-profile',verified:true,receiptSchema:2,keyId:state.keyId};
    }
  });
  return {state,make,pinFile:path.join(pair,'owner-tunnel-trust.json'),
    close(){fs.rmSync(home,{recursive:true,force:true});}};
}
test('real owner-pin lookup plus injected capsule verifier derives bounded device/worker evidence', {skip:process.platform!=='linux'},async()=>{
  const f=fixture();
  try{
    const att=f.make();
    const e=await att.resolveVerifiedWorkerKey();
    assert.equal(e.source,'native-worker-key-attestor');
    assert.equal(e.verified,true);
    assert.equal(e.expiresAtMs,f.state.now+4000);
    assert.equal(e.deviceProvider,'native-key-store');
    assert.equal(e.keyId,KEY);
    assert.equal(f.state.calls,1);
    f.state.keyId='4'.repeat(64);
    const changed=await att.resolveVerifiedWorkerKey();
    assert.notEqual(changed.deviceIdHash,e.deviceIdHash,
      'key rotation changes device identity and requires a new owner grant');
    assert.equal(changed.capabilityPolicyDigest,e.capabilityPolicyDigest);
  }finally{f.close();}
});
test('wrong live OS owner, corrupted PIN and stale native Tunnel all fail closed',
  {skip:process.platform!=='linux'},async()=>{
  for(const mode of ['owner','pin','offline','stale','unexpected-profile']){
    const f=fixture();
    try{
      if(mode==='owner')f.state.ownerSidHash='9'.repeat(64);
      if(mode==='pin'){
        const p=JSON.parse(fs.readFileSync(f.pinFile,'utf8'));
        p.hostId='different-host';
        fs.writeFileSync(f.pinFile,JSON.stringify(p)+'\n',{mode:0o600});
      }
      if(mode==='offline'){
        const original=f.state.transport;
        f.state.transport=()=>({...original(),authenticated:false});
      }
      if(mode==='stale'){
        const original=f.state.transport;
        f.state.transport=()=>({...original(),lastPollAtMs:f.state.now-130000});
      }
      if(mode==='unexpected-profile'){
        const original=f.state.transport;
        f.state.transport=()=>({...original(),profileId:'different'});
      }
      await assert.rejects(f.make().resolveVerifiedWorkerKey(),undefined,mode);
    }finally{f.close();}
  }
});
