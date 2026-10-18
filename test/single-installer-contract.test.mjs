import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('single Windows installer exposes one product shell with two installation modes',()=>{
  const iss=read('installer/RemoteCommander.iss');

  assert.ok(iss.includes('AppName=Remote Commander'));
  assert.ok(iss.includes('PrivilegesRequired=lowest'),'setup must stay in the original user context');
  assert.equal(iss.includes('PrivilegesRequired=admin'),false);
  assert.ok(iss.includes('Name: "core"; Description: "Commander Core"'));
  assert.ok(iss.includes('Name: "complete"; Description: "Commander + Control && Monitoring"'));
  assert.ok(iss.includes('Name: "controlmonitor"; Description: "Control && Monitoring panel"'));

  const publicCommanderIcons=[...iss.matchAll(/Name:\s*"\{group\}\\Remote Commander"/g)];
  assert.equal(publicCommanderIcons.length,1,'installer must publish one Commander Start Menu icon');

  for(const legacy of [
    'Remote Commander Profiles & Access.lnk',
    'Remote Commander Operations Monitor.lnk',
    'Remote Commander Admin Runtime.lnk'
  ]) {
    assert.ok(iss.includes(legacy),'installer must clean legacy shortcut '+legacy);
    assert.equal(iss.includes('Name: "{group}\\'+legacy.replace(/\.lnk$/,'')+'"'),false,
      'internal tool must not be published as a Start Menu application');
  }

  assert.ok(iss.includes('profile-manager-windows.ps1'));
  assert.ok(iss.includes('profile-enrollment-windows.ps1'));
  assert.ok(iss.includes('Components: controlmonitor'));
  assert.ok(iss.includes('operations-monitor-windows.ps1'));
  assert.ok(iss.includes('admin-runtime-windows.ps1'));
});

test('fresh Windows bootstrap elevates only machine prerequisites and returns to user context for core',()=>{
  const iss=read('installer/RemoteCommander.iss');
  const server=read('server-install-windows.ps1');
  const install=read('install.ps1');

  assert.ok(iss.includes("ShellExec('runas'"),'machine prerequisite boundary must explicitly elevate');
  assert.ok(iss.includes('-PrerequisitesOnly'));
  assert.ok(iss.includes("Exec(PwshPath, Params"),'per-user core install must use the non-elevated setup context');
  assert.ok(iss.includes('-StartServer -SourceRef'));
  assert.ok(iss.includes('PowerShell-7.6.6-win-x64.msi'));
  assert.ok(iss.includes('958838FF55091E1C8705D89EFED0CC7E8245A3A6EF6C0CCFAE20015227108AD8'));

  assert.ok(server.includes('[switch]$PrerequisitesOnly'));
  assert.ok(server.includes("SERVER_PREREQUISITES_PASS"));
  assert.ok(server.includes("[ValidateSet('Power','Standard')][string]$AccessMode = 'Power'"));
  assert.ok(server.includes("if ($AccessMode -eq 'Power') { $args += '-PowerMode' } else { $args += '-StandardMode' }"));

  const requireIndex=install.indexOf('Require-Windows');
  const refreshIndex=install.indexOf('Refresh-Path',requireIndex);
  const prereqIndex=install.indexOf('Ensure-Prerequisites',refreshIndex);
  assert.ok(requireIndex>=0 && refreshIndex>requireIndex && prereqIndex>refreshIndex,
    'freshly installed machine prerequisites must be visible before prerequisite validation');
});

