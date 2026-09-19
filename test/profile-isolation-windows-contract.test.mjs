import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
test('Windows profile isolation scripts preserve secret split and rollback boundaries',()=>{
  const sup=read('autostart-windows.ps1');
  const mig=read('configure-profile-instance.ps1');
  const conn=read('connect-chatgpt-account.ps1');
  const cfg=read('configure-durable-workflows.ps1');
  for(const marker of ['ChatGPTRemoteCommander\\instances','REMOTE_COMMANDER_CONFIG','instance config hash mismatch','refusing to stop it','MCP_INSTANCE_READY','$SelfTest']){
    assert.ok(sup.includes(marker),marker);
  }
  for(const marker of ['Existing DPAPI Runtime API credential is required','doctor-profile','CONTROL_PLANE_API_KEY','profile-before-','Profile backup hash mismatch','PROFILE_INSTANCE_MIGRATION_PASS','Stop-IsolatedMcp']){
    assert.ok(mig.includes(marker),marker);
  }
  assert.equal(mig.includes('OPENAI_ADMIN_KEY'),false);
  assert.equal(mig.includes('OPENAI_API_KEY'),false);
  assert.ok(conn.includes('[switch]$Isolate'));
  assert.ok(conn.includes('configure-profile-instance.ps1'));
  assert.ok(cfg.includes('config.local.workflows-'));
  assert.ok(cfg.includes('Restart/recycle the MCP server deliberately'));
});

test('profile instance state is local-only and not tracked by repository config',()=>{
  const ignore=read('.gitignore');
  assert.ok(ignore.includes('config.local.json'));
  const server=read('src/server-v0.3.mjs');
  assert.ok(server.includes('config.runtimeState'));
  assert.ok(server.includes("instance: config.instance ?? { profile: 'default', isolated: false }"));
});
