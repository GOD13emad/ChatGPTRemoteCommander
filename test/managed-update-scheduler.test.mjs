import test from 'node:test';
import assert from 'node:assert/strict';
import {linuxUnitFiles,deployManagedUpdaterSources}
  from '../tools/universal-install/managed-update-scheduler.mjs';

test('universal scheduler runs only the user-local signed staging command',()=>{
 const s=linuxUnitFiles({nodeBinary:'/usr/bin/node',
   ghBinary:'/usr/bin/gh',
   runner:'/home/owner/.local/lib/ChatGPTRemoteCommander/native-auto-updater/managed-updates.mjs'});
 assert.match(s.service,/^ExecStart=\/usr\/bin\/node .* --stage$/m);
 assert.match(s.service,/NoNewPrivileges=true/);
 assert.match(s.service,/ProtectSystem=full/);
 assert.match(s.timer,/OnUnitActiveSec=6h/);
 assert.match(s.timer,/Persistent=true/);
 assert.ok(s.timer.split('\n').includes('OnCalendar=*-*-* 00/6:00:00'), 'persistent calendar fallback must remain schedulable after lost monotonic state');
 assert.doesNotMatch(s.service,/--apply|--attested-gui-approval|pkexec|sudo/);
 assert.throws(()=>linuxUnitFiles({nodeBinary:'/usr/bin/node',
   ghBinary:'/usr/bin/gh',runner:'/tmp/unsafe\nExecStart=/bin/sh'}),/UNSAFE_PATH/);
});

test('one cross-platform source refresh is atomic, rerunnable and retains one previous',async()=>{
 const fs=await import('node:fs');
 const os=await import('node:os');
 const path=await import('node:path');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-autosource-'));
 const source=path.join(tmp,'reviewed'),destination=path.join(tmp,'deployed');
 fs.mkdirSync(source,{mode:0o700});
 try{
   const names=['managed-updates.mjs','signed-native-provenance.mjs','release-admission-0.12.mjs'];
   for(const name of names)fs.writeFileSync(path.join(source,name),'initial-safe-source:'.repeat(15),
     {mode:0o600});
   const runner=deployManagedUpdaterSources({sourceDir:source,destinationDir:destination});
   assert.equal(runner,path.join(destination,'managed-updates.mjs'));
   assert.equal(deployManagedUpdaterSources({sourceDir:source,destinationDir:destination}),runner);
   assert.equal(fs.existsSync(path.join(destination,'managed-updates.mjs.previous')),false);
   fs.writeFileSync(path.join(source,'managed-updates.mjs'),
     'revised-safe-source:'.repeat(15),{flag:'w',mode:0o600});
   deployManagedUpdaterSources({sourceDir:source,destinationDir:destination});
   assert.equal(fs.readFileSync(runner,'utf8'),'revised-safe-source:'.repeat(15));
   assert.equal(fs.readFileSync(runner+'.previous','utf8'),'initial-safe-source:'.repeat(15));
   assert.equal(fs.existsSync(path.join(destination,'signed-native-provenance.mjs.previous')),false);
   fs.writeFileSync(path.join(tmp,'non-directory'),'not a directory');
   assert.throws(()=>deployManagedUpdaterSources({
     sourceDir:source,destinationDir:path.join(tmp,'non-directory')}),/ALIAS_DENIED/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