test('native setup preserves explicitly authorized Full Power on reinstall and defaults new installs to Standard', async()=>{
  const iss=read('installer/RemoteCommander.iss');
  const coreStart=iss.indexOf('CoreScript := ExpandConstant');
  const execute=iss.indexOf('if not Exec(PwshPath, Params',coreStart);
  assert.ok(coreStart>=0 && execute>coreStart);
  const coreParams=iss.slice(coreStart,execute);
  assert.ok(coreParams.includes('-StartServer -SourceRef "{#MySourceRef}" -ExpectedCommit "{#MyCommit}"'));
  for(const forbidden of ['-StandardMode','-PowerMode','-GuiControl','-DisableGuiControl'])
    assert.ok(!coreParams.includes("' "+forbidden),'setup must not implicitly change existing capability authority: '+forbidden);
  const {migrateCapabilityConfig}=await import('../src/capability-profile.mjs');
  const defaults=JSON.parse(read('config.json'));
  const fresh=migrateCapabilityConfig({defaultConfig:defaults,existingConfig:null});
  assert.equal(fresh.profile.tier,'STANDARD','new wizard installation still uses Standard');
  assert.equal(fresh.config.powerMode.enabled,false);
  const explicitlyFull=migrateCapabilityConfig({defaultConfig:defaults,existingConfig:null,requestPower:true,requestGui:true});
  assert.equal(explicitlyFull.profile.tier,'FULL_POWER');
  const upgrade=migrateCapabilityConfig({defaultConfig:defaults,existingConfig:explicitlyFull.config});
  assert.equal(upgrade.profile.tier,'FULL_POWER','native reinstall must preserve owner Full Power');
  assert.equal(upgrade.config.powerMode.guiControl.enabled,true);
  const deliberate=migrateCapabilityConfig({defaultConfig:defaults,existingConfig:explicitlyFull.config,requestStandard:true});
  assert.equal(deliberate.profile.tier,'STANDARD','explicit -StandardMode remains a deliberate downgrade');
});

test('installer collects only profile names; credentials are collected after install and passed in memory',()=>{
  const iss=read('installer/RemoteCommander.iss');
  const enrollment=read('desktop/profile-enrollment-windows.ps1');
  const autostart=read('enable-autostart.ps1');

  assert.ok(iss.includes('Profiles (semicolon-separated):'));
  assert.ok(iss.includes('requested-profiles.txt'));
  assert.equal(iss.includes("ProfilePage.Add('Runtime API key"),false);
  assert.equal(iss.includes("ProfilePage.Add('OpenAI tunnel_id"),false);

  assert.ok(autostart.includes('[Security.SecureString]$RuntimeApiKey'));
  assert.ok(autostart.includes('if ($RuntimeApiKey)'));
  assert.ok(enrollment.includes('ConvertTo-SecureString $key.Text -AsPlainText -Force'));
  assert.ok(enrollment.includes('& $Enroll -Profile $n -TunnelId $tid -RuntimeApiKey $secure'));
  assert.equal(enrollment.includes('Start-Process') && enrollment.includes('RuntimeApiKey'),false,
    'runtime API key must never be placed in a child-process command line');
  assert.ok(enrollment.includes('profile-enrollment-windows.ps1')===false,
    'profile setup must not recursively relaunch itself');
});

test('release setup clean guard rejects staged, untracked and substantive drift but tolerates EOL-only checkout normalization',()=>{
  const builder=read('installer/build-setup.ps1');
  const workflow=read('.github/workflows/release-sync.yml');
  assert.ok(builder.includes('ls-files --others --exclude-standard'));
  assert.ok(builder.includes('diff --cached --quiet --'));
  assert.ok(builder.includes('diff --ignore-space-at-eol --exit-code --'));
  assert.ok(builder.includes('Setup release build refuses untracked files'));
  assert.ok(builder.includes('Setup release build refuses staged tracked changes'));
  assert.ok(builder.includes('Setup release build refuses substantive unstaged tracked changes'));
  assert.ok(builder.includes('SETUP_TRACKED_EOL_DRIFT_ACCEPTED'));
  assert.ok(!workflow.includes('-AllowDirty'),'hosted Release Sync must not bypass the clean-worktree guard');
});

test('browser component is compile-time optional until a standalone Browser installer is supplied',()=>{
  const iss=read('installer/RemoteCommander.iss');
  assert.ok(iss.includes('#ifdef BrowserSetup'));
  assert.ok(iss.includes('#define BrowserSetupName ExtractFileName(BrowserSetup)'));
  assert.ok(iss.includes('Name: "browser"; Description: "Remote Commander Browser"'));
  assert.ok(iss.includes('Source: "{#BrowserSetup}"; DestName: "{#BrowserSetupName}"'));
  assert.ok(iss.includes('Filename: "{tmp}\\{#BrowserSetupName}"'));
});

test('product icon is a standards-compliant multi-image ICO asset',()=>{
  const p=path.join(root,'desktop','RemoteCommanderDashboard','remote-commander.ico');
  const b=fs.readFileSync(p);
  assert.ok(b.length>1000);
  assert.deepEqual([...b.subarray(0,4)],[0,0,1,0]);
  const count=b.readUInt16LE(4);
  assert.ok(count>=4,'ICO should contain multiple display sizes');
});
