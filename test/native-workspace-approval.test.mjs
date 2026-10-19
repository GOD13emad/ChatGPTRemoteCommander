import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createNativeWorkspaceApprovalVerifier} from '../src/native-workspace-approval.mjs';
import {createNativeWorkspaceCoordinator} from '../src/native-workspace-coordinator.mjs';

const PREFIX=Buffer.from('RC_NATIVE_WORKSPACE_APPROVAL_V1\0','utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const id=()=>randomBytes(32).toString('hex');
const OWNER=id(),SUBJECT=id(),WORKSPACE=id(),BACKEND=id();
const context=(subject,conversationId)=>({fixtureAuthenticated:true,subject,conversationId});
const identity=ctx=>ctx?.fixtureAuthenticated===true?
  {authenticated:true,conversationBound:true,subject:ctx.subject,
    conversationId:ctx.conversationId}:null;

function setup({clockTime=1_800_000_000_000,maxConsumed=512}={}){
  let timestamp=clockTime;
  const keys=generateKeyPairSync('ed25519');
  const cfg={
    trustedPublicKey:keys.publicKey,issuer:'trusted-broker.qa',
    audience:'rc-native-workspace.qa',host:'host-local.qa',
    clock:()=>timestamp,maxConsumed
  };
  const gate=createNativeWorkspaceApprovalVerifier(cfg);
  const challenge=gate.challenge();
  const defaults={
    scope:'control',workspaceRef:WORKSPACE,backendRef:BACKEND,
    ownerRef:OWNER,subjectRef:SUBJECT,ttlSeconds:45
  };
  function approve(fields={},privateKey=keys.privateKey){
    const target={...defaults,...fields};
    const body={
      schema:1,issuer:challenge.issuer,audience:challenge.audience,
      host:challenge.host,instance:challenge.processInstance,
      scope:target.scope,workspaceRef:target.workspaceRef,
      backendRef:target.backendRef,ownerRef:target.ownerRef,subjectRef:target.subjectRef,
      nonce:id(),issuedAt:timestamp,expiresAt:timestamp+target.ttlSeconds*1000
    };
    const raw=Buffer.from(JSON.stringify(body),'utf8');
    const signature=sign(null,Buffer.concat([PREFIX,raw]),privateKey);
    return {body:raw.toString('base64url'),
      signature:signature.toString('base64url')};
  }
  return {gate,approve,defaults,keys,challenge,
    clockNow:()=>timestamp,advance:t=>{timestamp+=t;}};
}

test('no trusted signer or malicious key type never issues GUI permissions',()=>{
  const gate=createNativeWorkspaceApprovalVerifier({
    issuer:'broker.qa',audience:'rc-workspace.qa',host:'qa-host'
  });
  assert.equal(gate.status().configured,false);
  assert.equal(gate.status().productionIdentityVerified,false);
  assert.equal(gate.status().nativeGuiEnabled,false);
  assert.throws(()=>gate.verifyAndConsume(
    {body:'a',signature:'a'},setup().defaults),
    /NATIVE_APPROVAL_TRUST_ANCHOR_UNCONFIGURED/);
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  assert.throws(()=>createNativeWorkspaceApprovalVerifier({
    trustedPublicKey:publicKey,issuer:'broker.qa',
    audience:'rc-workspace.qa',host:'qa-host'
  }),/NATIVE_APPROVAL_TRUST_ANCHOR_INVALID/);
  const ed=generateKeyPairSync('ed25519');
  assert.throws(()=>createNativeWorkspaceApprovalVerifier({
    trustedPublicKey:ed.privateKey,issuer:'broker.qa',
    audience:'rc-workspace.qa',host:'qa-host'
  }),/NATIVE_APPROVAL_TRUST_ANCHOR_INVALID/,
  'Private key objects must never be accepted by the verifier');
  assert.throws(()=>createNativeWorkspaceApprovalVerifier({
    trustedPublicKey:ed.privateKey.export({type:'pkcs8',format:'pem'}),
    issuer:'broker.qa',audience:'rc-workspace.qa',host:'qa-host'
  }),/NATIVE_APPROVAL_TRUST_ANCHOR_INVALID/,
  'Private-key PEM must not be accidentally parsed as public signer');
  const pem=ed.publicKey.export({type:'spki',format:'pem'});
  const readonlyGate=createNativeWorkspaceApprovalVerifier({
    trustedPublicKey:pem,issuer:'broker.qa',
    audience:'rc-workspace.qa',host:'qa-host'
  });
  assert.equal(readonlyGate.status().configured,true);
});

test('correct signed approval is narrowly scoped, single-use and not input itself',()=>{
  const f=setup();
  const approval=f.approve();
  assert.equal(f.gate.verifyAndConsume(approval,f.defaults),true);
  assert.equal(f.gate.status().consumed,1);
  assert.throws(()=>f.gate.verifyAndConsume(approval,f.defaults),
    /NATIVE_APPROVAL_REPLAY_DENIED/);
  assert.equal(f.gate.status().nativeGuiEnabled,false);
});

test('approval scope, workspace, owner, viewer and TTL cannot be substituted',()=>{
  const f=setup();
  const approval=f.approve();
  for(const override of [
    {scope:'observe'},{workspaceRef:id()},{backendRef:id()},{ownerRef:id()},
    {subjectRef:id()},{ttlSeconds:60}
  ]){
    assert.throws(()=>f.gate.verifyAndConsume(approval,
      {...f.defaults,...override}),/NATIVE_APPROVAL_TARGET_DENIED/);
  }
  assert.equal(f.gate.verifyAndConsume(approval,f.defaults),true,
    'Failed checks do not consume otherwise legitimate authorization');
});

test('invalid signatures and attacker-injected claims are rejected before replay admission',()=>{
  const f=setup();
  const valid=f.approve();
  const attacker=generateKeyPairSync('ed25519');
  assert.throws(()=>f.gate.verifyAndConsume(
    f.approve({},attacker.privateKey),f.defaults),/NATIVE_APPROVAL_BAD_SIGNATURE/);
  const parsed=JSON.parse(Buffer.from(valid.body,'base64url'));
  parsed.ownerRef=id();
  assert.throws(()=>f.gate.verifyAndConsume(
    {...valid,body:Buffer.from(JSON.stringify(parsed)).toString('base64url')},
    {...f.defaults,ownerRef:parsed.ownerRef}),/NATIVE_APPROVAL_BAD_SIGNATURE/);
  assert.equal(f.gate.verifyAndConsume(valid,f.defaults),true);
});

test('canonical exact schema refuses duplicate JSON keys and unknown fields even signed',()=>{
  const f=setup();
  const legit=f.approve();
  const raw=Buffer.from(legit.body,'base64url').toString('utf8');
  const duplicate=raw.replace('{"schema":1,','{"schema":1,"schema":1,');
  const altered=raw.replace('"schema":1','"schema":1,"unexpected":true');
  for(const candidate of [duplicate,altered]){
    const bytes=Buffer.from(candidate);
    const approval={body:bytes.toString('base64url'),
      signature:sign(null,Buffer.concat([PREFIX,bytes]),
        f.keys.privateKey).toString('base64url')};
    assert.throws(()=>f.gate.verifyAndConsume(approval,f.defaults),
      /NATIVE_APPROVAL_MALFORMED/);
  }
  assert.throws(()=>f.gate.verifyAndConsume({...legit,extra:true},f.defaults),
    /NATIVE_APPROVAL_MALFORMED/);
});

test('expired, future, stale-instance and wrong host approvals fail closed',()=>{
  const f=setup();
  const signed=f.approve();
  f.advance(45_000);
  assert.throws(()=>f.gate.verifyAndConsume(signed,f.defaults),
    /NATIVE_APPROVAL_EXPIRED_OR_FUTURE/);
  const g=setup({clockTime:f.clockNow()});
  assert.throws(()=>g.gate.verifyAndConsume(signed,g.defaults),
    /NATIVE_APPROVAL_TARGET_DENIED/);
  const h=setup();
  const future=h.approve();
  const parsed=JSON.parse(Buffer.from(future.body,'base64url'));
  parsed.host='another-server.qa';
  const raw=Buffer.from(JSON.stringify(parsed));
  const signedWrongHost={
    body:raw.toString('base64url'),
    signature:sign(null,Buffer.concat([PREFIX,raw]),h.keys.privateKey)
      .toString('base64url')
  };
  assert.throws(()=>h.gate.verifyAndConsume(signedWrongHost,h.defaults),
    /NATIVE_APPROVAL_TARGET_DENIED/);
  h.advance(-8_000);
  assert.throws(()=>h.gate.verifyAndConsume(future,h.defaults),
    /NATIVE_APPROVAL_EXPIRED_OR_FUTURE/);
});

test('replay store is bounded, process-local and cannot be cleared to authorize replay',()=>{
  const f=setup({maxConsumed:1});
  const a=f.approve(),b=f.approve();
  assert.equal(f.gate.verifyAndConsume(a,f.defaults),true);
  assert.throws(()=>f.gate.verifyAndConsume(b,f.defaults),
    /NATIVE_APPROVAL_REPLAY_STORE_FULL/);
  f.advance(46_000);
  assert.throws(()=>f.gate.verifyAndConsume(a,f.defaults),
    /NATIVE_APPROVAL_EXPIRED_OR_FUTURE/);
  assert.throws(()=>f.gate.verifyAndConsume(b,f.defaults),
    /NATIVE_APPROVAL_EXPIRED_OR_FUTURE/);
  const next=f.approve();
  assert.equal(f.gate.verifyAndConsume(next,f.defaults),true);
});

function crc32(buf){
  let c=0xffffffff;
  for(const byte of buf){
    c^=byte;
    for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function chunk(name,data){
  const bytes=Buffer.concat([Buffer.from(name),data]);
  const head=Buffer.alloc(4),tail=Buffer.alloc(4);
  head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(bytes));
  return Buffer.concat([head,bytes,tail]);
}
function frame(name){
  const hdr=Buffer.alloc(13);hdr.writeUInt32BE(1,0);hdr.writeUInt32BE(1,4);
  hdr[8]=8;hdr[9]=2;
  const body=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),
    chunk('IHDR',hdr),
    chunk('IDAT',deflateSync(Buffer.from([0,name.charCodeAt(0),34,99]))),
    chunk('IEND',Buffer.alloc(0))]);
  return {mimeType:'image/png',data:body.toString('base64')};
}

