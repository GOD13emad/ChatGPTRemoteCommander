import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createV012OwnerGrantAdminUnix}
  from '../src/v012-owner-grant-admin-unix.mjs';
import {runCli} from '../tools/v012-owner-grant-admin-cli-linux.mjs';
function child(profile,mode='--inspect'){
  return new Promise((resolve,reject)=>{
    const proc=spawn(process.execPath,[
      'tools/v012-owner-grant-admin-cli-linux.mjs',mode,'--profile',profile
    ],{cwd:path.resolve(import.meta.dirname,'..'),stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    proc.stdout.on('data',x=>stdout+=x);
    proc.stderr.on('data',x=>stderr+=x);
    proc.once('error',reject);
    proc.once('close',code=>resolve({code,stdout,stderr}));
  });
}
test('real child CLI uses one owner-local broker socket and fixed exact actions only',
  {skip:process.platform!=='linux'},async()=>{
  const uid=process.getuid();
  if(!Number.isSafeInteger(uid)||!fs.existsSync('/run/user/'+uid))return;
  const profile='qa-'+randomBytes(4).toString('hex');
  const dir='/run/user/'+uid+'/rc012-owner-admin-'+profile;
  const socketPath=path.join(dir,'admin.sock');
  fs.mkdirSync(dir,{mode:0o700});
  let controller,prompts=0;
  try{
    controller=createV012OwnerGrantAdminUnix({socketPath,administration:{
      inspect:async()=>({nativeOwnerBound:true,workerActive:false,
        exactBaseEnabled:false,exactWorkerToolEnabled:false,
        readOnlyCanaryAllowed:false}),
      approveWorker:async()=>{prompts++;return {revision:1};},
      approveReadOnlyCanary:async()=>{prompts++;return {canaryAllowed:true};}
    }});
    await controller.start();
    const inspected=await child(profile);
    assert.equal(inspected.code,0,inspected.stderr);
    assert.equal(JSON.parse(inspected.stdout).readOnlyCanaryAllowed,false);
    assert.equal(prompts,0);
    const approved=await child(profile,'--approve-worker');
    assert.equal(approved.code,0,approved.stderr);
    assert.equal(JSON.parse(approved.stdout).approved,true);
    assert.equal(prompts,1);
    await assert.rejects(runCli(['--grant-full-access','--profile',profile]),
      {code:'RC012_OWNER_ADMIN_CLI_ARGS_INVALID'});
    await assert.rejects(runCli(['--inspect','--profile','../other']),
      {code:'RC012_OWNER_ADMIN_CLI_ARGS_INVALID'});
    assert.equal(prompts,1);
  }finally{await controller?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
