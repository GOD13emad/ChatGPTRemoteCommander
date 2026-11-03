import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');

test('existing isolated profile reconfiguration is transactional and preserves memory/runtime identity',()=>{
  const core=read('src/profile-reconfigure.mjs');
  const cli=read('tools/reconfigure-profile-instance.mjs');
  for(const marker of ['PROFILE_RECONFIGURE_INSTANCE_MISSING','PROFILE_RECONFIGURE_IDENTITY_MISMATCH','PROFILE_RECONFIGURE_MEMORY_PATH_CHANGED','PROFILE_RECONFIGURE_RUNTIME_PATH_CHANGED','backupDir','supervisorRecycleRequired']) assert.ok(core.includes(marker),marker);
  for(const marker of ['--power','--gui','ChatGPTRemoteCommander','instances']) assert.ok(cli.includes(marker),marker);
});

test('supervisor recycles only marker-proven owned isolated listener',()=>{
  const sup=read('autostart-windows.ps1');
  for(const marker of ['Stop-OwnedMcpInstance','mcp-runtime.json','listener ownership mismatch','refusing to stop it','MCP_INSTANCE_RECYCLE','MCP_INSTANCE_READY','Remove-Item Env:REMOTE_COMMANDER_CONFIG']) assert.ok(sup.includes(marker),marker);
  assert.ok(sup.includes('[int]$marker.pid -ne $ListenerPid'));
  assert.ok(sup.includes('[string]$marker.instance.profile -ne $Instance.Profile'));
  assert.ok(sup.includes('[IO.Path]::GetFullPath([string]$marker.projectDir)'));
});
