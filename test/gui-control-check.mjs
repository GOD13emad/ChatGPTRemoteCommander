import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const pkg = JSON.parse(read('package.json'));
if (pkg.version !== '0.5.0') throw new Error('GUI release expects package 0.5.0');

const config = JSON.parse(read('config.json'));
if (config.powerMode?.guiControl?.enabled !== false) throw new Error('public GUI Control must be disabled by default');
for (const key of ['allowScreenshot','allowMouse','allowKeyboard','allowWindowFocus']) {
  if (config.powerMode.guiControl[key] !== true) throw new Error('missing GUI policy key '+key);
}

const gui = read('src/gui-tools-windows.mjs');
for (const name of [
  'gui_status','gui_screenshot','gui_cursor_position','gui_mouse_move','gui_mouse_delta',
  'gui_mouse_scroll','gui_mouse_click','gui_mouse_drag','gui_type_text','gui_key_press',
  'gui_list_windows','gui_focus_window','__mcpContent'
]) if (!gui.includes(name)) throw new Error('GUI module missing '+name);

const helper = read('tools/gui-control.ps1');
for (const required of ['CopyFromScreen','SetCursorPos','MoveRelative','Scroll','TypeUnicode','KeyCombo','ListWindows','FocusWindow']) {
  if (!helper.includes(required)) throw new Error('GUI helper missing '+required);
}

const server = read('src/server-v0.3.mjs');
for (const required of ['guiToolDefinitions','executeGuiTool','GUI_ENABLED','__mcpContent']) {
  if (!server.includes(required)) throw new Error('server GUI integration missing '+required);
}

const installer = read('install.ps1');
for (const required of ['[switch]$GuiControl','[switch]$DisableGuiControl','GUI Control:','allowScreenshot','allowMouse','allowKeyboard','allowWindowFocus']) {
  if (!installer.includes(required)) throw new Error('installer GUI opt-in missing '+required);
}

const skill = read('plugin-template/skills/remote-commander/SKILL.md');
for (const required of ['GUI Control workflow','gui_screenshot','gui_mouse_click','real-time/high-speed gameplay']) {
  if (!skill.includes(required)) throw new Error('skill GUI workflow missing '+required);
}

console.log('GUI_CONTROL_CHECK_PASS');
