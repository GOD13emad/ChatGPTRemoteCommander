import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleV2PendingReviews,pickV2PendingReview} from '../src/v2-native-review-picker.mjs';
const id='f146762d-3404-4b6a-b22c-92405dd89786';
const second='95ff990a-5909-4cb3-8065-ec593c5a8563';
const item={id,tool:'system_status',arguments:{},status:'PENDING',expired:false};
test('picker allows only pending low-risk fixed empty-arg requests',()=>{
 const records=[item,{...item,id:second,tool:'run_shell'},
  {...item,id:second,tool:'gui_status',arguments:{x:1}}];
 assert.deepEqual(eligibleV2PendingReviews(records.map((x,i)=>i===2?{...x,id:'00000000-0000-4000-8000-000000000000'}:x))
  .map(x=>x.id),[id]);
 for(const bad of [{...item,status:'DISPATCHING_UNCERTAIN'},
  {...item,expired:true},{...item,tool:'write_text'},
  {...item,arguments:{command:'whoami'}}]){
  assert.equal(eligibleV2PendingReviews([bad]).length,0);
 }
});
test('native picker is selection only, cannot approve or execute, and rejects output spoofing',async()=>{
 let captured;
 const fake=(file,args,options,callback)=>{
  captured={file,args,options};
  callback(null,id+'\n');
 };
 assert.equal(await pickV2PendingReview([item],{dialog:fake}),id);
 assert.equal(captured.file,'/usr/bin/kdialog');
 assert.equal(captured.args.includes('--menu'),true);
 assert.equal(captured.args.includes(id),true);
 assert.equal(captured.args.includes('run_shell'),false);
 assert.equal(await pickV2PendingReview([item],{
  dialog:(a,b,c,cb)=>cb(null,'00000000-0000-4000-8000-000000000000\n')}),null);
 assert.equal(await pickV2PendingReview([item],{
  dialog:(a,b,c,cb)=>cb(new Error('cancel'),'')}),null);
});
test('invalid or duplicate requests are rejected and empty queue displays nothing',async()=>{
 assert.equal(await pickV2PendingReview([]),null);
 assert.throws(()=>eligibleV2PendingReviews([item,item]),/DUPLICATE/);
 assert.throws(()=>eligibleV2PendingReviews([{...item,id:'invalid'}]),/INVALID/);
});
