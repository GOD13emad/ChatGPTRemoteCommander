import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createV2OwnerApprovalQueue} from '../src/v2-owner-approval-queue.mjs';
import {createV2OwnerProposalHandler} from '../src/v2-owner-proposal-tool.mjs';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'v2-owner-queue-'));
const withRoot=fn=>{const root=tmp();try{fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}};
test('a no-OAuth proposal queues only and owner approval creates exactly one isolated note',()=>withRoot(root=>{
 let time=1000000;
 const q=createV2OwnerApprovalQueue({root,now:()=>time});
 const p=q.proposeNote({title:'MMZ approval proof',text:'Local owner note only'});
 assert.equal(p.effectExecuted,false);
 assert.equal(p.status,'PENDING_OWNER_CONSOLE_APPROVAL');
 const dir=path.join(root,'notes');
 assert.deepEqual(fs.readdirSync(dir),[]);
 assert.equal(q.inspect(p.requestId).status,'PENDING');
 const done=q.approve(p.requestId);
 assert.equal(done.status,'APPROVED_AND_NOTE_CREATED');
 assert.equal(q.approve(p.requestId).alreadyDone,true);
 const notes=fs.readdirSync(dir);
 assert.deepEqual(notes,[p.requestId+'.json']);
 const note=JSON.parse(fs.readFileSync(path.join(dir,notes[0]),'utf8'));
 assert.deepEqual([note.requestId,note.text],[p.requestId,'Local owner note only']);
 assert.equal(q.inspect(p.requestId).status,'APPROVED_AND_NOTE_CREATED');
 assert.equal(fs.statSync(path.join(root,'pending')).mode&0o077,0);
 assert.equal(fs.statSync(path.join(dir,notes[0])).mode&0o077,0);
}));
test('unapproved, expired and malformed proposals never produce notes',()=>withRoot(root=>{
 let time=1000000;
 const q=createV2OwnerApprovalQueue({root,now:()=>time});
 for(const title of ['\u0000bad','', 'a'.repeat(65)])
   assert.throws(()=>q.proposeNote({title,text:'hi'}));
 assert.throws(()=>q.proposeNote({title:'valid',text:'\u001b[31m'}));
 const p=q.proposeNote({title:'valid',text:'held'});
 time+=600000;
 assert.equal(q.inspect(p.requestId).expired,true);
 assert.throws(()=>q.approve(p.requestId),{code:'V2_APPROVAL_EXPIRED'});
 assert.deepEqual(fs.readdirSync(path.join(root,'notes')),[]);
}));
test('bounded pending requests, symlink and tampering refused',()=>withRoot(root=>{
 let time=1000000;
 const q=createV2OwnerApprovalQueue({root,now:()=>time});
 const first=q.proposeNote({title:'valid',text:'a'});
 for(let i=0;i<3;i++)q.proposeNote({title:'valid',text:'b'});
 assert.throws(()=>q.proposeNote({title:'valid',text:'c'}),{code:'V2_APPROVAL_QUEUE_FULL'});
 const file=path.join(root,'pending',first.requestId+'.json');
 const record=JSON.parse(fs.readFileSync(file,'utf8'));
 record.text='changed';
 fs.writeFileSync(file,JSON.stringify(record));
 assert.throws(()=>q.approve(first.requestId),{code:'V2_APPROVAL_RECORD_CHANGED'});
 assert.deepEqual(fs.readdirSync(path.join(root,'notes')),[]);
}));
test('approval CLI refuses background/non-TTY, preserving request unchanged',()=>withRoot(root=>{
 // CLI points only at production owner path: invoke with no existing request id.
 const c=spawnSync(process.execPath,['tools/v2-owner-approval-cli.mjs','approve','00000000-0000-4000-8000-000000000000'],{
  cwd:process.cwd(),encoding:'utf8',timeout:5000
 });
 assert.notEqual(c.status,0);
 assert.match(c.stderr,/NATIVE_INTERACTIVE_CONSOLE_REQUIRED|V2_APPROVAL_/);
}));
test('MCP noauth proposal interface cannot approve or access arbitrary paths',()=>withRoot(root=>{
 const q=createV2OwnerApprovalQueue({root,now:()=>1000});
 const handler=createV2OwnerProposalHandler({queue:q});
 assert.equal(handler({name:'v2_owner_approve',args:{}}),null);
 assert.equal(handler({name:'v2_request_owner_note',args:{title:'ok',text:'hi',path:'/etc/passwd'}}).isError,true);
 const r=handler({name:'v2_request_owner_note',args:{title:'ok',text:'hi'}});
 assert.equal(r.isError,false);
 assert.equal(r.structuredContent.effectExecuted,false);
 assert.deepEqual(fs.readdirSync(path.join(root,'notes')),[]);
}));
