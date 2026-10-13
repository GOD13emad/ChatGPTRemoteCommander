import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTransferMeshTools, transferMeshToolDefinitions } from '../src/transfer-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../tools/commander-transfer-mesh/pilot-cli.mjs');
function setup(alias) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctmesh-native-'));
 fs.copyFileSync(CLI,path.join(root,'transfer.mjs'));
 fs.writeFileSync(path.join(root,'node.json'), JSON.stringify({alias, schema:'ctmesh-node-v1'}));
 const src=path.join(root,'inputs'),dest=path.join(root,'outputs');
 fs.mkdirSync(src); fs.mkdirSync(dest);
 const tools=createTransferMeshTools({config:{powerMode:{enabled:true},transferMesh:{
  enabled:true,root,sourceRoots:[src],destinationRoots:[dest]
 }}});
 return {root,tools,src,dest};
}
async function fixture(fn) {
 const a=setup('PC'),b=setup('Linux');
 try { await fn(a,b); } finally {fs.rmSync(a.root,{recursive:true,force:true});fs.rmSync(b.root,{recursive:true,force:true});}
}
test('feature is hidden unless explicit enable and Power Mode', ()=>{
 assert.equal(createTransferMeshTools({config:{}}).definitions.length,0);
 assert.equal(createTransferMeshTools({config:{powerMode:{enabled:false},transferMesh:{enabled:true}}}).definitions.length,0);
 assert.equal(transferMeshToolDefinitions.length,4);
 assert.deepEqual(transferMeshToolDefinitions.map(x=>x.name),['transfer_mesh_info','transfer_mesh_send','transfer_mesh_status','transfer_mesh_receive']);
});
test('native adapter sends, reads status and receives safely without overwrite',async()=>{
 await fixture(async(a,b)=>{
  assert.equal(a.tools.enabled,true);
  const file=path.join(a.src,'input.dat');
  fs.writeFileSync(file,Buffer.from('12345678912345'));
  const info=await a.tools.execute('transfer_mesh_info');
  assert.equal(info.device,'PC');
  const sent=await a.tools.execute('transfer_mesh_send',{peer:'Linux',path:file,id:'native-001'});
  assert.equal(sent.status,'QUEUED');
  const incoming=path.join(b.root,'pairs','PC','transfers','native-001');
  fs.mkdirSync(path.dirname(incoming),{recursive:true});
  fs.cpSync(path.join(a.root,'pairs','Linux','transfers','native-001'),incoming,{recursive:true});
  assert.equal((await b.tools.execute('transfer_mesh_status',{peer:'PC',id:'native-001'})).status,'RECEIVED_HASH_VERIFIED');
  const complete=await b.tools.execute('transfer_mesh_receive',{peer:'PC',id:'native-001',dest:b.dest});
  assert.equal(complete.status,'DELIVERED_HASH_VERIFIED');
  assert.deepEqual(fs.readFileSync(path.join(b.dest,'input.dat')),fs.readFileSync(file));
  await assert.rejects(b.tools.execute('transfer_mesh_receive',{peer:'PC',id:'native-001',dest:b.dest}),/Destination exists/);
 });
});
test('root allowlists deny unauthorized paths and other peers',async()=>{
 await fixture(async(a)=>{
  const file=path.join(a.root,'other.dat');
  fs.writeFileSync(file,'private');
  await assert.rejects(a.tools.execute('transfer_mesh_send',{peer:'Linux',path:file,id:'native-002'}),/TRANSFER_PATH_NOT_ALLOWED/);
  await assert.rejects(a.tools.execute('transfer_mesh_send',{peer:'NotARealDevice',path:file,id:'native-003'}),/TRANSFER_UNKNOWN_PEER/);
  await assert.rejects(a.tools.execute('transfer_mesh_send',{peer:'Linux',path:file,id:'..'}),/TRANSFER_ID_INVALID/);
  await assert.rejects(a.tools.execute('transfer_mesh_receive',{peer:'Linux',id:'native-003',dest:a.src}),/TRANSFER_PATH_NOT_ALLOWED/);
 });
});
test('failed config and blocked symlink path',async(t)=>{
 await fixture(async(a)=>{
  assert.throws(()=>createTransferMeshTools({config:{powerMode:{enabled:true},transferMesh:{enabled:true,root:'relative'}}}),/TRANSFER_MESH_ROOT_INVALID/);
  const file=path.join(a.src,'real.dat'),sym=path.join(a.src,'alias.dat');
  fs.writeFileSync(file,'sample');
  try {fs.symlinkSync(file,sym);}catch(e){if(e.code==='EPERM'){t.diagnostic('Windows symlink creation unavailable');return;}throw e;}
  await assert.rejects(a.tools.execute('transfer_mesh_send',{peer:'Linux',path:sym,id:'native-004'}),/TRANSFER_SYMLINK_DENIED/);
 });
});
