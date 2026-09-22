import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `<node>
  <interface name="org.gnome.Shell.Extensions.ChatGPTRemoteCommander">
    <method name="Invoke">
      <arg type="s" direction="in" name="request"/>
      <arg type="s" direction="out" name="response"/>
    </method>
  </interface>
</node>`;

const STOP_PATH = GLib.build_filenamev([GLib.get_user_state_dir(), 'chatgpt-remote-commander', 'GUI_STOP']);
const TOKEN_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'chatgpt-remote-commander', 'gui-extension-token']);
const sleep = ms => new Promise(resolve => {
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, ms), () => {
    resolve();
    return GLib.SOURCE_REMOVE;
  });
});
const fail = code => { throw new Error(code); };
const nowUs = () => GLib.get_monotonic_time();

class Service {
  constructor() {
    this._pointer = null;
    this._keyboard = null;
    this._token = '';
    try {
      const [ok, bytes] = GLib.file_get_contents(TOKEN_PATH);
      if (ok) this._token = new TextDecoder().decode(bytes).trim();
    } catch (_) {}
    try {
      const seat = Clutter.get_default_backend().get_default_seat();
      this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
      this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    } catch (_) {}
  }

  _authorized(req) {
    if (!this._token || typeof req.auth !== 'string' || req.auth.length < 32 || req.auth !== this._token)
      fail('GUI_EXTENSION_AUTH_FAILED');
  }

  _stopped(req = null) {
    if (Gio.File.new_for_path(STOP_PATH).query_exists(null)) return true;
    const requested = req?.stopFile;
    if (typeof requested === 'string' && requested.endsWith('/var/GUI_STOP'))
      return Gio.File.new_for_path(requested).query_exists(null);
    return false;
  }

  _screens() {
    const count = global.display.get_n_monitors();
    const primary = global.display.get_primary_monitor();
    const screens = [];
    for (let i = 0; i < count; i++) {
      const g = global.display.get_monitor_geometry(i);
      screens.push({index:i,left:g.x,top:g.y,width:g.width,height:g.height,primary:i === primary});
    }
    return screens;
  }

  _windowHandle(w) {
    if (!w) return '0';
    try {
      const id = w.get_id();
      if (Number.isSafeInteger(id) && id > 0) return String(id);
    } catch (_) {}
    try {
      const id = w.get_stable_sequence();
      if (Number.isSafeInteger(id) && id > 0) return String(id);
    } catch (_) {}
    return '0';
  }

  _windowRecord(w) {
    if (!w) return {handle:'0',title:'',processId:0,wmClass:'',focused:false};
    let pid = 0;
    try { pid = Number(w.get_pid()) || 0; } catch (_) {}
    let title = '';
    try { title = w.get_title() ?? ''; } catch (_) {}
    let wmClass = '';
    try { wmClass = w.get_wm_class() ?? ''; } catch (_) {}
    return {
      handle:this._windowHandle(w),
      title,
      processId:Number.isSafeInteger(pid) ? pid : 0,
      wmClass,
      focused:global.display.focus_window === w
    };
  }

  _rawWindows() {
    const seen = new Set();
    const out = [];
    for (const actor of global.get_window_actors()) {
      const w = actor.meta_window ?? actor.get_meta_window?.();
      if (!w) continue;
      const handle = this._windowHandle(w);
      if (handle === '0' || seen.has(handle)) continue;
      seen.add(handle);
      out.push(w);
    }
    return out;
  }

  _snapshot(screenIndex) {
    const screens = this._screens();
    const screen = screens.find(s => s.index === screenIndex);
    if (!screen) fail('GUI_MONITOR_RANGE');
    const f = this._windowRecord(global.display.focus_window);
    let workspace = -1;
    try { workspace = global.workspace_manager.get_active_workspace_index(); } catch (_) {}
    return {
      screenIndex,
      bounds:{left:screen.left,top:screen.top,width:screen.width,height:screen.height},
      foreground:f.title,
      processId:f.processId,
      handle:f.handle,
      wmClass:f.wmClass,
      workspace
    };
  }

