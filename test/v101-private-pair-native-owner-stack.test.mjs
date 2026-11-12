import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createV101PrivatePairNativeOwnerStack}
  from '../src/v101-private-pair-native-owner-stack.mjs';

const SID='S-1-5-21-111-222-333-1001';
const OWNER=createHash('sha256').update(
  'commander.os-owner.sid.v1\0win32\0sid='+SID).digest('hex');
const TUNNEL='b'.repeat(64);
const WIN_PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WIN_SCRIPT='C:\\Commander\\src\\native-owner-session-windows.ps1';
const route=conversationId=>({
  hostId:'pc1',profileId:'profileA',principalId:'accountA',
  conversationId,operationId:'owner-enroll',
  target:{kind:'workflow-root',id:'project1'}
});
function fixture(approve=true){
  const calls=[],root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-private-native-stack-'));
  const fakeExec=(file,args,_options,callback)=>{
    calls.push(args);
    assert.equal(file,WIN_PS);
    const mode=args.at(args.indexOf('-Mode')+1);
    if(mode==='Snapshot')return callback(null,JSON.stringify({
      schema:1,ownerSid:SID,sessionId:7,active:true,interactive:true
    })+'\n','');
    if(mode==='Consent')return callback(null,JSON.stringify({approved:approve})+'\n','');
    callback(new Error('unknown mode'),'','');
  };
  const stack=createV101PrivatePairNativeOwnerStack({
    directory:path.join(root,'grants'),profileId:'profileA',
    expectedTunnelIdHash:TUNNEL,expectedOwnerSidHash:OWNER,
    attestTransport:async()=>({authenticated:true,
      peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'}),
    resolveOwnerRoute:async session=>route(session),
    ownerSessionOptions:{
      platform:'win32',powershell:WIN_PS,script:WIN_SCRIPT,
      verifyFile:()=>{},execFileImpl:fakeExec,
      snapshotTimeoutMs:1000,dialogTimeoutMs:5000
    }
  });
  return {calls,root,stack,close(){
    stack.close();fs.rmSync(root,{recursive:true,force:true});
  }};
}

test('PRIVATE native Windows composition uses existing owner consent, binding and revocation',{
  skip:process.platform!=='win32'
},async()=>{
  const f=fixture();
  try{
    assert.equal(f.stack.nativeSessionBindings.size,0);
    const grant=await f.stack.requestOwnerBinding({request:{},sessionHandle:'chat1'});
    assert.equal(grant.sessionHandle,'chat1');
    assert.equal(f.stack.nativeSessionBindings.size,1);
    assert.equal(f.calls.some(args=>args.includes('Consent')),true);
    const c=await f.stack.resolveOwnerContext('chat1');
    assert.equal(c.source,'native-owner-attested');
    assert.equal(c.tunnelIdHash,TUNNEL);
    assert.equal(c.ownerSidHash,OWNER);
    assert.equal(await f.stack.readCurrentOwnerSidHash(),OWNER);
    assert.equal(f.stack.grantRegistry.read(route('chat1'),'run_shell'),null);
    await f.stack.nativeSessionBindings.revokeTrusted({
      sessionHandle:'chat1',adminProof:null
    });
    assert.equal(f.stack.nativeSessionBindings.size,0);
    f.stack.close();
    await assert.rejects(f.stack.requestOwnerBinding({request:{},sessionHandle:'chat2'}),
      {code:'V101_PRIVATE_OWNER_STACK_CLOSED'});
  }finally{f.close();}
});

test('native owner denial never creates PRIVATE binding or grant',{
  skip:process.platform!=='win32'
},async()=>{
  const f=fixture(false);
  try{
    await assert.rejects(f.stack.requestOwnerBinding({request:{},sessionHandle:'chat1'}),
      {code:'V2_SESSION_OWNER_CONSENT_REQUIRED'});
    assert.equal(f.stack.nativeSessionBindings.size,0);
    assert.equal(f.stack.grantRegistry.read(route('chat1'),'run_shell'),null);
  }finally{f.close();}
});

test('private native stack rejects invalid platform and missing pinned trust',()=>{
  for(const p of [
    {platform:'something-else'}, {profileId:null},
    {expectedTunnelIdHash:'bad'}, {expectedOwnerSidHash:null},
    {attestTransport:null}, {resolveOwnerRoute:null}
  ])assert.throws(()=>createV101PrivatePairNativeOwnerStack({
    directory:path.resolve(os.tmpdir(),'nonexistent-private-pair-owner'),
    profileId:'profileA',expectedTunnelIdHash:TUNNEL,expectedOwnerSidHash:OWNER,
    attestTransport:async()=>({authenticated:true}),
    resolveOwnerRoute:async()=>route('chat1'),...p
  }),{code:'V101_PRIVATE_OWNER_STACK_BOOTSTRAP_REQUIRED'});
});
