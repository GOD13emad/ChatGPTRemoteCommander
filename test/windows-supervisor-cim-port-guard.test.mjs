import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Windows supervisor never assumes an empty -State Listen filter means a free port',()=>{
  const body=read('autostart-windows.ps1');
  assert.doesNotMatch(body,/Get-NetTCPConnection\s+-State\s+Listen\s+-LocalPort/i);
  assert.match(body,/Get-NetTCPConnection\s+-LocalPort\s+\$Instance\.Port\s+-ErrorAction\s+SilentlyContinue/i);
  assert.match(body,/instance listener ownership mismatch/);
  assert.match(body,/refusing to stop it/);
  assert.match(body,/Test-McpHealth\s+\$Instance\.Port/);
});

test('Windows enrollment probes occupied ports without CIM State enum filtering',()=>{
  const body=read('enable-autostart.ps1');
  assert.doesNotMatch(body,/Get-NetTCPConnection\s+-State\s+Listen\s+-LocalPort/i);
  assert.match(body,/Get-NetTCPConnection\s+-LocalPort\s+\$candidate\s+-ErrorAction\s+SilentlyContinue/i);
  assert.match(body,/Get-NetTCPConnection\s+-LocalPort\s+47831\s+-ErrorAction\s+SilentlyContinue/i);
  assert.match(body,/Refusing to stop an unknown process/);
});
