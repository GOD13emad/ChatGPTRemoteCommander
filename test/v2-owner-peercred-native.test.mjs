import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../tools/v2-owner-peercred-linux.py',import.meta.url));
const supported=process.platform==='linux'&&typeof process.getuid==='function'&&process.getuid()!==0;
function exitInfo(child){
 return new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('exit',(code,signal)=>resolve({code,signal}));
 });
}
function listenReady(child){
 return new Promise((resolve,reject)=>{
  let received='';
  const timer=setTimeout(()=>reject(Error('QA_READY_TIMEOUT')),4000);
  const onData=chunk=>{
   received+=chunk.toString('utf8');
   const nl=received.indexOf('\n');
   if(nl!==-1){clearTimeout(timer);child.stdout.off('data',onData);
    try{resolve(JSON.parse(received.slice(0,nl)))}catch(e){reject(e)}
   }
  };
  child.stdout.on('data',onData);
  child.once('exit',()=>{clearTimeout(timer);reject(Error('QA_EXITED_BEFORE_READY'))});
 });
}
function connectOnce(sock){
 return new Promise((resolve,reject)=>{
  const client=net.createConnection({path:sock});
  let result='';
  const timer=setTimeout(()=>{client.destroy();reject(Error('CLIENT_TIMEOUT'))},4000);
  client.on('data',b=>{result+=b.toString('utf8');
   if(result.includes('\n')){clearTimeout(timer);client.end();
    try{resolve(JSON.parse(result.slice(0,result.indexOf('\n'))))}catch(e){reject(e)}
   }
  });
  client.once('error',e=>{clearTimeout(timer);reject(e)});
 });
}
test('real Linux SO_PEERCRED authenticates actual local kernel UID for a read-only one-shot IPC', {skip:!supported}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'commander-v2-peer-'));
 const sock=path.join(dir,'qa.sock');
 const child=spawn('python3',[script,'--socket',sock],{stdio:['ignore','pipe','pipe']});
 try{
  const ready=await listenReady(child);
  assert.equal(ready.gate,'CMDV2_OWNER_PEER_QA_LISTENING');
  assert.equal(fs.statSync(dir).mode&0o077,0);
  assert.equal(fs.lstatSync(sock).mode&0o077,0);
  const result=await connectOnce(sock);
  assert.equal(result.kernelPeerVerified,true);
  assert.equal(result.ownerUidMatch,true);
  assert.equal(result.mcpToolAuthorized,false);
  assert.equal(result.accountAuthenticated,false);
  assert.equal(result.osAdminGranted,false);
  assert.equal(result.readOnly,true);
  assert.deepEqual(await exitInfo(child),{code:0,signal:null});
  assert.equal(fs.existsSync(sock),false);
 }finally{if(child.exitCode===null)child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
test('world-accessible parent fails before socket binding', {skip:!supported},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'commander-v2-peer-'));
 const sock=path.join(dir,'qa.sock');
 fs.chmodSync(dir,0o755);
 try{
  const child=spawn('python3',[script,'--socket',sock],{stdio:['ignore','pipe','pipe']});
  assert.equal((await exitInfo(child)).code,2);
  assert.equal(fs.existsSync(sock),false);
 }finally{fs.chmodSync(dir,0o700);fs.rmSync(dir,{recursive:true,force:true});}
});
test('existing symlink socket is never replaced or followed', {skip:!supported},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'commander-v2-peer-'));
 const target=path.join(dir,'target');
 const sock=path.join(dir,'qa.sock');
 fs.writeFileSync(target,'untouched',{mode:0o600});
 fs.symlinkSync(target,sock);
 try{
  const child=spawn('python3',[script,'--socket',sock],{stdio:['ignore','pipe','pipe']});
  assert.equal((await exitInfo(child)).code,2);
  assert.equal(fs.readFileSync(target,'utf8'),'untouched');
  assert.equal(fs.lstatSync(sock).isSymbolicLink(),true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
