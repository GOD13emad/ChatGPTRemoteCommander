import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectCoordinationDirectory} from '../src/project-coordination-directory.mjs';
import {DatabaseSync} from 'node:sqlite';

const sha='a'.repeat(64);
const makeRoute=(conversationId='chat-a',bindingId='binding-a',hostId='host-1')=>({
  source:'TRUSTED_CONNECTOR_ROUTE',verified:true,hostId,profileId:'profile-a',
  principalId:'owner-a',conversationId,bindingId,tunnelBindingHash:sha
});
const code='PROJECT_HUB_ROUTE_CHANGED_DURING_APPROVAL';
const isCode=error=>error?.projectHubCode===code;
function harness(run) {
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-consent-race-'));
 const directory=path.join(base,'index'),root=path.join(base,'project');
 fs.mkdirSync(root);
 let current=makeRoute(), onApprove=()=>{};
 const instance=new ProjectCoordinationDirectory({
   directory,
   resolveAttestedRoute:async()=>current,
   authorizeProject:async()=>{onApprove();return true;}
 });
 const h={
   instance,root,directory,base,
   rotate:(route)=>{current=route;},
   whenApproved:(callback)=>{onApprove=callback;},
   original:()=>makeRoute()
 };
 return Promise.resolve().then(()=>run(h)).finally(()=>{
   instance.close();fs.rmSync(base,{recursive:true,force:true});
 });
}
test('consent-time binding rotation denies initial enroll without SQLite membership side effects',()=>harness(async h=>{
  h.whenApproved(()=>h.rotate(makeRoute('chat-a','binding-rotated')));
  await assert.rejects(h.instance.enroll({projectId:'p',root:h.root,ownerProof:'native'}),isCode);
  h.whenApproved(()=>{});
  h.rotate(makeRoute());
  await assert.rejects(h.instance.snapshot('p'),
    e=>e?.projectHubCode==='PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER');
  const db=new DatabaseSync(path.join(h.directory,'project-conversations.sqlite'),{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT count(*) n FROM projects').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM contexts').get().n,0);
  }finally{db.close();}
}));
test('consent-time conversation switch denies joining a prior project',()=>harness(async h=>{
  await h.instance.enroll({projectId:'p',root:h.root,ownerProof:'native'});
  h.rotate(makeRoute('chat-new'));
  h.whenApproved(()=>h.rotate(makeRoute('chat-other')));
  await assert.rejects(h.instance.join({projectId:'p',ownerProof:'native'}),isCode);
  h.rotate(makeRoute('chat-a'));
  assert.equal((await h.instance.snapshot('p')).registeredChats,1);
}));
test('consent-time host reassignment is rejected before enrollment',()=>harness(async h=>{
  h.whenApproved(()=>h.rotate(makeRoute('chat-a','binding-a','host-other')));
  await assert.rejects(h.instance.enroll({projectId:'p',root:h.root,ownerProof:'native'}),isCode);
}));

test('tunnel fingerprint changes during consent and fail-closes',()=>harness(async h=>{
  h.whenApproved(()=>h.rotate({...makeRoute(),tunnelBindingHash:'b'.repeat(64)}));
  await assert.rejects(h.instance.enroll({projectId:'p',root:h.root,ownerProof:'native'}),isCode);
}));
test('same immutable authenticated route across consent is admitted',()=>harness(async h=>{
  h.whenApproved(()=>h.rotate({...makeRoute()}));
  const result=await h.instance.enroll({projectId:'p',root:h.root,ownerProof:'native'});
  assert.equal(result.registeredChats,1);
  assert.equal((await h.instance.snapshot('p')).registeredChats,1);
}));

test('project root replacement during approval is rejected without project enrollment',()=>harness(async h=>{
  h.whenApproved(()=>{
    fs.renameSync(h.root,path.join(h.base,'previous-project'));
    fs.mkdirSync(h.root);
  });
  await assert.rejects(h.instance.enroll({projectId:'p',root:h.root,ownerProof:'native'}),
    e=>e?.projectHubCode==='PROJECT_HUB_ROOT_CHANGED_DURING_APPROVAL');
  const db=new DatabaseSync(path.join(h.directory,'project-conversations.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('SELECT count(*) n FROM projects').get().n,0);}
  finally{db.close();}
}));
