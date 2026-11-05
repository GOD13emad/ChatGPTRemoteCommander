import test from 'node:test';
import assert from 'node:assert/strict';
import {collectV2InstallCollisionInventory,assessV2InstallCollision} from '../tools/v2-install-collision-inventory.mjs';

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

test('KDE application scope and escaped autostart V2 preview are included, unrelated app scope excluded',()=>{
 const exec=(bin,args)=>{
  if(bin==='dpkg-query')return '';
  if(args.includes('list-unit-files'))return '';
  if(args.includes('list-units'))return [
   'app-com.commanderv2.workspace.preview-9718.scope loaded active running GUI preview',
   'app-commander\\x2dv2\\x2dworkspace\\x2dpreview@7c2499ed601a4038bbe7929d93367293.service loaded active running GUI preview',
   'app-unrelated-secret@123.service loaded active running password=SECRET',
   'chatgpt-remote-commander.service loaded active running V1'
  ].join('\n');
  throw Error('UNEXPECTED');
 };
 const inv=collectV2InstallCollisionInventory({platform:'linux',home:'/tmp',
  exec,observedAt:time,includeLocations:false});
 assert.equal(inv.completeness,'OBSERVED');
 assert.ok(inv.activeUnits.items.some(x=>x.name==='app-com.commanderv2.workspace.preview-9718.scope'));
 assert.ok(inv.activeUnits.items.some(x=>x.name.includes('commander\\x2dv2')));
 assert.ok(!JSON.stringify(inv).includes('password=SECRET'));
 assert.ok(!inv.activeUnits.items.some(x=>x.name.startsWith('app-unrelated')));
 const verdict=assessV2InstallCollision(inv);
 assert.equal(verdict.status,'BLOCKED_OWNER_MIGRATION_PROOF_REQUIRED');
 assert.equal(verdict.canInstall,false);
 assert.ok(verdict.reasons.includes('ACTIVE_V2_DESKTOP_PREVIEW'));
 assert.ok(verdict.reasons.includes('ACTIVE_V1_OR_OWNER_UNIT'));
});
test('Windows three installed identities cannot silently upgrade one-install',()=>{
 const exec=(bin,args)=>{
  if(bin!=='pwsh')throw Error('UNEXPECTED');
  const body=args[4];
  if(body.includes('Get-ItemProperty'))return JSON.stringify([
    {DisplayName:'Commander V2 Workspace Preview',DisplayVersion:'2.1.49',PSChildName:'qa-preview'},
    {DisplayName:'Remote Commander',DisplayVersion:'0.10.26',PSChildName:'old-core'},
    {DisplayName:'Remote Commander Browser',DisplayVersion:'0.9.0',PSChildName:'old-browser'}
  ]);
  if(body.includes('Get-ScheduledTask'))return JSON.stringify([
    {TaskName:'CommanderV2-ComputeOnly-LocalQueue-QA',State:'Ready'},
    {TaskName:'ChatGPTRemoteCommander-V2-OwnerSeat',State:'Running'}
  ]);
  if(body.includes('Get-Process'))return '[]';
  throw Error('UNEXPECTED');
 };
 const inv=collectV2InstallCollisionInventory({platform:'win32',
  home:'C:\\Users\\QA',exec,observedAt:time});
 const result=assessV2InstallCollision(inv);
 assert.deepEqual(result.reasons,[
  'ACTIVE_OWNER_SERVICE_TASK','EXACT_INSTALLER_AND_IDENTITY_CUTOVER_UNVERIFIED',
  'EXISTING_BROWSER_REGISTRATION','EXISTING_V1_REGISTRATION',
  'EXISTING_V2_REGISTRATION','HEADLESS_COMPUTE_QUEUE_PRESENT',
  'OWNER_BACKUP_AND_ROLLBACK_UNVERIFIED']);
 assert.equal(result.canInstall,false);
 assert.equal(result.canUninstall,false);
 assert.equal(result.oneInstallAccepted,false);
 assert.equal(result.mayAlterExistingProfiles,false);
});
test('missing discovery and forged inventory digests fail closed before any cutover',()=>{
 const exec=()=>{throw Error('PROVIDER_DENIED_SECRETS')};
 const i=collectV2InstallCollisionInventory({platform:'linux',home:'/tmp',
  includeLocations:false,exec,observedAt:time});
 const blocked=assessV2InstallCollision(i);
 assert.equal(blocked.status,'BLOCKED_INSTALL_INVENTORY_INCOMPLETE');
 assert.ok(blocked.reasons.includes('INSTALL_DISCOVERY_INCOMPLETE'));
 assert.equal(blocked.canInstall,false);
 const changed={...i,packages:{status:'OBSERVED',items:[]}};
 assert.throws(()=>assessV2InstallCollision(changed),/OBSERVATION_CHANGED/);
 assert.throws(()=>assessV2InstallCollision({schema:1}),/SCHEMA_INVALID/);
});
test('no visible collision is NOT permission to replace user profiles or skip rollback',()=>{
 const exec=(bin,args)=>'';
 const i=collectV2InstallCollisionInventory({platform:'linux',home:'/tmp',
  includeLocations:false,exec,observedAt:time});
 const decision=assessV2InstallCollision(i);
 assert.equal(decision.reasons.includes('OWNER_BACKUP_AND_ROLLBACK_UNVERIFIED'),true);
 assert.equal(decision.canInstall,false);
 assert.equal(decision.installedReplacementAccepted,false);
});
