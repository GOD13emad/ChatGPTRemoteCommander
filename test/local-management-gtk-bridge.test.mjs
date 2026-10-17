import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkflowTools } from '../src/workflow-tools.mjs';
import { startLinuxLocalManagement } from '../src/local-management-linux.mjs';

const supported = process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() > 0;
const native = (label,fn) => test(label,{skip:!supported,timeout:15000},fn);
const clientPath = fileURLToPath(new URL('./fixtures/local-management-gtk-client.py', import.meta.url));
const target = {deviceId:'fixture',profileId:'default',configSha256:'1'.repeat(64),routeGeneration:1};

for(const [mode,action] of [['dismiss','pause'],['confirm','pause'],['confirm','cancel']]){
  native(`synthetic Gtk ${mode} ${action}: actual SO_PEERCRED client, one resident Core and no project steps`,async t=>{
    const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rcm-gtk-signal-')));
    let effects=0;
    const tools=createWorkflowTools({config:{durableWorkflows:{enabled:true,directory:path.join(root,'state'),scheduler:{enabled:false}}},
      roots:[root],device:'fixture',configSha256:'1'.repeat(64),lookup:()=>null,
      validateSchema:()=>[],dispatch:async()=>{effects++;assert.fail('project step executed by GUI');}});
    let controls=0, ep;
    let child;
    t.after(async()=>{
      if(child?.exitCode===null&&child?.signalCode===null)child.kill('SIGKILL');
      await ep?.close();
      await tools.close();
      fs.rmSync(root,{recursive:true,force:true});
    });
    await tools.execute('workflow_create',{id:'sample',root,goal:'Synthetic signal only',
      acceptance:['Real native pause/cancel receipt'],steps:[{id:'never',title:'Must not run'}]});
    const wrapped={definitions:tools.definitions,execute:(name,args)=>{if(name==='workflow_control')controls++;return tools.execute(name,args);}};
    child=spawn('/usr/bin/python3',['-I','-B','-u',clientPath],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk;assert.ok(stdout.length<20000);});
    child.stderr.on('data',chunk=>{stderr+=chunk;assert.ok(stderr.length<20000);});
    const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
    ep=await startLinuxLocalManagement({enabled:true,runtimeDirectory:root,target,readIdentity:()=>target,
      workflowTools:wrapped,expectedClientPid:child.pid,sessionMs:10000,idleMs:4000});
    child.stdin.end(JSON.stringify({endpoint:ep.endpoint,serverPid:ep.helperPid,target,
      db:path.join(root,'state','workflows.sqlite'),mode,action})+'\n');
    const exitCode=await done;
    assert.equal(exitCode,0,`exit=${exitCode} stdout=${stdout} stderr=${stderr}`);
    const receipt=JSON.parse(stdout);
    assert.equal(receipt.viewStatus,'ISOLATED_SYNTHETIC_GTK_SIGNAL_NOT_NATIVE_RENDER');
    assert.equal(receipt.confirmationDialog,true);
    assert.equal(receipt.targetConfirmed,true);
    assert.equal(receipt.initialRevision,1);
    assert.equal(receipt.finalRevision,mode==='confirm'?2:1);
    assert.equal(controls,mode==='confirm'?1:0);
    assert.equal(effects,0);
    assert.equal((await tools.execute('workflow_get',{id:'sample'})).state.steps[0].status,'pending');
    if(mode==='confirm'){
      assert.match(receipt.feedback,/APPLIED/);
      assert.equal(receipt.finalState,action==='pause'?'WAITING':'CANCELLED');
    }else assert.match(receipt.feedback,/No command requested/);
    await ep.closed;
    assert.equal(fs.existsSync(ep.endpoint),false);
  });
}
