#!/usr/bin/env node
import fs from 'node:fs';

const file='gnome-extension/chatgpt-remote-commander@god13emad/extension.js';
let s=fs.readFileSync(file,'utf8');
const replaceOnce=(oldText,newText,label)=>{
  const n=s.split(oldText).length-1;
  if(n!==1) throw new Error(`${label}_COUNT_${n}`);
  s=s.replace(oldText,newText);
};

if(!s.includes("import Meta from 'gi://Meta';")){
  replaceOnce("import Clutter from 'gi://Clutter';\nimport Shell from 'gi://Shell';",
    "import Clutter from 'gi://Clutter';\nimport Meta from 'gi://Meta';\nimport Shell from 'gi://Shell';",'IMPORT');
}
if(!s.includes('this._destroyed = false;')){
  replaceOnce("    this._pointer = null;\n    this._keyboard = null;\n    this._token = '';\n",
    "    this._pointer = null;\n    this._keyboard = null;\n    this._destroyed = false;\n    this._wayland = Meta.is_wayland_compositor();\n    this._token = '';\n",'CTOR');
}
if(!s.includes('  destroy() {')){
  replaceOnce("    try {\n      const seat = Clutter.get_default_backend().get_default_seat();\n      this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);\n      this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);\n    } catch (_) {}\n  }\n\n  _authorized(req) {\n",
    "    if (this._wayland) {\n      try {\n        const seat = Clutter.get_default_backend().get_default_seat();\n        this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);\n        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);\n      } catch (_) {}\n    }\n  }\n\n  destroy() {\n    this._destroyed = true;\n    this._pointer = null;\n    this._keyboard = null;\n    this._token = '';\n  }\n\n  _authorized(req) {\n    if (this._destroyed) fail('GUI_EXTENSION_DISABLED');\n",'DEVICES');
}
if(!s.includes('if (this._destroyed) return true;')){
  replaceOnce("  _stopped(req = null) {\n    if (Gio.File.new_for_path(STOP_PATH).query_exists(null)) return true;\n",
    "  _stopped(req = null) {\n    if (this._destroyed) return true;\n    if (Gio.File.new_for_path(STOP_PATH).query_exists(null)) return true;\n",'STOPPED');
}
if(!s.includes("gnome-shell-x11-observe-only")){
  replaceOnce("        ok:true, available:!!(this._pointer && this._keyboard), backend:'gnome-shell-wayland',\n        sessionType:GLib.getenv('XDG_SESSION_TYPE') ?? 'unknown', screens:this._screens(),\n        capabilities:{screenshot:true,cursor:true,listWindows:true,mouse:!!this._pointer,keyboard:!!this._keyboard,focus:true}\n",
    "        ok:true, available:true,\n        backend:this._wayland ? 'gnome-shell-wayland' : 'gnome-shell-x11-observe-only',\n        sessionType:this._wayland ? 'wayland' : 'x11', screens:this._screens(),\n        capabilities:{screenshot:true,cursor:true,listWindows:true,mouse:!!this._pointer,keyboard:!!this._keyboard,focus:true}\n",'STATUS');
}
if(!s.includes('GUI_SYNTHETIC_INPUT_UNAVAILABLE_X11')){
  const focus="    if (action === 'focusWindow') {\n      const windows = this._rawWindows();\n      let matches = [];\n      if (req.handle) matches = windows.filter(w => this._windowHandle(w) === String(req.handle));\n      else {\n        const q = String(req.titleContains ?? '').toLocaleLowerCase();\n        matches = windows.filter(w => String(w.get_title() ?? '').toLocaleLowerCase().includes(q));\n      }\n      if (matches.length !== 1) fail('GUI_WINDOW_SELECTOR_NOT_UNIQUE');\n      matches[0].activate(global.get_current_time());\n      await sleep(30);\n      if (global.display.focus_window !== matches[0]) fail('GUI_FOCUS_FAILED');\n      return {ok:true,handle:this._windowHandle(matches[0])};\n    }\n";
  if((s.split(focus).length-1)!==1) throw new Error('FOCUS_COUNT');
  s=s.replace(focus,'');
  replaceOnce("    const {expected} = this._guard(req);\n    if (!this._pointer || !this._keyboard) fail('GUI_VIRTUAL_INPUT_UNAVAILABLE');\n    if (action === 'move') {\n",
    "    const {expected} = this._guard(req);\n"+focus+"    if (!this._pointer || !this._keyboard)\n      fail(this._wayland ? 'GUI_VIRTUAL_INPUT_UNAVAILABLE' : 'GUI_SYNTHETIC_INPUT_UNAVAILABLE_X11');\n    if (action === 'move') {\n",'INPUT_GUARD');
}
if(!s.includes('this._service?.destroy();')){
  replaceOnce("  disable() {\n    this._dbus?.unexport();\n    this._dbus = null;\n    this._service = null;\n  }\n",
    "  disable() {\n    this._dbus?.unexport();\n    this._dbus = null;\n    this._service?.destroy();\n    this._service = null;\n  }\n",'DISABLE');
}
fs.writeFileSync(file,s);
console.log('X11_OBSERVE_ONLY_GUARD_PATCHED=1');
