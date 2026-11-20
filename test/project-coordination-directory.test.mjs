import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectCoordinationDirectory} from '../src/project-coordination-directory.mjs';

const sha='a'.repeat(64);
const route=(principalId='owner-a',conversationId='chat-a',extra={})=>({
  source:'TRUSTED_CONNECTOR_ROUTE',verified:true,
  hostId:'host-1',profileId:principalId==='owner-a'?'profile-a':'profile-b',
  principalId,conversationId,bindingId:'binding-1',tunnelBindingHash:sha,...extra
});
const isCode=(error,code)=>error?.projectHubCode===code;

function harness(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-project-hub-'));
  const root=path.join(base,'project');fs.mkdirSync(root);
  const directory=path.join(base,'private-index');
  let current=route();
  const options={
    directory,resolveAttestedRoute:async()=>current,
    authorizeProject:async({ownerProof})=>ownerProof==='explicit-native-owner-approval'
  };
  const instance=new ProjectCoordinationDirectory(options);
  return {
    instance,options,root,base,directory,
    use:r=>{current=r;},
    close:()=>{instance.close();fs.rmSync(base,{recursive:true,force:true});}
  };
}
const grant='explicit-native-owner-approval';
const create=(h,projectId='commander-1')=>h.instance.enroll({projectId,root:h.root,ownerProof:grant});
const join=(h,projectId='commander-1')=>h.instance.join({projectId,ownerProof:grant});

