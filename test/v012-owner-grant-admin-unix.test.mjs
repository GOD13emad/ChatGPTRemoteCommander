import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createV012OwnerGrantAdminUnix}
  from '../src/v012-owner-grant-admin-unix.mjs';

function call(socketPath,text){
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(socketPath);
    let response='';
    socket.setTimeout(8000,()=>socket.destroy(Error('FIXTURE_TIMEOUT')));
    socket.once('connect',()=>socket.end(text));
    socket.on('data',chunk=>{response+=chunk.toString('utf8');});
    socket.once('error',reject);
    socket.once('close',()=>resolve(response));
  });
}
test('owner-local Unix endpoint sends fixed actions to actual native approval callbacks only',
  {skip:process.platform!=='linux'},async()=>{
  const uid=process.getuid();
  if(!Number.isSafeInteger(uid)||!fs.existsSync('/run/user/'+uid))
    return;
  const dir=fs.mkdtempSync('/run/user/'+uid+'/rc012-owner-unix-fixture-');
  const socketPath=path.join(dir,'admin.sock');
  let prompts=0,controller;
  try{
    controller=createV012OwnerGrantAdminUnix({
      socketPath,
      administration:{
        inspect:async()=>({nativeOwnerBound:true,workerActive:false,
          exactBaseEnabled:false,exactWorkerToolEnabled:false,
          readOnlyCanaryAllowed:false,secret:'MUST_NOT_EXPOSE'}),
        approveWorker:async()=>{prompts++;return {revision:1,workerId:'SECRET_WORKER_ID'};},
        approveReadOnlyCanary:async()=>{prompts++;return {canaryAllowed:true,token:'SECRET'};},
        approveSignedRegistration:async()=>{prompts++;return {registrationAllowed:true};},
        registerSignedWorker:async()=>{prompts++;return {registered:true,privateKey:'NEVER_EXPOSE'};},
        revokeCanaryWorker:async()=>{prompts++;return {revoked:true,secret:'NEVER_EXPOSE'};}
      }
    });
    const state=await controller.start();
    assert.equal(state.mutationRequiresNativeOwnerConsent,true);
    const st=fs.lstatSync(socketPath);
    assert.ok(st.isSocket());assert.equal(st.mode&0o077,0);
    const request=action=>JSON.stringify({schema:1,action})+'\n';
    const inspect=await call(socketPath,request('inspect'));
    assert.equal(JSON.parse(inspect).readOnlyCanaryAllowed,false);
    assert.equal(inspect.includes('MUST_NOT_EXPOSE'),false);
    assert.deepEqual(JSON.parse(await call(socketPath,request('approve_worker'))),{ok:true,approved:true});
    assert.deepEqual(JSON.parse(await call(socketPath,request('approve_system_status_canary'))),{ok:true,approved:true});
    assert.equal(prompts,2);
    assert.deepEqual(JSON.parse(await call(socketPath,request('approve_worker_registration'))),
      {ok:true,approved:true});
    const enrolled=await call(socketPath,request('register_signed_worker'));
    assert.deepEqual(JSON.parse(enrolled),{ok:true,registered:true});
    assert.equal(enrolled.includes('NEVER_EXPOSE'),false);
    assert.equal(prompts,4);
    const revoked=await call(socketPath,request('revoke_canary_worker'));
    assert.deepEqual(JSON.parse(revoked),{ok:true,revoked:true});
    assert.equal(revoked.includes('NEVER_EXPOSE'),false);
    assert.equal(prompts,5);
    for(const text of [
      '{"schema":1,"action":"approve_worker","tool":"run_shell"}\n',
      '{"schema":1,"action":"approve_worker","action":"approve_system_status_canary"}\n',
      '{"action":"approve_worker","schema":1}\n',
      '{"schema":1,"action":"run_shell"}\n',
      '{"schema":1,"action":"approve_worker","workerId":"fake"}\n'
    ])assert.deepEqual(JSON.parse(await call(socketPath,text)),{ok:false,code:'INVALID'});
    assert.equal(prompts,5);
  }finally{await controller?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('existing socket, public runtime directory, alias and absent admin provider deny bind',
  {skip:process.platform!=='linux'},async()=>{
  const uid=process.getuid();
  if(!Number.isSafeInteger(uid)||!fs.existsSync('/run/user/'+uid))return;
  const root=fs.mkdtempSync('/run/user/'+uid+'/rc012-owner-unix-negative-');
  const dir=path.join(root,'private'),alias=path.join(root,'alias');
  const m={inspect:async()=>({}),approveWorker:async()=>({revision:1}),
    approveReadOnlyCanary:async()=>({canaryAllowed:true})};
  try{
    fs.mkdirSync(dir,{mode:0o755});
    let broker=createV012OwnerGrantAdminUnix({socketPath:path.join(dir,'admin.sock'),administration:m});
    await assert.rejects(broker.start(),{code:'RC012_OWNER_ADMIN_SOCKET_DIRECTORY_NOT_PRIVATE'});
    fs.chmodSync(dir,0o700);
    fs.symlinkSync(dir,alias);
    broker=createV012OwnerGrantAdminUnix({socketPath:path.join(alias,'admin.sock'),administration:m});
    await assert.rejects(broker.start(),{code:'RC012_OWNER_ADMIN_SOCKET_DIRECTORY_ALIAS'});
    fs.writeFileSync(path.join(dir,'admin.sock'),'not-a-socket');
    broker=createV012OwnerGrantAdminUnix({socketPath:path.join(dir,'admin.sock'),administration:m});
    await assert.rejects(broker.start(),{code:'RC012_OWNER_ADMIN_SOCKET_ALREADY_EXISTS'});
    assert.throws(()=>createV012OwnerGrantAdminUnix({socketPath:path.join(dir,'admin.sock'),administration:{}}),
      {code:'RC012_OWNER_ADMIN_METHODS_REQUIRED'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('owner-local shutdown closes pending approval socket without waiting for its dialog',
  {skip:process.platform!=='linux'},async()=>{
  const uid=process.getuid();
  if(!Number.isSafeInteger(uid)||!fs.existsSync('/run/user/'+uid))return;
  const dir=fs.mkdtempSync('/run/user/'+uid+'/rc012-owner-unix-shutdown-');
  const socketPath=path.join(dir,'admin.sock');
  let started,complete,server;
  const pending=new Promise(resolve=>complete=resolve);
  const startedPromise=new Promise(resolve=>started=resolve);
  try{
    server=createV012OwnerGrantAdminUnix({socketPath,administration:{
      inspect:async()=>({}),approveWorker:async()=>{
        started();return pending;
      },approveReadOnlyCanary:async()=>({canaryAllowed:false})
    }});
    await server.start();
    const socket=net.createConnection(socketPath);
    socket.once('connect',()=>{
      socket.write(JSON.stringify({schema:1,action:'approve_worker'})+'\n');
    });
    await startedPromise;
    await Promise.race([
      server.close(),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('SHUTDOWN_STUCK')),3000))
    ]);
    complete({revision:1});
    socket.destroy();
    assert.equal(fs.existsSync(socketPath),false);
  }finally{complete?.({revision:1});await server?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