  _sameSnapshot(a, b) {
    if (!a || !b || !a.bounds || !b.bounds) return false;
    for (const k of ['left','top','width','height']) if (a.bounds[k] !== b.bounds[k]) return false;
    return a.screenIndex === b.screenIndex &&
      String(a.handle ?? '') === String(b.handle ?? '') &&
      String(a.foreground ?? '') === String(b.foreground ?? '') &&
      Number(a.processId ?? 0) === Number(b.processId ?? 0) &&
      Number(a.workspace ?? -1) === Number(b.workspace ?? -1);
  }

  _guard(req) {
    if (this._stopped(req)) fail('GUI_LOCAL_STOP');
    const expected = req.expected;
    if (!expected || !Number.isInteger(expected.screenIndex)) fail('GUI_EXPECTED_FRAME_INVALID');
    const current = this._snapshot(expected.screenIndex);
    if (!this._sameSnapshot(expected, current)) fail('GUI_FOREGROUND_OR_GEOMETRY_CHANGED');
    return {expected,current};
  }

  _point(value, observed) {
    const index = Number.isInteger(value.screenIndex) ? value.screenIndex : observed.screenIndex;
    if (index !== observed.screenIndex) fail('GUI_MONITOR_NOT_OBSERVED');
    const b = observed.bounds;
    let x, y;
    if ((value.coordinateMode ?? 'absolute') === 'relative') {
      x = b.left + Math.round(Number(value.x) * (b.width - 1));
      y = b.top + Math.round(Number(value.y) * (b.height - 1));
    } else {
      x = Number(value.x); y = Number(value.y);
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < b.left || y < b.top || x >= b.left + b.width || y >= b.top + b.height)
      fail('GUI_POINT_OUTSIDE_MONITOR');
    return {x,y};
  }

  _buttonCode(button) {
    if (button === 'left') return 0x110;
    if (button === 'right') return 0x111;
    if (button === 'middle') return 0x112;
    fail('GUI_BUTTON_INVALID');
  }

  _keyval(key) {
    const named = {
      CTRL:Clutter.KEY_Control_L, SHIFT:Clutter.KEY_Shift_L, ALT:Clutter.KEY_Alt_L, WIN:Clutter.KEY_Super_L,
      ENTER:Clutter.KEY_Return, TAB:Clutter.KEY_Tab, SPACE:Clutter.KEY_space, BACKSPACE:Clutter.KEY_BackSpace,
      DELETE:Clutter.KEY_Delete, INSERT:Clutter.KEY_Insert, HOME:Clutter.KEY_Home, END:Clutter.KEY_End,
      PGUP:Clutter.KEY_Page_Up, PGDN:Clutter.KEY_Page_Down, LEFT:Clutter.KEY_Left, RIGHT:Clutter.KEY_Right,
      UP:Clutter.KEY_Up, DOWN:Clutter.KEY_Down
    };
    if (Object.hasOwn(named,key)) return named[key];
    if (/^[A-Z]$/.test(key)) return Clutter[`KEY_${key.toLowerCase()}`];
    if (/^[0-9]$/.test(key)) return Clutter[`KEY_${key}`];
    if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return Clutter[`KEY_${key}`];
    fail('GUI_KEYMAP_FAILED');
  }