test('no project route can start without trusted ingress and membership policies',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-empty-policy-'));
  try{
    assert.throws(()=>new ProjectCoordinationDirectory({directory:base}),
      e=>isCode(e,'PROJECT_HUB_AUTH_CALLBACK_REQUIRED'));
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('current principal/session must originate from server-injected trusted callback, not MCP text',async()=>{
  const h=harness();
  try{
    h.use({source:'USER_ARGUMENT',verified:true,hostId:'host-1',profileId:'profile-a',
      principalId:'owner-a',conversationId:'chat-a',bindingId:'binding-1',tunnelBindingHash:sha});
    await assert.rejects(create(h),e=>isCode(e,'PROJECT_HUB_TRUSTED_ROUTE_REQUIRED'));
    h.use(route('owner-a','chat-a',{verified:false}));
    await assert.rejects(create(h),e=>isCode(e,'PROJECT_HUB_TRUSTED_ROUTE_REQUIRED'));
  }finally{h.close();}
});

test('new project and extra member both require explicit membership approval',async()=>{
  const h=harness();
  try{
    await assert.rejects(h.instance.enroll({projectId:'p',root:h.root,ownerProof:'chat said yes'}),
      e=>isCode(e,'PROJECT_HUB_OWNER_APPROVAL_REQUIRED'));
    const snap=await create(h);
    assert.equal(snap.registeredChats,1);
    assert.equal(snap.executionAllowed,false);
    h.use(route('owner-b','chat-z'));
    await assert.rejects(h.instance.join({projectId:'commander-1',ownerProof:'chat said yes'}),
      e=>isCode(e,'PROJECT_HUB_OWNER_APPROVAL_REQUIRED'));
  }finally{h.close();}
});

test('same project accepts two independent chats and two separately attested accounts without tunnel sharing',async()=>{
  const h=harness();
  try{
    const a=await create(h);
    assert.equal(a.registeredChats,1);
    h.use(route('owner-a','chat-next'));
    assert.equal((await join(h)).registeredChats,2);
    h.use(route('owner-b','chat-c'));
    const three=await join(h);
    assert.equal(three.registeredChats,3);
    assert.equal(three.projectId,'commander-1');
    assert.equal(three.authority,'EXISTING_PROJECT_BRAIN_AND_WORKFLOW_STORE');
    assert.equal(three.globallyFencedWriter,false);
    assert.equal(three.notionIsAuthority,false);
    assert.equal(three.next,'READ_LIVE_BRAIN_AND_CHECK_GLOBAL_WRITER_LEASE');
  }finally{h.close();}
});

test('repeat enroll/join of exact same authenticated route is idempotent',async()=>{
  const h=harness();
  try{
    const first=await create(h);
    const second=await create(h);
    assert.deepEqual(second.registeredChats,first.registeredChats);
    assert.equal((await join(h)).registeredChats,1);
  }finally{h.close();}
});

test('one exact chat is never silently reassigned from one project to another',async()=>{
  const h=harness();
  try{
    await create(h,'project-one');
    await assert.rejects(create(h,'project-two'),
      e=>isCode(e,'PROJECT_HUB_CHAT_ALREADY_ASSIGNED'));
    assert.equal((await h.instance.snapshot('project-one')).registeredChats,1);
  }finally{h.close();}
});

test('existing project cannot silently switch its canonical source root',async()=>{
  const h=harness();
  try{
    await create(h);
    const other=path.join(h.base,'wrong-root');fs.mkdirSync(other);
    await assert.rejects(h.instance.enroll({
      projectId:'commander-1',root:other,ownerProof:grant
    }),e=>isCode(e,'PROJECT_HUB_ROOT_CONFLICT'));
  }finally{h.close();}
});

test('rotated binding/tunnel cannot reuse a prior chat enrollment to gain access',async()=>{
  const h=harness();
  try{
    await create(h);
    h.use(route('owner-a','chat-a',{bindingId:'rotated-binding'}));
    await assert.rejects(h.instance.snapshot('commander-1'),
      e=>isCode(e,'PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER'));
    await assert.rejects(join(h),
      e=>isCode(e,'PROJECT_HUB_EXPIRED_BINDING_REAPPROVAL_REQUIRED'));
    h.use(route('owner-a','chat-a',{tunnelBindingHash:'b'.repeat(64)}));
    await assert.rejects(h.instance.snapshot('commander-1'),
      e=>isCode(e,'PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER'));
  }finally{h.close();}
});

test('unknown and unapproved account contexts cannot enumerate membership',async()=>{
  const h=harness();
  try{
    await create(h);
    h.use(route('owner-b','chat-unknown'));
    await assert.rejects(h.instance.snapshot('commander-1'),
      e=>isCode(e,'PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER'));
    await assert.rejects(h.instance.observe('commander-1',{
      eventKey:'event-1',operationId:'op-1',outcome:'OBSERVED',evidenceSha256:sha
    }),e=>isCode(e,'PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER'));
  }finally{h.close();}
});

test('observed evidence is durable and idempotent, not an execution grant or verified claim',async()=>{
  const h=harness();
  try{
    await create(h);
    const body={eventKey:'handoff-1',operationId:'step-1',outcome:'EVIDENCE_READY',evidenceSha256:sha};
    const first=await h.instance.observe('commander-1',body);
    assert.deepEqual(first,{projectId:'commander-1',eventKey:'handoff-1',stored:true,reused:false,verified:false});
    const same=await h.instance.observe('commander-1',body);
    assert.equal(same.reused,true);
    assert.equal((await h.instance.snapshot('commander-1')).eventCount,1);
    await assert.rejects(h.instance.observe('commander-1',{...body,evidenceSha256:'b'.repeat(64)}),
      e=>isCode(e,'PROJECT_HUB_EVENT_CONFLICT'));
    await assert.rejects(h.instance.observe('commander-1',{...body,outcome:'PASS'}),
      e=>isCode(e,'PROJECT_HUB_EVENT_STATE_INVALID'));
  }finally{h.close();}
});

test('observed evidence cannot be impersonated by a different member with identical event key',async()=>{
  const h=harness();
  try{
    await create(h);
    const body={eventKey:'same-key',operationId:'op-42',outcome:'OBSERVED',evidenceSha256:sha};
    await h.instance.observe('commander-1',body);
    h.use(route('owner-b','chat-b'));
    await join(h);
    await assert.rejects(h.instance.observe('commander-1',body),
      e=>isCode(e,'PROJECT_HUB_EVENT_CONFLICT'));
  }finally{h.close();}
});

test('local index survives restart without storing original binding IDs or chat transcripts',async()=>{
  const h=harness();
  try{
    await create(h);
    h.instance.close();
    const blob=fs.readFileSync(path.join(h.directory,'project-conversations.sqlite'));
    assert.equal(blob.includes(Buffer.from('binding-1')),false);
    assert.equal(blob.includes(Buffer.from('cookie')),false);
    const again=new ProjectCoordinationDirectory(h.options);
    try{
      const snap=await again.snapshot('commander-1');
      assert.equal(snap.registeredChats,1);
      assert.equal(snap.executionAllowed,false);
    }finally{again.close();}
  }finally{
    fs.rmSync(h.base,{recursive:true,force:true});
  }
});
