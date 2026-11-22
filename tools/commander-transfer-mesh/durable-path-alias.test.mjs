import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('./durable-send.mjs',import.meta.url));
const call=(root,...argv)=>JSON.parse(execFileSync(process.execPath,[cli,...argv],{
  env:{...process.env,COMMANDER_TRANSFER_HOME:root},encoding:'utf8',timeout:6000
}).trim());
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('durable transfer refuses a symlinked internal publication root', {skip:process.platform==='win32'},async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'ctmesh-path-alias-'));
 const home=path.join(base,'owner'),outside=path.join(base,'outside');
 const id='alias-reject-001';
 try{
  fs.mkdirSync(home);fs.mkdirSync(outside);
  fs.writeFileSync(path.join(home,'node.json'),JSON.stringify({alias:'PC'}));
  const allowed=path.join(home,'allowed');fs.mkdirSync(allowed);
  const source=path.join(allowed,'payload.bin');fs.writeFileSync(source,'test payload');
  fs.symlinkSync(outside,path.join(home,'pairs'),'dir');
  let admitted=false,failedEarly=false,state=null;
  try{
   const r=call(home,'enqueue','--peer','Linux','--path',source,'--source-root',allowed,'--id',id);
   admitted=r.status==='QUEUED';
  }catch(error){
   failedEarly=true;
   assert.match(String(error?.stderr??error),/TRANSFER_DIRECTORY_UNSAFE/);
  }
  if(admitted){
   for(let i=0;i<80;i++){
    const j=call(home,'job-status','--peer','Linux','--id',id);
    state=j.status;
    if(['FAILED','PUBLISHED','CANCELLED'].includes(state))break;
    await delay(40);
   }
   assert.equal(state,'FAILED','symlinked publication unexpectedly accepted: '+state);
  }else assert.equal(failedEarly,true);
  assert.equal(fs.existsSync(path.join(outside,'Linux','transfers',id,'payload.bin')),false,
   'payload escaped the configured transfer root');
 }finally{fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

for(const components of [
 ['jobs'],['jobs','Linux'],['staging'],['staging','Linux'],
 ['pairs','Linux'],['pairs','Linux','transfers']
]){
 test('durable enqueue fails closed for aliased '+components.join('/'),{skip:process.platform==='win32'},()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'ctmesh-alias-fixture-'));
  const home=path.join(base,'owner'),outside=path.join(base,'outside');
  try{
   fs.mkdirSync(home);fs.mkdirSync(outside);
   fs.writeFileSync(path.join(home,'node.json'),JSON.stringify({alias:'PC'}));
   const allowed=path.join(home,'allowed');fs.mkdirSync(allowed);
   const source=path.join(allowed,'payload.bin');fs.writeFileSync(source,'confidential fixture');
   const link=path.join(home,...components);
   fs.mkdirSync(path.dirname(link),{recursive:true});
   fs.symlinkSync(outside,link,'dir');
   assert.throws(()=>call(home,'enqueue','--peer','Linux','--path',source,
    '--source-root',allowed,'--id','alias-unsafe-003'),/TRANSFER_DIRECTORY_UNSAFE/);
   assert.deepEqual(fs.readdirSync(outside),[],'alias destination was modified');
  }finally{fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 });
}
