import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForDevToolsPortFile} from '../src/browser-devtools-port.mjs';

function scenario({exitAt=null,signalAt=null,portAt=null,portText='49152',timeoutMs=500}={}){
  let ms=0;
  const child={exitCode:null,signalCode:null};
  const controls={
    now:()=>ms,
    pause:async step=>{
      ms+=step;
      if(exitAt!==null&&ms>=exitAt)child.exitCode=0;
      if(signalAt!==null&&ms>=signalAt)child.signalCode='SIGTERM';
    },
    fileExists:()=>portAt!==null&&ms>=portAt,
    readText:()=>portText,
    timeoutMs
  };
  return {child,controls,time:()=>ms};
}
test('clean Edge launcher exit before later DevTools port is a valid handoff',async()=>{
  const f=scenario({exitAt:50,portAt:200});
  const port=await waitForDevToolsPortFile('private/DevToolsActivePort',f.child,f.controls);
  assert.equal(port,49152);
  assert.equal(f.child.exitCode,0);
  assert.ok(f.time()>=200&&f.time()<500);
});
test('nonzero launcher exit fails closed before accepting a port',async()=>{
  const f=scenario({portAt:200});
  f.controls.pause=async step=>{f.child.exitCode=7;};
  await assert.rejects(waitForDevToolsPortFile('private/DevToolsActivePort',f.child,f.controls),
    /BROWSER_LAUNCH_FAILED/);
});
test('signalled launcher exit fails closed',async()=>{
  const f=scenario({signalAt:25,portAt:200});
  await assert.rejects(waitForDevToolsPortFile('private/DevToolsActivePort',f.child,f.controls),
    /BROWSER_LAUNCH_FAILED/);
});
test('launcher exits zero but no port ever appears: finite timeout, not success',async()=>{
  const f=scenario({exitAt:25,timeoutMs:200});
  await assert.rejects(waitForDevToolsPortFile('private/DevToolsActivePort',f.child,f.controls),
    /BROWSER_DEVTOOLS_TIMEOUT/);
  assert.ok(f.time()>=200&&f.time()<=225);
});
test('malformed port files never establish readiness',async()=>{
  for(const text of ['0','-1','65536','garbage','4.5']){
    const f=scenario({portAt:0,portText:text,timeoutMs:100});
    await assert.rejects(waitForDevToolsPortFile('file',f.child,f.controls),
      /BROWSER_DEVTOOLS_TIMEOUT/);
  }
});
test('racing disappearance of DevToolsActivePort is retried safely',async()=>{
  const f=scenario({exitAt:25,portAt:25,timeoutMs:300});
  let attempts=0;
  f.controls.readText=()=>{
    attempts++;
    if(attempts===1)throw Object.assign(new Error('file disappeared'),{code:'ENOENT'});
    return '49153\n/devtools/browser/private-only';
  };
  assert.equal(await waitForDevToolsPortFile('file',f.child,f.controls),49153);
  assert.ok(attempts>=2);
});
test('unreadable port file fails closed without exposing raw filesystem errors',async()=>{
  const f=scenario({portAt:0});
  f.controls.readText=()=>{throw Object.assign(new Error('PRIVATE_PATH_SENTINEL'),{code:'EACCES'});};
  await assert.rejects(waitForDevToolsPortFile('file',f.child,f.controls),
    error=>error.browserCode==='BROWSER_DEVTOOLS_UNAVAILABLE'&&!String(error).includes('PRIVATE_PATH_SENTINEL'));
});
