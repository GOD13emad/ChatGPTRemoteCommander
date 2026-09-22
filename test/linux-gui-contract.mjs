import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const read = p => fs.readFileSync(p,'utf8');
const extension = read('gnome-extension/chatgpt-remote-commander@god13emad/extension.js');
const metadata = JSON.parse(read('gnome-extension/chatgpt-remote-commander@god13emad/metadata.json'));
const helper = read('tools/gui-control-linux.py');
const installer = read('tools/install-gnome-gui-extension.sh');
const controller = read('src/gui-tools-windows.mjs');
const server = read('src/server-v0.3.mjs');
const updater = read('auto-update-linux.sh');

assert.equal(metadata.uuid,'chatgpt-remote-commander@god13emad');
assert.ok(metadata['shell-version'].includes('46'));
for (const marker of [
  'org.gnome.Shell.Extensions.ChatGPTRemoteCommander',
  'Gio.DBusExportedObject.wrapJSObject',
  'create_virtual_device',
  'notify_absolute_motion',
  'notify_relative_motion',
  'notify_button',
  'notify_discrete_scroll',
  'notify_keyval',
  'Shell.Screenshot',
  'screenshot_area',
  '_sameSnapshot',
  'GUI_FOREGROUND_OR_GEOMETRY_CHANGED',
  'GUI_LOCAL_STOP'
]) assert.ok(extension.includes(marker), 'extension missing '+marker);

for (const marker of [
  'gui-extension-token',
  'Gio.DBusProxy.new_for_bus_sync',
  'save_to_bufferv',
  'GUI_GNOME_EXTENSION_UNAVAILABLE',
  '--server',
  '--self-test'
]) assert.ok(helper.includes(marker), 'helper missing '+marker);

for (const marker of [
  'enabled-extensions',
  'GNOME_GUI_EXTENSION_UNCHANGED',
  'GNOME_GUI_EXTENSION_SESSION_RELOAD_REQUIRED',
  'diff -qr -- "$SRC" "$DST"',
  'gnome-extensions disable "$UUID"',
  'wait_bridge',
  'grep -q "interface $BRIDGE_IFACE"',
  'chmod 600 "$TOKEN"'
]) assert.ok(installer.includes(marker), 'installer missing '+marker);

assert.ok(!/(logout|logoff|reboot|shutdown)[ \t]/i.test(installer), 'GUI installer must never force session/system restart');
assert.ok(controller.includes("platform === 'linux'"));
assert.ok(server.includes("process.platform === 'win32' || process.platform === 'linux'"));
assert.ok(updater.includes('install_linux_gui_backend'));
assert.ok(updater.includes('https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest') && updater.includes('%{url_effective}'));

