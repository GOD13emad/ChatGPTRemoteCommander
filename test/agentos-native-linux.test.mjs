import test from 'node:test';
import assert from 'node:assert/strict';
import {statSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
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

test('new-browser provider must have a real ready policy-enabled browser status',async()=>{
 const make=(browserProbe,ownerSession=async()=>true)=>createWorkspaceController({
  platform:'win32',env:{SESSIONNAME:'Console'},ownerSession,browserProbe
 });
 const ready={ok:true,available:true,enabled:true,busy:false,leased:false,uncertain:false,sessionResetRequired:false};
 const good=make(async()=>ready);
 assert.equal((await good.execute('workspace_agentos_plan',{target:'new-browser'})).provider,'commander-owned-browser');
 const cases=[
  {...ready,enabled:false},{...ready,available:false},{...ready,busy:true},
  {...ready,leased:true},{...ready,uncertain:true},{...ready,sessionResetRequired:true},
  {...ready,ok:false}
 ];
 for(const bad of cases){
  const result=await make(async()=>bad).execute('workspace_agentos_plan',{target:'new-browser'});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.code,'OWNED_BROWSER_UNAVAILABLE');
 }
});
test('SYSTEM session and status transport failure cannot claim an owned browser',async()=>{
 let probeCalls=0;
 const noOwner=createWorkspaceController({platform:'win32',ownerSession:async()=>false,
  browserProbe:async()=>{probeCalls++;return {ok:true,available:true,enabled:true}}});
 const result=await noOwner.execute('workspace_agentos_plan',{target:'new-browser'});
 assert.equal(result.code,'OWNED_BROWSER_UNAVAILABLE');assert.equal(probeCalls,0);
 const fail=createWorkspaceController({platform:'linux',ownerSession:async()=>true,
  browserProbe:async()=>{throw Error('transport')},linuxProbe:async()=>({ready:false})});
 assert.equal((await fail.execute('workspace_agentos_plan',{target:'new-browser'})).code,'OWNED_BROWSER_UNAVAILABLE');
});

test('real Linux AT-SPI helper must reject foreign OS uid before accessibility traversal',async t=>{
 if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()===0){
  t.skip('Requires unprivileged Linux');
  return;
 }
 let owner;
 try{owner=statSync('/proc/1').uid;}catch{t.skip('No procfs');return;}
 if(owner===process.getuid()){t.skip('PID1 not foreign owned');return;}
 let data;
 try{await exec('python3',['tools/native-linux-atspi.py','observe','1','2'],{
  cwd:new URL('..',import.meta.url),timeout:4000,encoding:'utf8'
 }); assert.fail('Foreign UID must not be read');}
 catch(error){data=JSON.parse(String(error.stdout).trim());assert.equal(error.code,4);}
 assert.equal(data.code,'ATSPI_TARGET_OWNER_MISMATCH');
});

test('Linux Portal v2 is detected read-only and never treated as consent',async()=>{
 const {probeLinuxRemoteDesktopPortal}=await import('../src/agentos-linux-portal.mjs');
 const calls=[];
 const result=await probeLinuxRemoteDesktopPortal({platform:'linux',env},{
  uid:1000,runner:async(exe,args)=>{calls.push({exe,args});return {stdout:'(<uint32 2>,)\n'};}
 });
 assert.equal(result.available,true);assert.equal(result.consentGranted,false);
 assert.equal(result.interactionAvailable,false);assert.equal(calls.length,1);
 assert.ok(calls[0].args.includes('org.freedesktop.portal.RemoteDesktop'));
 assert.equal(calls[0].args.includes('Start'),false);
 const controller=createWorkspaceController({platform:'linux',env,ownerSession:async()=>true,
  portalProbe:async()=>result});
 assert.equal((await controller.execute('workspace_linux_portal_status')).available,true);
 assert.equal(workspaceToolDefinitions.find(x=>x.name==='workspace_linux_portal_status').annotations.readOnlyHint,true);
});
test('Linux Portal fails closed on absence of owner, v1, error and forged output',async()=>{
 const {probeLinuxRemoteDesktopPortal}=await import('../src/agentos-linux-portal.mjs');
 const good={platform:'linux',env};
 const runner=async(_program,_args)=>({stdout:'(<uint32 1>,)'});
 assert.equal((await probeLinuxRemoteDesktopPortal(good,{uid:1000,runner})).available,false);
 assert.equal((await probeLinuxRemoteDesktopPortal(good,{uid:1001,runner})).code,'PORTAL_OWNER_SESSION_REQUIRED');
 assert.equal((await probeLinuxRemoteDesktopPortal(good,{uid:1000,runner:async()=>({stdout:'garbage'})})).code,'PORTAL_INVALID_RESPONSE');
 assert.equal((await probeLinuxRemoteDesktopPortal(good,{uid:1000,runner:async()=>{throw Error('not present')}})).code,'PORTAL_DBUS_UNAVAILABLE');
 const c=createWorkspaceController({platform:'linux',env,ownerSession:async()=>false,portalProbe:async()=>{throw Error('must not call')}});
 assert.equal((await c.execute('workspace_linux_portal_status')).code,'PORTAL_OWNER_SESSION_REQUIRED');
});
