import test from 'node:test';
import assert from 'node:assert/strict';
import {collectV2InstallCollisionInventory} from '../tools/v2-install-collision-inventory.mjs';

const time='2026-11-05T01:00:00.000Z';
test('Linux native read-only inventory reports relevant units without paths or credentials',()=>{
 const calls=[];
 const exec=(bin,args)=>{
  calls.push({bin,args});
  if(bin==='dpkg-query')return 'unrelated-package 1.2\ncommander-v2 2.1.50\n';
  if(args.includes('list-unit-files'))return 'chatgpt-remote-commander-emad-mmz.service enabled enabled\ncommander-transfer-mesh.service enabled enabled\nmalicious-agent.service enabled enabled\n';
  if(args.includes('list-units'))return 'chatgpt-remote-commander-emad-mmz.service loaded active running malicious command: secret=abc\ncommander-transfer-mesh.service loaded inactive dead\n';
  throw Error('BAD_EXEC');
 };
 const out=collectV2InstallCollisionInventory({platform:'linux',home:'/tmp',exec,observedAt:time,includeLocations:false});
 assert.equal(out.completeness,'OBSERVED');
 assert.equal(out.cutoverAuthorized,false);
 assert.equal(out.installedReplacementAccepted,false);
 assert.deepEqual(out.packages.items,[{name:'commander-v2',version:'2.1.50'}]);
 assert.equal(out.unitFiles.items.length,2);
 assert.deepEqual(out.activeUnits.items[0],{name:'chatgpt-remote-commander-emad-mmz.service',active:'active',substate:'running'});
 assert.equal(JSON.stringify(out).includes('secret=abc'),false);
 assert.equal(calls.length,3);
 assert.ok(calls.every(c=>['dpkg-query','systemctl'].includes(c.bin)));
});
test('Windows native registry/task/process inventory contains only whitelisted identity fields',()=>{
 const exec=(bin,args)=>{
  assert.equal(bin,'pwsh');
  assert.deepEqual(args.slice(0,3),['-NoLogo','-NoProfile','-NonInteractive']);
  const script=args[4];
  if(script.includes('Get-ItemProperty'))return JSON.stringify([
    {DisplayName:'Remote Commander',DisplayVersion:'0.10.26',Publisher:'TandemVector Labs',PSChildName:'RemoteCommander',UninstallString:'SENSITIVE_UNINSTALL_SENTINEL'},
    {DisplayName:'Commander V2 Workspace Preview',DisplayVersion:'2.1.49',Publisher:'Chat On Steroids',PSChildName:'preview-guid',InstallLocation:'PRIVATE_PATH'},
    {DisplayName:'Unrelated Software',DisplayVersion:'1',PSChildName:'unrelated'}
  ]);
  if(script.includes('Get-ScheduledTask'))return JSON.stringify([
    {TaskName:'ChatGPTRemoteCommander-V2-OwnerSeat',State:'Running',Action:'CREDENTIAL'},
    {TaskName:'UnrelatedTask',State:'Ready'}
  ]);
  if(script.includes('Get-Process'))return JSON.stringify([{ProcessName:'Commander',Id:123,CommandLine:'TOKEN'},{ProcessName:'explorer',Id:456}]);
  throw Error('UNEXPECTED_SCRIPT');
 };
 const out=collectV2InstallCollisionInventory({platform:'win32',home:'C:\\Users\\QA',exec,observedAt:time});
 assert.equal(out.completeness,'OBSERVED');
 assert.equal(out.apps.items.length,2);
 assert.equal(out.tasks.items.length,1);
 assert.deepEqual(out.processes.items,[{name:'Commander'}]);
 for(const secret of ['SENSITIVE_UNINSTALL_SENTINEL','PRIVATE_PATH','CREDENTIAL','TOKEN'])assert.equal(JSON.stringify(out).includes(secret),false);
 assert.equal(out.cutoverAuthorized,false);
});
test('failed discovery is UNKNOWN, not evidence of absence or permission',()=>{
 const out=collectV2InstallCollisionInventory({platform:'linux',home:'/tmp',includeLocations:false,observedAt:time,
  exec:()=>{throw Error('permission denied with secret data');}});
 assert.equal(out.completeness,'INCOMPLETE');
 assert.equal(out.packages.status,'UNKNOWN');
 assert.deepEqual(out.activeUnits.items,[]);
 assert.equal(JSON.stringify(out).includes('permission denied'),false);
 assert.equal(out.cutoverAuthorized,false);
});
test('rejects unsupported platform and avoids running any executable',()=>{
 let executed=false;
 assert.throws(()=>collectV2InstallCollisionInventory({platform:'darwin',home:'/tmp',exec:()=>{executed=true;}}),/INVALID_ARGUMENT/);
 assert.equal(executed,false);
});
test('inventory observation digest is deterministic for unchanged native state',()=>{
 const exec=(bin,args)=>bin==='dpkg-query'?'':args.includes('list-units')?'chatgpt-remote-commander.service loaded active running\n':'chatgpt-remote-commander.service enabled enabled\n';
 const opts={platform:'linux',home:'/tmp',includeLocations:false,observedAt:time,exec};
 const a=collectV2InstallCollisionInventory(opts),b=collectV2InstallCollisionInventory({...opts,observedAt:'2026-11-05T02:00:00.000Z'});
 assert.equal(a.observationDigest,b.observationDigest);
});
