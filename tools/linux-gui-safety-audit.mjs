#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const extension=await readFile(path.join(root,'gnome-extension/chatgpt-remote-commander-linux-safe@god13emad/extension.js'),'utf8');
const helper=await readFile(path.join(root,'tools/gui-control-linux.py'),'utf8');
const controller=await readFile(path.join(root,'src/gui-tools-windows.mjs'),'utf8');
const shell=await readFile(path.join(root,'src/power-tools-v0.3.mjs'),'utf8');
const forbidden=[/create_virtual_device\s*\(/,/notify_keyval\s*\(/,/notify_button\s*\(/,/notify_absolute_motion\s*\(/,/notify_relative_motion\s*\(/,/\bxdotool\b/i,/\bXTEST\b/i];
for(const re of forbidden) if(re.test(extension)) throw new Error(`LINUX_GUI_SAFETY_FAIL extension contains ${re}`);
for(const marker of ['org.gnome.Mutter.RemoteDesktop','NotifyKeyboardKeycode','NotifyPointerMotionRelative','NotifyPointerButton','NotifyPointerAxisDiscrete','EnableClipboard','SetSelection','SelectionRead','SelectionWrite','SelectionWriteDone','SelectionTransfer','GUI_OPERATION_TIMEOUT','GLOBAL_STOP','session-is-owner','GUI_CLIPBOARD_OWNER_NOT_CONFIRMED']) if(!helper.includes(marker)) throw new Error(`LINUX_GUI_SAFETY_FAIL helper missing ${marker}`);
if(helper.includes('NotifyKeyboardKeysym')) throw new Error('LINUX_GUI_SAFETY_FAIL keysym injection is forbidden on X11');
for(const marker of ['get_current_time_roundtrip','GUI_INPUT_MUST_USE_MUTTER_REMOTE_DESKTOP','this._service?.destroy()']) if(!extension.includes(marker)) throw new Error(`LINUX_GUI_SAFETY_FAIL extension missing ${marker}`);
for(const marker of ['session = null; frame = null; closeInvoke();','globalStopFile']) if(!controller.includes(marker)) throw new Error(`LINUX_GUI_SAFETY_FAIL controller missing ${marker}`);
for(const marker of ['assertNoDirectLinuxGuiMutation','direct Linux GUI/input mutation is blocked']) if(!shell.includes(marker)) throw new Error(`LINUX_GUI_SAFETY_FAIL shell missing ${marker}`);
console.log('LINUX_GUI_INPUT_SAFETY_PASS backend=mutter-remote-desktop extension=observation-focus-only');
