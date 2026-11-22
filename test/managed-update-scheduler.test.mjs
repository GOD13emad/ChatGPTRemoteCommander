import test from 'node:test';
import assert from 'node:assert/strict';
import {linuxUnitFiles}
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
 assert.doesNotMatch(s.service,/--apply|--attested-gui-approval|pkexec|sudo/);
 assert.throws(()=>linuxUnitFiles({nodeBinary:'/usr/bin/node',
   ghBinary:'/usr/bin/gh',runner:'/tmp/unsafe\nExecStart=/bin/sh'}),/UNSAFE_PATH/);
});
