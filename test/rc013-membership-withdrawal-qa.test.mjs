import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectCoordinationDirectory} from '../src/project-coordination-directory.mjs';

const sha='a'.repeat(64);
const proof='explicit-native-owner-approval';
const route=(conversationId='chat-a',bindingId='binding-a')=>({
 source:'TRUSTED_CONNECTOR_ROUTE',verified:true,hostId:'host-one',
 principalId:'owner-one',profileId:'profile-one',conversationId,
 bindingId,tunnelBindingHash:sha
});
const code=(e,s)=>e?.projectHubCode===s;
async function harness(run){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-withdraw-'));
 const directory=path.join(base,'private-index'),root=path.join(base,'project');
 fs.mkdirSync(root);
 let current=route(),approve=()=>true;
 const h={
   root,route:r=>{current=r;},authorize:fn=>{approve=fn;},
   store:new ProjectCoordinationDirectory({
     directory,
     resolveAttestedRoute:async()=>current,
     authorizeProject:async args=>args.ownerProof===proof&&approve(args)
   })
 };
 try {await run(h);}
 finally {h.store.close();fs.rmSync(base,{recursive:true,force:true});}
}
test('current verified member withdrawal preserves other member and immutable evidence',()=>harness(async h=>{
 await h.store.enroll({projectId:'p',root:h.root,ownerProof:proof});
 await h.store.observe('p',{eventKey:'receipt-one',operationId:'op-one',outcome:'OBSERVED',evidenceSha256:sha});
 h.route(route('chat-b','binding-b'));
 await h.store.join({projectId:'p',ownerProof:proof});
 h.route(route('chat-a'));
 const result=await h.store.withdrawCurrentMembership({projectId:'p',ownerProof:proof});
 assert.deepEqual(result,{projectId:'p',withdrawn:true,registeredChats:1,executionAllowed:false});
 await assert.rejects(h.store.snapshot('p'),e=>code(e,'PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER'));
 await assert.rejects(h.store.observe('p',{eventKey:'new',operationId:'new',outcome:'OBSERVED',evidenceSha256:sha}),
   e=>code(e,'PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER'));
 h.route(route('chat-b','binding-b'));
 const snap=await h.store.snapshot('p');
 assert.equal(snap.registeredChats,1);
 assert.equal(snap.eventCount,1);
 assert.equal(snap.executionAllowed,false);
}));
test('withdrawal requires exact positive native owner approval',()=>harness(async h=>{
 await h.store.enroll({projectId:'p',root:h.root,ownerProof:proof});
 await assert.rejects(h.store.withdrawCurrentMembership({projectId:'p',ownerProof:'chat-message'}),
   e=>code(e,'PROJECT_HUB_OWNER_APPROVAL_REQUIRED'));
 assert.equal((await h.store.snapshot('p')).registeredChats,1);
}));
test('withdrawal fails closed when trusted chat binding rotates during consent',()=>harness(async h=>{
 await h.store.enroll({projectId:'p',root:h.root,ownerProof:proof});
 h.authorize(()=>{h.route(route('chat-a','binding-rotated'));return true;});
 await assert.rejects(h.store.withdrawCurrentMembership({projectId:'p',ownerProof:proof}),
   e=>code(e,'PROJECT_HUB_ROUTE_CHANGED_DURING_APPROVAL'));
 h.route(route('chat-a'));
 assert.equal((await h.store.snapshot('p')).registeredChats,1);
}));
test('withdrawn member can rejoin only through a new approved native enrollment',()=>harness(async h=>{
 await h.store.enroll({projectId:'p',root:h.root,ownerProof:proof});
 await h.store.withdrawCurrentMembership({projectId:'p',ownerProof:proof});
 await assert.rejects(h.store.snapshot('p'),e=>code(e,'PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER'));
 h.authorize(()=>false);
 await assert.rejects(h.store.join({projectId:'p',ownerProof:proof}),
   e=>code(e,'PROJECT_HUB_OWNER_APPROVAL_REQUIRED'));
 h.authorize(()=>true);
 assert.equal((await h.store.join({projectId:'p',ownerProof:proof})).registeredChats,1);
}));

test('unregistered chat cannot withdraw another member even with a positive policy callback',()=>harness(async h=>{
 await h.store.enroll({projectId:'p',root:h.root,ownerProof:proof});
 h.route(route('chat-stranger','binding-unknown'));
 await assert.rejects(h.store.withdrawCurrentMembership({projectId:'p',ownerProof:proof}),
   e=>code(e,'PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER'));
 h.route(route('chat-a'));
 assert.equal((await h.store.snapshot('p')).registeredChats,1);
}));
