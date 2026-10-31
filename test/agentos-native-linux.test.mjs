import test from 'node:test';
import assert from 'node:assert/strict';
import {probeLinuxATSPI,observeLinuxATSPI} from '../src/agentos-native-linux.mjs';
import {createWorkspaceController,workspaceToolDefinitions} from '../src/workspace-tools.mjs';
const env={XDG_RUNTIME_DIR:'/run/user/1000',DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/1000/bus'};
const probe={ok:true,provider:'linux-atspi-native',mode:'AT_SPI_PROBE',desktopAccessible:true};
const runner=async (_program,args)=>({stdout:JSON.stringify(args[1]==='probe'?probe:
 {ok:true,provider:'linux-atspi-native',mode:'AT_SPI_OBSERVE',pid:Number(args[2]),elements:[{name:'Cancel',role:'push button'}]})});
test('runtime directory alone is not an AT-SPI success signal',async()=>{
 const x=await probeLinuxATSPI({platform:'linux',env},{uid:1000,runner:async()=>{throw Error('no bus')}});
 assert.equal(x.ready,false);
});
test('owner session exact UID and real probe required',async()=>{
 assert.equal((await probeLinuxATSPI({platform:'linux',env},{uid:1000,runner})).ready,true);
 assert.equal((await probeLinuxATSPI({platform:'linux',env},{uid:1001,runner})).ready,false);
});
test('exact PID read-only observe validates bounded response',async()=>{
 const r=await observeLinuxATSPI({pid:44,maxElements:3},{platform:'linux',env,uid:1000,runner});
 assert.equal(r.elements[0].name,'Cancel');
 await assert.rejects(observeLinuxATSPI({pid:0},{platform:'linux',env,uid:1000,runner}),/ATSPI_TARGET_INVALID/);
 await assert.rejects(observeLinuxATSPI({pid:44},{platform:'linux',env,uid:1000,runner:async()=>({stdout:'{}'})}),/ATSPI_NATIVE_RESPONSE_UNTRUSTED/);
});
test('workspace chooses Linux AT-SPI only after actual probe',async()=>{
 const c=createWorkspaceController({platform:'linux',env,ownerSession:async()=>true,
  linuxProbe:async()=>({ready:false})});
 assert.equal((await c.execute('workspace_agentos_plan',{target:'existing-app'})).code,'SEMANTIC_PROVIDER_UNAVAILABLE');
 const d=createWorkspaceController({platform:'linux',env,ownerSession:async()=>true,
  linuxProbe:async()=>({ready:true}),linuxObserve:async()=>({ok:true,pid:44,elements:[]})});
 assert.equal((await d.execute('workspace_agentos_plan',{target:'existing-app'})).provider,'linux-atspi-native');
 const result=await d.execute('workspace_native_atspi_observe',{pid:44});
 assert.equal(result.provider,'linux-atspi-native');assert.equal(result.physicalInputTouched,false);
 assert.equal(workspaceToolDefinitions.find(x=>x.name==='workspace_native_atspi_observe').annotations.readOnlyHint,true);
});
test('missing owner session blocks even read-only AT-SPI observation',async()=>{
 let calls=0;const ctl=createWorkspaceController({platform:'linux',env,ownerSession:async()=>false,
 linuxProbe:async()=>{calls++;return {ready:true}},linuxObserve:async()=>{calls++;}});
 await assert.rejects(ctl.execute('workspace_native_atspi_observe',{pid:44}),/WORKSPACE_OWNER_SESSION_REQUIRED/);
 assert.equal(calls,0);
});