test('signed observer and control grants integrate with independent private workspace',
  async()=>{
    const keys=generateKeyPairSync('ed25519');
    let timestamp=1_800_000_000_000;
    const gate=createNativeWorkspaceApprovalVerifier({
      trustedPublicKey:keys.publicKey,issuer:'protected-owner-broker.qa',
      audience:'commander-private-gui.qa',host:'private-host.qa',
      clock:()=>timestamp
    });
    const owner=context('profile','chat-one');
    const viewer=context('auditor','review-1');
    const operator=context('supervisor','review-2');
    const ownerOther=context('profile','chat-two');
    const ownerRef=sha('profile|chat-one');
    const viewerRef=sha('auditor|review-1');
    const operatorRef=sha('supervisor|review-2');
    const processInstance=gate.challenge().processInstance;
    let next=0;
    const privateWorkers=[],journals=new Map();
    const pool=createNativeWorkspaceCoordinator({
      identityResolver:identity,
      durableJournalFactory:async ({workspaceRef})=>{
        const seen=new Set();
        journals.set(workspaceRef,seen);
        return {
          prepare:async ({operationId})=>{
            if(seen.has(operationId))throw Error('repeat denied');
            seen.add(operationId);return {operationId};
          },
          acknowledge:async()=>({submitted:true}),
          inspect:async()=>({releaseAuthorized:false})
        };
      },
      launchWorkspace:async()=>{
        next++;
        const item={label:next,actions:[],closed:false,
          displayId:':'+(1750+next),serverPid:61750+next};
        privateWorkers.push(item);
        return {
          kind:'native-private-x11',physicalDesktopInput:false,
          displayId:item.displayId,serverPid:item.serverPid,
          observe:async()=>({frame:frame(''+next)}),
          input:async action=>{item.actions.push(action);return {submitted:true};},
          close:async()=>{item.closed=true;}
        };
      },
      authorizeObserver:async({approval,ownerRef,viewerRef,workspaceRef,backendRef,ttlSeconds})=>
        gate.verifyAndConsume(approval,{
          scope:'observe',ownerRef,subjectRef:viewerRef,workspaceRef,backendRef,ttlSeconds
        }),
      authorizeHandoff:async({approval,ownerRef,operatorRef,workspaceRef,backendRef,ttlSeconds})=>
        gate.verifyAndConsume(approval,{
          scope:'control',ownerRef,subjectRef:operatorRef,workspaceRef,backendRef,ttlSeconds
        })
    });
    function approved(scope,workspaceRef,backendRef,subjectRef,ttlSeconds){
      const body={
        schema:1,issuer:'protected-owner-broker.qa',
        audience:'commander-private-gui.qa',host:'private-host.qa',
        instance:processInstance,scope,workspaceRef,backendRef,ownerRef,subjectRef,
        nonce:id(),issuedAt:timestamp,expiresAt:timestamp+ttlSeconds*1000
      };
      const raw=Buffer.from(JSON.stringify(body));
      return {body:raw.toString('base64url'),
        signature:sign(null,Buffer.concat([PREFIX,raw]),
          keys.privateKey).toString('base64url')};
    }
    const a=await pool.open(owner),b=await pool.open(ownerOther);
    try{
      await assert.rejects(pool.grantObserver(owner,a.lease,viewer),
        /NATIVE_WORKSPACE_OBSERVER_DENIED/);
      await assert.rejects(pool.beginHandoff(owner,a.lease,operator),
        /NATIVE_WORKSPACE_HANDOFF_DENIED/);
      const backendRefA=sha(privateWorkers[0].displayId+'\0'+privateWorkers[0].serverPid);
      const observerGrant=approved('observe',a.workspaceRef,backendRefA,viewerRef,60);
      const observed=await pool.grantObserver(owner,a.lease,viewer,
        {ttlSeconds:60,approval:observerGrant});
      assert.equal(observed.canInput,false);
      await assert.rejects(pool.grantObserver(owner,a.lease,viewer,
        {ttlSeconds:60,approval:observerGrant}),/NATIVE_WORKSPACE_OBSERVER_DENIED/);
      const snapA=await pool.observeOwner(owner,a.lease);
      const snapB=await pool.observeOwner(ownerOther,b.lease);
      assert.equal(pool.readObserver(viewer,observed.viewerToken).stale,false);
      const controlGrant=approved('control',a.workspaceRef,backendRefA,operatorRef,45);
      const controlled=await pool.beginHandoff(owner,a.lease,operator,
        {ttlSeconds:45,approval:controlGrant});
      assert.equal(controlled.ownerInputPaused,true);
      await assert.rejects(pool.inputOwner(owner,a.lease,
        {kind:'key',key:'Return'},
        {expectedRevision:snapA.revision,operationId:'owner-denied'}),
        /NATIVE_WORKSPACE_CONTROL_HELD/);
      const opView=await pool.observeOperator(operator,controlled.controlToken);
      assert.equal((await pool.inputOperator(operator,controlled.controlToken,
        {kind:'key',key:'Return'},
        {expectedRevision:opView.revision,operationId:'synthetic-op-A'})).submitted,true);
      assert.equal((await pool.inputOwner(ownerOther,b.lease,
        {kind:'key',key:'Return'},
        {expectedRevision:snapB.revision,operationId:'synthetic-agent-B'})).submitted,true);
      assert.equal(privateWorkers[0].actions.length,1);
      assert.equal(privateWorkers[1].actions.length,1);
      assert.equal(pool.readObserver(viewer,observed.viewerToken).stale,true);
      pool.endHandoff(operator,controlled.controlToken);
      await assert.rejects(pool.inputOwner(owner,a.lease,
        {kind:'key',key:'Return'},
        {expectedRevision:opView.revision,operationId:'stale-owner'}),
        /NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
      const fresh=await pool.observeOwner(owner,a.lease);
      assert.equal((await pool.inputOwner(owner,a.lease,
        {kind:'key',key:'Return'},
        {expectedRevision:fresh.revision,operationId:'resumed-owner'})).submitted,true);
    }finally{
      await pool.close();
    }
    assert.ok(privateWorkers.every(w=>w.closed));
  });
