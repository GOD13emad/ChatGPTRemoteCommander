// QA ONLY: real ephemeral Win32 HDESK evidence bridged into a read-only
// Broker observation. Native input remains unconditionally unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureWindowsDesktopEvidenceQA,validateWindowsDesktopEvidenceQA}
  from '../src/native-desktop-evidence-bridge-win-qa.mjs';
import {createWindowsSessionBrokerQA}
  from '../src/native-workspace-session-broker-win-qa.mjs';

const a='a'.repeat(64),b='b'.repeat(64),nonce='f'.repeat(64);

test('desktop evidence refuses window swap, PID mismatch and fake input safety flags',()=>{
  const item=(name,pid)=>({
    requestedDesktop:name,desktopCreated:true,desktopHandleClosed:true,
    childExitCode:0,error:null,pid,matched:true,
    desktopEnumerationSucceeded:true,ownWindowObserved:true,
    observedQaWindowPids:String(pid),
    reported:{pid,desktop:name,sessionId:2,station:'WinSta0',
      hiddenWindowCreated:true,hiddenWindowDestroyed:true,
      hiddenWindowOwnerPid:pid,hiddenWindowCreateError:0,
      inputNotSent:true,windowsNotShown:true}
  });
  const report={schema:1,pass:true,sessionId:2,station:'WinSta0',
    noSwitchDesktop:true,noUserInput:true,
    children:[item('RcQaHost_'+'1'.repeat(32),234),
      item('RcQaHost_'+'2'.repeat(32),345)]};
  const good=validateWindowsDesktopEvidenceQA(report,[a,b],nonce);
  assert.notEqual(good.observations.get(a).sha256,good.observations.get(b).sha256);
  assert.equal(good.observations.get(a).effectMode,'observation-only');
  const clone=()=>structuredClone(report);
  const cases=[
    x=>{x.children[1].requestedDesktop=x.children[0].requestedDesktop;},
    x=>{x.children[1].observedQaWindowPids='234';},
    x=>{x.children[0].reported.desktop=x.children[1].requestedDesktop;},
    x=>{x.children[0].reported.inputNotSent=false;},
    x=>{x.children[0].reported.hiddenWindowDestroyed=false;},
    x=>{x.children[1].reported.hiddenWindowOwnerPid=234;},
    x=>{x.children[0].desktopHandleClosed=false;},
    x=>{x.noSwitchDesktop=false;},
    x=>{x.children[1].pid=x.children[0].pid;},
    x=>{x.station='DifferentStation';}
  ];
  for(const tamper of cases){
    const bad=clone();tamper(bad);
    assert.throws(()=>validateWindowsDesktopEvidenceQA(bad,[a,b],nonce),
      e=>e.code==='DESKTOP_EVIDENCE_UNTRUSTED');
  }
  assert.throws(()=>validateWindowsDesktopEvidenceQA(report,[a,a],nonce),
    e=>e.code==='DESKTOP_EVIDENCE_ARGUMENT_INVALID');
});

test('real two-desktop Win32 observer yields two non-actionable Broker proofs',
  {skip:process.platform!=='win32'},async()=>{
    const evidence=captureWindowsDesktopEvidenceQA({workspaceRefs:[a,b]});
    assert.equal(evidence.station,'WinSta0');
    assert.ok(Number.isSafeInteger(evidence.sessionId)&&evidence.sessionId>0);
    const observerA=Object.freeze({}),observerB=Object.freeze({});
    const identities=new WeakMap([
      [observerA,{principalId:'qa-reader-a',sessionId:'reader-session-a',
        role:'agent',allowedWorkspaces:[a]}],
      [observerB,{principalId:'qa-reader-b',sessionId:'reader-session-b',
        role:'agent',allowedWorkspaces:[b]}]
    ]);
    let dispatches=0,journalInvocations=0;
    const broker=createWindowsSessionBrokerQA({
      attest:ctx=>identities.get(ctx),
      observeNative:async({workspaceRef})=>evidence.observations.get(workspaceRef),
      journal:{execute:async()=>{journalInvocations++;}},
      dispatchNative:async()=>{dispatches++;}
    });
    try{
      const pa=await broker.observe({context:observerA,workspaceRef:a});
      const pb=await broker.observe({context:observerB,workspaceRef:b});
      assert.equal(pa.effectMode,'observation-only');
      assert.equal(pb.effectMode,'observation-only');
      assert.notEqual(pa.frameSha256,pb.frameSha256);
      assert.throws(()=>broker.acquire({context:observerA,observation:pa}),
        e=>e.code==='BROKER_OBSERVATION_NON_ACTIONABLE');
      assert.throws(()=>broker.acquire({context:observerB,observation:pb}),
        e=>e.code==='BROKER_OBSERVATION_NON_ACTIONABLE');
      assert.throws(()=>broker.acquire({context:observerB,observation:pa}),
        e=>e.code==='BROKER_UNAUTHENTICATED');
      assert.equal(dispatches,0);
      assert.equal(journalInvocations,0);
    }finally{broker.close();}
  });
