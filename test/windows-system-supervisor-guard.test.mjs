import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('..',import.meta.url));
const autostart=path.join(root,'autostart-windows.ps1');
const routing=path.join(root,'supervisor-routing.ps1');
const supervisor=readFileSync(autostart,'utf8');
const routes=readFileSync(routing,'utf8');
const admission=readFileSync(path.join(root,'tools','windows-system-trust-admission.ps1'),'utf8');
const currentUser=process.platform==='win32'
  ?spawnSync('whoami',[],{encoding:'utf8',timeout:4000,windowsHide:true}).stdout.trim().toLowerCase():'';
const isSystem=currentUser==='nt authority\\system';

test('SYSTEM guard runs before runtime initialization and refuses fallback',()=>{
  const gate=supervisor.indexOf("tools\\windows-system-trust-admission.ps1");
  const runtime=supervisor.indexOf("Initialize-WindowsSupervisorRuntime $Root");
  assert.ok(gate>0 && gate<runtime,'trust gate must precede owner-profile environment change');
  assert.match(admission,/SYSTEM_TRUSTED_ROUTE_NOT_READY/);
  assert.match(supervisor,/SYSTEM_PRIMARY_USER_ROUTE_FALLBACK_FORBIDDEN/);
  assert.match(supervisor,/SYSTEM_INSTANCE_USER_ROUTE_FALLBACK_FORBIDDEN/);
  assert.match(admission,/dependencyClosureVerified/);
  assert.match(admission,/releaseAuthorized/);
  assert.match(routes,/SYSTEM_ROUTE_GUARD_MISSING/);
  assert.match(routes,/C:\\ProgramData\\ChatGPTRemoteCommander\\machine-runtime\\routing/);
  assert.match(routes,/SYSTEM_MACHINE_ROUTING_ROOT_MISSING/);
});
test('non-SYSTEM owner routing remains at the existing user location',()=>{
  assert.match(routes,/\$RoutingRoot = Join-Path \$env:LOCALAPPDATA 'ChatGPTRemoteCommander\\routing'/);
  assert.match(routes,/if\(\$script:RcSystemNativeContext -and -not \$SelfTest\)/);
  assert.match(routes,/else\{\s*\$RoutingRoot = Join-Path \$env:LOCALAPPDATA/);
});
test('PowerShell source syntax is valid on Windows', {skip:process.platform!=='win32'},()=>{
  for(const file of [autostart,routing]){
    const command="$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseFile('"+file.replaceAll("'","''")+"',[ref]$tokens,[ref]$errors)|Out-Null;exit @($errors).Count";
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:8000,windowsHide:true});
    assert.equal(result.status,0,result.stderr||result.stdout);
  }
});
test('real SYSTEM BootCore rejects absent trusted machine route before launch', {
  skip:process.platform!=='win32'||!isSystem?'Requires Windows SYSTEM principal':false
},()=>{
  const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',autostart,'-BootCore'],{
    encoding:'utf8',timeout:12000,windowsHide:true
  });
  assert.equal(result.status,1,result.stderr||result.stdout);
  assert.match(result.stderr+result.stdout,/SYSTEM_TRUSTED_ROUTE_NOT_READY/);
  assert.doesNotMatch(result.stderr+result.stdout,/MCP_STARTED|SUPERVISOR_STARTED/);
});
