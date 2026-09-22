import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  'GNOME_GUI_EXTENSION_SESSION_RELOAD_REQUIRED',
  'grep -q \'interface org.gnome.Shell.Extensions.ChatGPTRemoteCommander\'',
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
}
console.log('LINUX_GUI_CONTRACT_PASS');
