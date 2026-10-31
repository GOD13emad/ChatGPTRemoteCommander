import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const scriptPath=path.join(root,'autostart-windows.ps1');
const source=readFileSync(scriptPath,'utf8');
test('supervisor accepts only exact full/runtime-only tunnel executable names',()=>{
 assert.match(source,/tunnel-client-runtime\.exe/);
 assert.match(source,/tunnel-client\.exe/);
 assert.match(source,/Get-CimInstance Win32_Process -Filter \("Name='\{0\}'" -f \$processName\)/);
 assert.match(source,/Unsupported tunnel executable name/);
 assert.match(source,/\[IO\.Path\]::GetFullPath\(\[string\]\$_\.ExecutablePath\) -eq \$expected/);
});
test('PowerShell CIM fixture matches exact executable path and profile',{
 skip:process.platform!=='win32'?'Windows-only fixture':false
},()=>{
 const child=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',
  path.join(root,'test','windows-tunnel-runtime-process-fixture.ps1'),scriptPath],{
  cwd:root,encoding:'utf8',timeout:14000,windowsHide:true,maxBuffer:50000
 });
 assert.equal(child.status,0,child.stderr||child.stdout);
 assert.match(child.stdout,/EXACT_RUNTIME_PROCESS_MATCH_PASS/);
});
