import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureWindowsMonitorDirectories}
  from '../src/browser-companion-windows-private.mjs';
import {createV012WindowsHostGlobalOperationLease}
  from '../src/v012-host-global-operation-lease.mjs';
import {createV012SharedPhysicalRootFence}
  from '../src/v012-shared-physical-root-fence.mjs';
import {WorkflowStore} from '../src/workflow-store.mjs';

// Native Windows two-PROCESS test. There are no user session, live grant,
// installed service, release, or filesystem changes outside a disposable
// owner-private NTFS directory. This is NOT Chat/J01 acceptance.
const WINDOWS=process.platform==='win32';
const HOST='qa-native-root-host';
const route={
  hostId:HOST,principalId:'owner',profileId:'default',
  conversationId:'qa-chat',operationId:'qa-transaction',
  target:{kind:'workflow-root',id:'parent-project'}
};
const marker='QA_NATIVE_DIRECT_ROOT_HELD';
async function ownerPrivateRoot(){
  const parent=fs.realpathSync.native(os.tmpdir());
  const root=path.join(parent,'rc012-shared-physical-win-'+randomUUID());
  await ensureWindowsMonitorDirectories([root],{create:true});
  const canonical=fs.realpathSync.native(root);
  assert.equal(path.win32.normalize(canonical).toLowerCase(),
    path.win32.normalize(root).toLowerCase());
  return canonical;
}
async function bridge(directory,allowedRoot){
  const native=await createV012WindowsHostGlobalOperationLease({
    directory,hostId:HOST
  });
  return {
    close:()=>native.close(),
    fence:createV012SharedPhysicalRootFence({
      nativeHostLease:Object.freeze({
        hostId:HOST,withLease:(resource,work)=>native.withLease(resource,work)
      }),
      hostId:HOST,allowedRoots:[allowedRoot],
      resolveTrustedRouteRoot:()=>allowedRoot
    })
  };
}
async function waitForMarker(child,text,timeoutMs=13000){
  return new Promise((resolve,reject)=>{
    let stdout='',stderr='';
    const cleanup=()=>{
      clearTimeout(timer);
      child.stdout.off('data',onStdout);
      child.stderr.off('data',onStderr);
      child.off('exit',onExit);
    };
    const onStdout=chunk=>{
      stdout+=String(chunk);
      if(stdout.includes(text)){cleanup();resolve();}
    };
    const onStderr=chunk=>{stderr+=String(chunk);};
    const onExit=code=>{
      cleanup();reject(Error('QA_HOLDER_EARLY_EXIT_'+code+':'+stderr));
    };
    const timer=setTimeout(()=>{
      cleanup();reject(Error('QA_HOLDER_MARKER_TIMEOUT:'+stderr));
    },timeoutMs);
    child.stdout.on('data',onStdout);
    child.stderr.on('data',onStderr);
    child.once('exit',onExit);
  });
}
async function waitExit(child,timeoutMs=13000){
  if(child.exitCode!==null||child.signalCode!==null)return child.exitCode;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      child.off('exit',onExit);
      reject(Error('QA_HOLDER_EXIT_TIMEOUT'));
    },timeoutMs);
    const onExit=code=>{clearTimeout(timer);resolve(code);};
    child.once('exit',onExit);
  });
}

if(process.argv[2]==='--native-holder'){
  if(!WINDOWS)throw Error('WINDOWS_NATIVE_HOLDER_OS_REQUIRED');
  const directory=process.argv[3];
  const holder=await bridge(directory,path.join(directory,'project'));
  try {
    await holder.fence.withDirectRouteLease(route,async()=>{
      process.stdout.write(marker+'\n');
      await new Promise((resolve,reject)=>{
        process.stdin.once('data',resolve);
        process.stdin.once('error',reject);
      });
      return {ok:true};
    });
    process.stdout.write('QA_NATIVE_DIRECT_ROOT_RELEASED\n');
  }finally{holder.close();}
} else {
  test('Windows owner-private native direct root excludes independent WorkflowStore child project',{
    skip:!WINDOWS,timeout:60000
  },async()=>{
    const directory=await ownerPrivateRoot();
    const parentRoot=path.join(directory,'project');
    const childRoot=path.join(parentRoot,'nested-project');
    const workflowDb=path.join(directory,'workflow');
    for(const dir of [parentRoot,childRoot,workflowDb])
      fs.mkdirSync(dir);
    fs.writeFileSync(path.join(childRoot,'proof.txt'),'fixture\n');
    let holder,store,owner;
    let effects=0;
    try{
      owner=await bridge(directory,childRoot);
      store=new WorkflowStore({
        directory:workflowDb,allowedRoots:[childRoot],device:HOST,
        configSha256:'a'.repeat(64),physicalRootFence:owner.fence,
        authority:{profileId:'default',tier:'FULL_POWER',
          capabilities:['filesystem.full','workflow.durable','workflow.scheduler']}
      });
      store.create({
        id:'sample',root:childRoot,goal:'Owner-local cross-engine regression',
        acceptance:['Native single-writer fence'],
        steps:[{id:'first',title:'Read',dependsOn:[]}]
      });
      holder=spawn(process.execPath,[
        fileURLToPath(import.meta.url),'--native-holder',directory
      ],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      await waitForMarker(holder,marker);
      const call=()=>store.call({
        id:'sample',stepId:'first',expectedRevision:1,tool:'read_text',
        arguments:{path:'proof.txt'}
      },{validate:async()=>{},dispatch:async()=>{
        effects++;return {ok:true};
      }});
      await assert.rejects(call(),{code:'V012_NATIVE_LEASE_OCCUPIED'});
      assert.equal(effects,0,'no WorkflowStore dispatch with parent native holder');
      holder.stdin.write('release\n');
      holder.stdin.end();
      assert.equal(await waitExit(holder),0);
      holder=null;
      const receipt=await call();
      assert.equal(receipt.outcome,'RECORDED_NOT_VALIDATED');
      assert.equal(effects,1,'one effect after verified native release');
    }finally{
      if(holder){
        if(holder.exitCode===null)holder.kill();
        await waitExit(holder).catch(()=>{});
      }
      store?.close();
      owner?.close();
      if(fs.existsSync(directory)
        &&fs.realpathSync.native(directory).toLowerCase()===directory.toLowerCase()){
        fs.rmSync(directory,{recursive:true,force:true});
      }
    }
  });
}