if (process.platform === 'linux') {
  const compile=spawnSync('python3',['-c',"import ast,pathlib; ast.parse(pathlib.Path('tools/gui-control-linux.py').read_text())"],{encoding:'utf8'});
  assert.equal(compile.status,0,compile.stderr);
  const self=spawnSync('python3',['tools/gui-control-linux.py','--self-test'],{encoding:'utf8'});
  assert.equal(self.status,0,self.stderr);
  const parsed=JSON.parse(self.stdout);
  assert.equal(parsed.ok,true);
  const bash=spawnSync('bash',['-n','tools/install-gnome-gui-extension.sh'],{encoding:'utf8'});
  assert.equal(bash.status,0,bash.stderr);

  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-gnome-installer-'));
  try {
    const uuid='chatgpt-remote-commander@god13emad';
    const fakeRoot=path.join(tmp,'root');
    const fakeTools=path.join(fakeRoot,'tools');
    const fakeSrc=path.join(fakeRoot,'gnome-extension',uuid);
    const fakeData=path.join(tmp,'data');
    const fakeDst=path.join(fakeData,'gnome-shell','extensions',uuid);
    const fakeBin=path.join(tmp,'bin');
    const state=path.join(tmp,'bridge-active');
    const calls=path.join(tmp,'calls.log');
    fs.mkdirSync(fakeTools,{recursive:true});
    fs.mkdirSync(fakeSrc,{recursive:true});
    fs.mkdirSync(fakeDst,{recursive:true});
    fs.mkdirSync(fakeBin,{recursive:true});
    fs.copyFileSync('tools/install-gnome-gui-extension.sh',path.join(fakeTools,'install-gnome-gui-extension.sh'));
    fs.writeFileSync(path.join(fakeSrc,'extension.js'),'same-v1\n');
    fs.writeFileSync(path.join(fakeSrc,'metadata.json'),'{}\n');
    fs.copyFileSync(path.join(fakeSrc,'extension.js'),path.join(fakeDst,'extension.js'));
    fs.copyFileSync(path.join(fakeSrc,'metadata.json'),path.join(fakeDst,'metadata.json'));
    fs.writeFileSync(state,'active\n');
    fs.writeFileSync(path.join(fakeBin,'gdbus'),`#!/bin/sh
if [ -f "$GNOME_TEST_STATE" ]; then
  echo "interface org.gnome.Shell.Extensions.ChatGPTRemoteCommander"
  exit 0
fi
exit 1
`);
    fs.writeFileSync(path.join(fakeBin,'gnome-extensions'),`#!/bin/sh
cmd="$1"
case "$cmd" in
  list)
    if [ "$2" = "--active" ] && [ -f "$GNOME_TEST_STATE" ]; then echo "chatgpt-remote-commander@god13emad"; fi
    ;;
  disable)
    echo disable >> "$GNOME_TEST_CALLS"
    rm -f "$GNOME_TEST_STATE"
    ;;
  enable)
    echo enable >> "$GNOME_TEST_CALLS"
    : > "$GNOME_TEST_STATE"
    ;;
esac
exit 0
`);
    fs.chmodSync(path.join(fakeBin,'gdbus'),0o755);
    fs.chmodSync(path.join(fakeBin,'gnome-extensions'),0o755);
    const env={
      ...process.env,
      PATH:`${fakeBin}:${process.env.PATH}`,
      HOME:tmp,
      XDG_CURRENT_DESKTOP:'GNOME',
      XDG_DATA_HOME:fakeData,
      XDG_CONFIG_HOME:path.join(tmp,'config'),
      GSETTINGS_BACKEND:'memory',
      GNOME_TEST_STATE:state,
      GNOME_TEST_CALLS:calls
    };

    const inodeBefore=fs.statSync(fakeDst).ino;
    let run=spawnSync('bash',[path.join(fakeTools,'install-gnome-gui-extension.sh')],{encoding:'utf8',env});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/GNOME_GUI_EXTENSION_UNCHANGED/);
    assert.match(run.stdout,/GNOME_GUI_EXTENSION_ACTIVE changed=false/);
    assert.equal(fs.statSync(fakeDst).ino,inodeBefore,'byte-identical extension tree must not be replaced');
    assert.ok(!fs.existsSync(calls) || !fs.readFileSync(calls,'utf8').includes('disable'),'unchanged active extension must not be disabled');

    fs.writeFileSync(path.join(fakeSrc,'extension.js'),'changed-v2\n');
    fs.writeFileSync(calls,'');
    fs.writeFileSync(state,'active\n');
    run=spawnSync('bash',[path.join(fakeTools,'install-gnome-gui-extension.sh')],{encoding:'utf8',env});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/GNOME_GUI_EXTENSION_INSTALLED/);
    assert.match(run.stdout,/GNOME_GUI_EXTENSION_ACTIVE changed=true/);
    assert.equal(fs.readFileSync(path.join(fakeDst,'extension.js'),'utf8'),'changed-v2\n');
    assert.deepEqual(fs.readFileSync(calls,'utf8').trim().split(/\r?\n/),['disable','enable']);
  } finally {
    fs.rmSync(tmp,{recursive:true,force:true});
  }
}
console.log('LINUX_GUI_CONTRACT_PASS');