  async _screenshot(req) {
    if (this._stopped(req)) fail('GUI_LOCAL_STOP');
    const screenIndex = Number.isInteger(req.screenIndex) ? req.screenIndex : 0;
    const before = this._snapshot(screenIndex);
    const b = before.bounds;
    if (b.width < 1 || b.height < 1 || b.width * b.height > 33554432) fail('GUI_CAPTURE_GEOMETRY_LIMIT');
    const dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'chatgpt-remote-commander', 'gui']);
    GLib.mkdir_with_parents(dir, 0o700);
    const filename = GLib.build_filenamev([dir, `shot-${GLib.uuid_string_random()}.png`]);
    const file = Gio.File.new_for_path(filename);
    const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    const shot = new Shell.Screenshot();
    const ok = await new Promise((resolve, reject) => {
      shot.screenshot_area(b.left,b.top,b.width,b.height,stream,(obj,res) => {
        try {
          const result = obj.screenshot_area_finish(res);
          resolve(Array.isArray(result) ? result[0] === true : result === true);
        } catch (e) { reject(e); }
      });
    });
    try { stream.close(null); } catch (_) {}
    if (!ok) {
      try { file.delete(null); } catch (_) {}
      fail('GUI_CAPTURE_FAILED');
    }
    const after = this._snapshot(screenIndex);
    if (!this._sameSnapshot(before, after)) {
      try { file.delete(null); } catch (_) {}
      fail('GUI_FOREGROUND_OR_GEOMETRY_CHANGED');
    }
    return {ok:true,path:filename,snapshot:before,capturedAt:new Date().toISOString()};
  }

  async _dispatch(req) {
    this._authorized(req);
    const action = req.action;
    if (action === 'status') {
      return {
        ok:true, available:!!(this._pointer && this._keyboard), backend:'gnome-shell-wayland',
        sessionType:GLib.getenv('XDG_SESSION_TYPE') ?? 'unknown', screens:this._screens(),
        capabilities:{screenshot:true,cursor:true,listWindows:true,mouse:!!this._pointer,keyboard:!!this._keyboard,focus:true}
      };
    }
    if (action === 'screenshot') return this._screenshot(req);
    if (action === 'cursor') {
      if (this._stopped(req)) fail('GUI_LOCAL_STOP');
      const [x,y] = global.get_pointer();
      return {ok:true,x,y};
    }
    if (action === 'listWindows') {
      if (this._stopped(req)) fail('GUI_LOCAL_STOP');
      return {ok:true,windows:this._rawWindows().map(w => this._windowRecord(w)).filter(w => w.handle !== '0')};
    }
    const {expected} = this._guard(req);
    if (!this._pointer || !this._keyboard) fail('GUI_VIRTUAL_INPUT_UNAVAILABLE');
    if (action === 'move') {
      const p = this._point(req, expected);
      this._pointer.notify_absolute_motion(nowUs(),p.x,p.y);
      return {ok:true};
    }
    if (action === 'moveRelative') {
      this._pointer.notify_relative_motion(nowUs(),Number(req.dx),Number(req.dy));
      return {ok:true};
    }
    if (action === 'scroll') {
      const steps = Math.max(1,Math.round(Math.abs(Number(req.delta))/120));
      const positive = Number(req.delta) > 0;
      const direction = req.horizontal
        ? (positive ? Clutter.ScrollDirection.RIGHT : Clutter.ScrollDirection.LEFT)
        : (positive ? Clutter.ScrollDirection.UP : Clutter.ScrollDirection.DOWN);
      for (let i=0;i<steps;i++) this._pointer.notify_discrete_scroll(nowUs(),direction,Clutter.ScrollSource.WHEEL);
      return {ok:true};
    }
    if (action === 'click') {
      const p = this._point(req, expected);
      this._pointer.notify_absolute_motion(nowUs(),p.x,p.y);
      const code = this._buttonCode(req.button ?? 'left');
      const clicks = Number(req.clicks ?? 1);
      for (let i=0;i<clicks;i++) {
        if (this._stopped(req)) fail('GUI_LOCAL_STOP');
        this._pointer.notify_button(nowUs(),code,Clutter.ButtonState.PRESSED);
        this._pointer.notify_button(nowUs(),code,Clutter.ButtonState.RELEASED);
        if (i + 1 < clicks) await sleep(Number(req.intervalMs ?? 120));
      }
      return {ok:true};
    }
    if (action === 'drag') {
      const a = this._point(req.from, expected), b = this._point(req.to, expected);
      const code = this._buttonCode(req.button ?? 'left');
      const steps = Math.max(2,Number(req.steps ?? 24));
      const duration = Math.max(50,Number(req.durationMs ?? 500));
      this._pointer.notify_absolute_motion(nowUs(),a.x,a.y);
      this._pointer.notify_button(nowUs(),code,Clutter.ButtonState.PRESSED);
      try {
        for (let i=1;i<=steps;i++) {
          if (this._stopped(req)) fail('GUI_LOCAL_STOP');
          const t=i/steps;
          this._pointer.notify_absolute_motion(nowUs(),a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);
          if (i < steps) await sleep(Math.max(1,Math.floor(duration/steps)));
        }
      } finally {
        this._pointer.notify_button(nowUs(),code,Clutter.ButtonState.RELEASED);
      }
      return {ok:true};
    }
    if (action === 'typeText') {
      const delay = Number(req.intervalMs ?? 0);
      for (const ch of String(req.text ?? '')) {
        if (this._stopped(req)) fail('GUI_LOCAL_STOP');
        const keyval = Clutter.unicode_to_keysym(ch.codePointAt(0));
        if (!keyval) fail('GUI_KEYMAP_FAILED');
        this._keyboard.notify_keyval(nowUs(),keyval,Clutter.KeyState.PRESSED);
        this._keyboard.notify_keyval(nowUs(),keyval,Clutter.KeyState.RELEASED);
        if (delay > 0) await sleep(delay);
      }
      return {ok:true};
    }
    if (action === 'keyPress') {
      const vals = req.keys.map(k => this._keyval(String(k)));
      const pressed = [];
      try {
        for (const val of vals) {
          this._keyboard.notify_keyval(nowUs(),val,Clutter.KeyState.PRESSED);
          pressed.push(val);
        }
        if (Number(req.holdMs ?? 0) > 0) await sleep(Number(req.holdMs));
      } finally {
        for (const val of pressed.reverse()) this._keyboard.notify_keyval(nowUs(),val,Clutter.KeyState.RELEASED);
      }
      return {ok:true};
    }
    if (action === 'focusWindow') {
      const windows = this._rawWindows();
      let matches = [];
      if (req.handle) matches = windows.filter(w => this._windowHandle(w) === String(req.handle));
      else {
        const q = String(req.titleContains ?? '').toLocaleLowerCase();
        matches = windows.filter(w => String(w.get_title() ?? '').toLocaleLowerCase().includes(q));
      }
      if (matches.length !== 1) fail('GUI_WINDOW_SELECTOR_NOT_UNIQUE');
      matches[0].activate(global.get_current_time());
      await sleep(30);
      if (global.display.focus_window !== matches[0]) fail('GUI_FOCUS_FAILED');
      return {ok:true,handle:this._windowHandle(matches[0])};
    }
    fail('GUI_UNKNOWN_ACTION');
  }

  InvokeAsync(params, invocation) {
    const [request] = params;
    let req;
    try { req = JSON.parse(request); }
    catch (_) {
      invocation.return_value(new GLib.Variant('(s)', [JSON.stringify({ok:false,error:'GUI_REQUEST_INVALID'})]));
      return;
    }
    this._dispatch(req).then(result => {
      invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(result)]));
    }).catch(error => {
      const m = String(error?.message ?? error);
      const match = m.match(/GUI_[A-Z0-9_]+/);
      invocation.return_value(new GLib.Variant('(s)', [JSON.stringify({ok:false,error:match?.[0] ?? 'GUI_NATIVE_FAILED'})]));
    });
  }
}

export default class ChatGPTRemoteCommanderExtension extends Extension {
  enable() {
    this._service = new Service();
    this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE,this._service);
    this._dbus.export(Gio.DBus.session,'/org/gnome/Shell/Extensions/ChatGPTRemoteCommander');
  }
  disable() {
    this._dbus?.unexport();
    this._dbus = null;
    this._service = null;
  }
}
