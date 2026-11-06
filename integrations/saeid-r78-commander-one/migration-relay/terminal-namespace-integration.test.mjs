// Imports only the exact private fixture app already used in LOOPBACK B.
// Invalid config must reject before resolving cwd or spawning any child.
import test from 'node:test';import assert from 'node:assert/strict';
import {startTerminal} from './witness-private-e67e0d78-a73f-4895-865f-ae11ced1a1df/candidate/app/src/power-tools-v0.3.mjs';
test('integrated start_terminal rejects malformed namespace before cwd or child effect',async()=>{
 for(const terminalNamespace of ['',null,42,'../old','a'.repeat(65)]){
  const ctx={config:{powerMode:{enabled:true,allowShell:true,allowProcessControl:true,terminalNamespace}},roots:[]};
  await assert.rejects(startTerminal(ctx,{cwd:'G:/NONEXISTENT_PRIVATE_QA_NEVER_CREATED'}),/TERMINAL_NAMESPACE_INVALID/);
 }
});
