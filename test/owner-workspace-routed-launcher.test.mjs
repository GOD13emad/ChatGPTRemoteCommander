import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const script=fs.readFileSync(path.join(import.meta.dirname,'..','tools','launch-owner-workspace-routed.ps1'),'utf8');
const broker=fs.readFileSync(path.join(import.meta.dirname,'..','tools','workspace-owner-broker.mjs'),'utf8');
test('owner launcher selects only canonical routed release with no user-specific checkout path',()=>{
 assert.match(script,/routing/);
 assert.match(script,/route\.active\.projectDir/);
 assert.match(script,/workspace-owner-broker\.mjs/);
 assert.match(script,/OWNER_RELEASE_OUTSIDE_ROUTED_ROOT/);
 assert.match(script,/OWNER_ROUTE_CONFIG_HASH_MISMATCH/);
 assert.match(script,/OWNER_INTERACTIVE_SESSION_REQUIRED/);
 assert.match(script,/PreflightOnly/);
 assert.doesNotMatch(script,/[A-Za-z]:\\Users\\/);
 assert.doesNotMatch(script,/source\\repos|safe\.directory|Start-Process.*powershell.*RunAs/i);
});
test('owner launch does not stop existing native GUI or bypass OS approvals',()=>{
 assert.match(script,/OWNER_CUA_INSTANCE_ALREADY_RUNNING_NO_RESTART/);
 assert.match(script,/OWNER_WORKSPACE_BROKER_ALREADY_RUNNING_NO_RESTART/);
 assert.match(script,/--permission-mode','standard'/);
 assert.match(script,/--grant','existing-profile'/);
 assert.doesNotMatch(script,/--dangerously-bypass-approvals|unrestricted|bypassExecutionPolicy/i);
 assert.doesNotMatch(script,/Stop-Process -Id \$existing/);
 assert.match(script,/if\(\$driver -and -not \$driver\.HasExited\)/);
});
test('owned broker requires account, Session >0, authenticated loopback and exact tool schema',()=>{
 assert.match(broker,/SESSION0_FORBIDDEN/);
 assert.match(broker,/INTERACTIVE_OWNER_REQUIRED/);
 assert.match(broker,/DEDICATED_CUA_PIPE_REQUIRED/);
 assert.match(broker,/timingSafeEqual/);
 assert.match(broker,/validateJsonSchema/);
 assert.match(broker,/allowKeyboard:true,allowWindowFocus:false/);
 assert.match(broker,/rpcId=body\.id/);
 assert.match(broker,/error\(rpcId,-32012/);
 assert.doesNotMatch(broker,/permission-mode unrestricted|global SendInput/i);
});
