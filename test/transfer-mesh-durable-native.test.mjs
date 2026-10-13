import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createTransferMeshTools} from '../src/transfer-tools.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const from=path.join(here,'..','tools','commander-transfer-mesh');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('opt-in durable native tools queue asynchronously, verify staging and preserve allowlists',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-durable-native-'));
 try{
  fs.copyFileSync(path.join(from,'pilot-cli.mjs'),path.join(root,'transfer.mjs'));
  fs.copyFileSync(path.join(from,'durable-send.mjs'),path.join(root,'durable-send.mjs'));
  fs.writeFileSync(path.join(root,'node.json'),JSON.stringify({alias:'PC'}));
  const allowed=path.join(root,'allowed'),inbox=path.join(root,'inbox');
  fs.mkdirSync(allowed);fs.mkdirSync(inbox);
  const file=path.join(allowed,'file.dat');
  fs.writeFileSync(file,Buffer.alloc(12*1024*1024,0x17));
  const tools=createTransferMeshTools({config:{powerMode:{enabled:true},transferMesh:{
    enabled:true,durableEnabled:true,root,sourceRoots:[allowed],destinationRoots:[inbox]
  }}});
  assert.equal(tools.definitions.length,8);
  const initial=await tools.execute('transfer_mesh_enqueue',{peer:'Linux',path:file,id:'native-durable-001'});
  assert.equal(initial.status,'QUEUED');
  let result;
  for(let i=0;i<180;i++){
    result=await tools.execute('transfer_mesh_job_status',{peer:'Linux',id:'native-durable-001'});
    if(result.status==='PUBLISHED')break;
    assert.notEqual(result.status,'FAILED',JSON.stringify(result));
    await sleep(40);
  }
  assert.equal(result.status,'PUBLISHED');
  assert.equal(result.percent,100);
  assert.equal(result.copiedBytes,result.bytes);
  const filePath=path.join(root,'pairs','Linux','transfers','native-durable-001','payload.bin');
  assert.deepEqual(fs.readFileSync(filePath),fs.readFileSync(file));
  await assert.rejects(tools.execute('transfer_mesh_enqueue',{peer:'Linux',path:path.join(root,'node.json'),id:'native-deny-001'}),/TRANSFER_PATH_NOT_ALLOWED/);
  await assert.rejects(tools.execute('transfer_mesh_enqueue',{peer:'Linux',path:file,id:'native-durable-001'}),/CTMESH_DURABLE_ERROR|EEXIST/);
 }finally{await sleep(350);fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:150});}
});
test('durable tools remain hidden if configuration does not enable them',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-durable-disabled-'));
 try{
  fs.copyFileSync(path.join(from,'pilot-cli.mjs'),path.join(root,'transfer.mjs'));
  fs.writeFileSync(path.join(root,'node.json'),JSON.stringify({alias:'PC'}));
  const config={powerMode:{enabled:true},transferMesh:{enabled:true,durableEnabled:false,root,sourceRoots:[root],destinationRoots:[root]}};
  const t=createTransferMeshTools({config});
  assert.equal(t.definitions.length,4);
  assert.equal(t.definitions.some(x=>x.name==='transfer_mesh_enqueue'),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('native durable admission respects per-device explicit maxSourceBytes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-durable-limit-'));
 try{
  fs.copyFileSync(path.join(from,'pilot-cli.mjs'),path.join(root,'transfer.mjs'));
  fs.copyFileSync(path.join(from,'durable-send.mjs'),path.join(root,'durable-send.mjs'));
  fs.writeFileSync(path.join(root,'node.json'),JSON.stringify({alias:'PC'}));
  const allowed=path.join(root,'allowed'),dest=path.join(root,'inbox');
  fs.mkdirSync(allowed);fs.mkdirSync(dest);
  const large=path.join(allowed,'rejected.dat');fs.writeFileSync(large,Buffer.alloc(4096));
  const tools=createTransferMeshTools({config:{powerMode:{enabled:true},transferMesh:{
    enabled:true,durableEnabled:true,root,sourceRoots:[allowed],destinationRoots:[dest],
    maxSourceBytes:1024,maxPendingBytes:8192,maxActiveJobs:1
  }}});
  await assert.rejects(tools.execute('transfer_mesh_enqueue',{
    peer:'Linux',path:large,id:'denied-oversized-001'
  }),/TRANSFER_SOURCE_SIZE_QUOTA/);
  assert.equal(fs.existsSync(path.join(root,'jobs','Linux','denied-oversized-001.json')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
