import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file='gnome-extension/chatgpt-remote-commander@god13emad/extension.js';
const s=fs.readFileSync(file,'utf8');

test('GNOME X11 backend is observe-only and never constructs synthetic input there',()=>{
  assert.match(s,/import Meta from 'gi:\/\/Meta';/);
  assert.match(s,/this\._wayland = Meta\.is_wayland_compositor\(\);/);
  assert.match(s,/if \(this\._wayland\) \{[\s\S]*create_virtual_device\(Clutter\.InputDeviceType\.POINTER_DEVICE\)[\s\S]*create_virtual_device\(Clutter\.InputDeviceType\.KEYBOARD_DEVICE\)/);
  assert.match(s,/backend:this\._wayland \? 'gnome-shell-wayland' : 'gnome-shell-x11-observe-only'/);
  assert.match(s,/sessionType:this\._wayland \? 'wayland' : 'x11'/);
  assert.match(s,/GUI_SYNTHETIC_INPUT_UNAVAILABLE_X11/);
});

test('focus remains available before synthetic-input refusal and teardown drops devices',()=>{
  const focus=s.indexOf("if (action === 'focusWindow')");
  const guard=s.indexOf("GUI_SYNTHETIC_INPUT_UNAVAILABLE_X11");
  assert.ok(focus>0 && guard>focus,'focus must precede X11 synthetic-input refusal');
  assert.match(s,/destroy\(\) \{[\s\S]*this\._destroyed = true;[\s\S]*this\._pointer = null;[\s\S]*this\._keyboard = null;/);
  assert.match(s,/disable\(\) \{[\s\S]*this\._dbus\?\.unexport\(\);[\s\S]*this\._service\?\.destroy\(\);/);
});
