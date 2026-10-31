import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const handoff=fs.readFileSync(path.join(root,'handoff-user-session-windows.ps1'),'utf8');
test('handoff never classifies unavailable RPC status as idle before SYSTEM shutdown',()=>{
 assert.match(handoff,/known=\$true;active=\$active;leases=\$leases/);
 assert.match(handoff,/known=\$false;active=-1;leases=-1/);
 assert.match(handoff,/if\(-not \$busy\.known -or \$busy\.active -ne 0 -or \$busy\.leases -ne 0\)/);
 assert.ok(handoff.indexOf('HANDOFF_DEFERRED_BUSY')<handoff.indexOf("Stop-ExactProcess $p 'boot-supervisor'"));
});
test('PowerShell AST isolated function test for missing, malformed, idle, busy and negative status',{
 skip:process.platform!=='win32'?'PowerShell fixture on Windows only':false
},()=>{
 const child=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',
  path.join(root,'test','windows-handoff-status-fixture.ps1')],{
  cwd:root,encoding:'utf8',timeout:12000,maxBuffer:50000,windowsHide:true
 });
 assert.equal(child.status,0,child.stderr||child.stdout);
 assert.match(child.stdout,/HANDOFF_IDLE_GUARD_PASS/);
});
