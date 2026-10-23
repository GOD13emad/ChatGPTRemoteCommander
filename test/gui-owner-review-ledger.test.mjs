import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createOwnerReviewNonceLedger} from '../src/gui-owner-review-ledger.mjs';
import {createIncidentReviewChallenge} from '../src/gui-owner-review-challenge.mjs';
const incident=()=>({
 id:'00000000-1111-4222-8333-444444444444',
 tool:'gui_mouse_click',startedUtc:'2026-10-21T00:00:00.000Z',
 status:'PENDING_NATIVE_EFFECT',nativeOutcome:'UNKNOWN',
 evidenceSha256:'ab'.repeat(32),evidenceBytes:123
});
const challenge=(nonce='cd'.repeat(32))=>createIncidentReviewChallenge({
 incident:incident(),nonce,issuedUtc:'2026-10-21T00:00:00.000Z',
 expiryUtc:'2026-10-21T00:01:00.000Z'
});
async function fixture(run){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-owner-ledger-'));
 if(process.platform!=='win32')await fs.chmod(dir,0o700);
 try{return await run(dir,createOwnerReviewNonceLedger({directory:dir}));}
 finally{await fs.rm(dir,{force:true,recursive:true});}
}
const assertDenied=result=>{
 assert.equal(result.releaseAuthorized,false);
 assert.equal(result.ownerAuthenticated,false);
 assert.equal(result.fleetQuiescenceProven,false);
 assert.equal(result.storageTrusted,false);
 assert.equal(result.noReplay,true);
};
test('first diagnostic claim and second identical one: exactly once, no authorization',()=>fixture(async(dir,l)=>{
 const c=challenge(),first=await l.claim(c),second=await l.claim(c);
 assert.equal(first.claimRecorded,true);
 assert.equal(second.claimRecorded,false);
 assert.equal(second.reason,'CHALLENGE_ALREADY_RECORDED');
 assertDenied(first);assertDenied(second);
 const files=await fs.readdir(dir);
 assert.equal(files.length,1);
 assert.ok(files[0].startsWith('rc-gui-owner-review-consumed-v1-'));
 assert.doesNotMatch(files[0],/00000000-1111|gui_mouse/);
}));
test('concurrent claims share one OS exclusive-file winner',()=>fixture(async(dir,l)=>{
 const c=challenge(),results=await Promise.all(Array.from({length:25},()=>l.claim(c)));
 assert.equal(results.filter(x=>x.claimRecorded).length,1);
 assert.equal(results.filter(x=>x.reason==='CHALLENGE_ALREADY_RECORDED').length,24);
 for(const r of results)assertDenied(r);
 assert.equal((await fs.readdir(dir)).length,1);
}));
test('two separate Node processes cannot consume identical challenge twice',()=>fixture(async(dir)=>{
 const data=JSON.stringify(challenge());
 const script=[
  "import {createOwnerReviewNonceLedger} from './src/gui-owner-review-ledger.mjs';",
  "const result=await createOwnerReviewNonceLedger({directory:process.argv[1]}).claim(JSON.parse(process.argv[2]));",
  "console.log(JSON.stringify(result));"
 ].join('\n');
 const work=path.resolve('.');
 const spawnOne=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script,dir,data],{
   cwd:work,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',err='';
  child.stdout.on('data',b=>output+=b);
  child.stderr.on('data',b=>err+=b);
  child.once('error',reject);
  child.once('close',code=>{
   if(code)reject(Error(err));else resolve(JSON.parse(output));
  });
 });
 const all=await Promise.all([spawnOne(),spawnOne(),spawnOne(),spawnOne()]);
 assert.equal(all.filter(x=>x.claimRecorded).length,1);
 for(const x of all)assertDenied(x);
}));
test('changing nonce generates independent proposal, not owner permission',()=>fixture(async(dir,l)=>{
 const x=await l.claim(challenge('cd'.repeat(32)));
 const y=await l.claim(challenge('ef'.repeat(32)));
 assert.equal(x.claimRecorded,true);assert.equal(y.claimRecorded,true);
 assertDenied(x);assertDenied(y);
 assert.equal((await fs.readdir(dir)).length,2);
}));
test('corrupt or half-written claim blocks subsequent use without overwrite',()=>fixture(async(dir,l)=>{
 const c=challenge(),res=await l.claim(c);
 assert.equal(res.claimRecorded,true);
 const file=path.join(dir,(await fs.readdir(dir))[0]);
 await fs.writeFile(file,'{bad');
 const result=await l.claim(c);
 assert.equal(result.claimRecorded,false);
 assert.equal(result.reason,'CHALLENGE_ALREADY_RECORDED');
 assert.equal(await fs.readFile(file,'utf8'),'{bad');
 assertDenied(result);
}));
test('missing ledger root is a block, never silently created',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-owner-ledger-missing-'));
 const missing=path.join(root,'absent');
 try{
  const r=await createOwnerReviewNonceLedger({directory:missing}).claim(challenge());
  assert.equal(r.claimRecorded,false);assertDenied(r);
  await assert.rejects(fs.lstat(missing),{code:'ENOENT'});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('untrusted symlinked ledger directory blocks all claims',{
 skip:process.platform==='win32'
},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-owner-ledger-symlink-'));
 await fs.chmod(root,0o700);
 const target=path.join(root,'target');await fs.mkdir(target,{mode:0o700});
 const alias=path.join(root,'alias');await fs.symlink(target,alias,'dir');
 try{
  const result=await createOwnerReviewNonceLedger({directory:alias}).claim(challenge());
  assert.equal(result.claimRecorded,false);assertDenied(result);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('malformed or forged challenge is not registered',()=>fixture(async(dir,l)=>{
 await assert.rejects(l.claim({...challenge(),releaseAuthorized:true}),/GUI_OWNER_REVIEW_/);
 await assert.rejects(l.claim({...challenge(),challengeSha256:'00'.repeat(32)}),/GUI_OWNER_REVIEW_/);
 assert.equal((await fs.readdir(dir)).length,0);
}));
test('reject relative ledger root before writing',()=>{
 assert.throws(()=>createOwnerReviewNonceLedger({directory:'../test'}),/GUI_OWNER_LEDGER_PATH_INVALID/);
});
