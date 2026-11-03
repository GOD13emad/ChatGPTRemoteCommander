import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {confirmV2AdvancedOwnerDialog} from '../src/v2-native-advanced-review.mjs';
import {eligibleV2AdvancedReviews,pickV2AdvancedReview} from '../src/v2-native-review-picker.mjs';

// POSIX owner/UID, local HOME and native review fixtures are Linux-specific.
// Windows must exercise its separate owner/Win32 adapters, not emulate POSIX authorization.
const posixTest = process.platform === 'win32' ? test.skip : test;
const id='dc44a10b-9d25-47cc-81e2-2bdc0fdaab05';
const request={requestId:id,tool:'run_shell',
 arguments:{command:'printf "%s\\n" "this is preview only"'}};
const fixture=async cb=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v2-advanced-review-'));
 const root=path.join(base,'owner');
 try{await cb(root)}finally{fs.rmSync(base,{recursive:true,force:true})}
};
posixTest('advanced native two-step preview displays exact arguments, requires typed code and destroys private preview',()=>fixture(async root=>{
 let stages=[],seen=null;
 const fake=(exe,args,options,cb)=>{
  stages.push(args);
  assert.equal(exe,'/usr/bin/kdialog');
  if(args.includes('--textbox')){
   const file=args[args.indexOf('--textbox')+1];
   const content=fs.readFileSync(file,'utf8');
   seen={content,mode:fs.statSync(file).mode&0o777};
   assert.equal(seen.mode,0o600);
   assert.match(content,/run_shell/);
   assert.match(content,/preview only/);
   cb(null,'');
  }else if(args.includes('--inputbox')){
   assert.match(args[args.indexOf('--inputbox')+1],/fingerprint [0-9a-f]{16}/);
   cb(null,'EXECUTE dc44a10b\n');
  }else cb(new Error('Unexpected dialog'));
 };
 assert.equal(await confirmV2AdvancedOwnerDialog(request,{dialog:fake,reviewRoot:root}),true);
 assert.equal(stages.length,2);
 assert.equal(fs.lstatSync(root).mode&0o777,0o700);
 assert.deepEqual(fs.readdirSync(root),[]);
 assert.match(seen.content,/requestId/);
}));
posixTest('advanced owner GUI rejects wrong phrase, cancellation and failure in preview',()=>fixture(async root=>{
 for(const scenario of ['wrong','cancel','viewer-error']){
  let count=0;
  const fake=(exe,args,opts,cb)=>{
   count++;
   if(scenario==='viewer-error')return cb(new Error('viewer refused'));
   if(scenario==='cancel'&&args.includes('--inputbox'))return cb(new Error('cancel'));
   cb(null,args.includes('--inputbox')?'EXECUTE wrong':'');
  };
  assert.equal(await confirmV2AdvancedOwnerDialog(request,{dialog:fake,reviewRoot:root}),false);
  assert.equal(count,scenario==='viewer-error'?1:2);
  assert.deepEqual(fs.readdirSync(root),[]);
 }
}));
posixTest('untrusted argument types, oversized fields, bidi and invalid requests are denied before GUI',()=>fixture(async root=>{
 let calls=0;
 const dialog=(a,b,c,cb)=>{calls++;cb(null,'EXECUTE dc44a10b')};
 for(const bad of [
  {...request,requestId:'../../test'},
  {...request,tool:'run_shell; rm'},
  {...request,arguments:{command:'x'.repeat(5000)}},
  {...request,arguments:{command:'\u202ehidden'}},
  {...request,arguments:{command:()=>{}}},
  {...request,arguments:{command:5n}},
  {...request,arguments:{path:undefined}},
  {...request,arguments:{constructor:'x'}}
 ]){
  await assert.rejects(()=>confirmV2AdvancedOwnerDialog(bad,{dialog,reviewRoot:root}),
    /V2_ADVANCED_REVIEW_ARGUMENTS_INVALID/);
 }
 assert.equal(calls,0);
 assert.deepEqual(fs.existsSync(root)?fs.readdirSync(root):[],[]);
}));
test('advanced picker includes sensitive tool names but selection alone does not execute',async()=>{
 const row={id,tool:'run_shell',arguments:{command:'true'},status:'PENDING',expired:false};
 assert.deepEqual(eligibleV2AdvancedReviews([row]).map(x=>x.tool),['run_shell']);
 let calls=0;
 const fake=(exe,args,opts,cb)=>{
  calls++;assert.equal(exe,'/usr/bin/kdialog');
  assert.ok(args.includes('--menu'));
  cb(null,id+'\n');
 };
 assert.equal(await pickV2AdvancedReview([row],{dialog:fake}),id);
 assert.equal(calls,1);
 assert.equal(await pickV2AdvancedReview([{...row,status:'V1_CALL_RETURNED'}],{dialog:fake}),null);
 assert.equal(await pickV2AdvancedReview([{...row,expired:true}],{dialog:fake}),null);
});
