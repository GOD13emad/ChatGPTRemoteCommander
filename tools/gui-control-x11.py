#!/usr/bin/env python3
"""Same-user KDE/X11 GUI observer. Off-the-shelf X11 + Pillow; NEVER inject input.

Requests: status, cursor, listWindows, screenshot. All other actions fail closed.
Session identity is rechecked for every request. This is NOT a root or GUI-input grant.
"""
import base64
import io
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

from PIL import ImageGrab

GLOBAL_STOP = os.path.join(os.path.expanduser("~"), ".local", "state", "chatgpt-remote-commander", "GUI_STOP")
_ALLOWED = {"status", "cursor", "listWindows", "screenshot"}
_LIMIT = 32768


class NativeError(Exception):
    pass


def _run(argv, display=None, timeout=2.0, cap=65536):
    env = os.environ.copy()
    if display is not None:
        env["DISPLAY"] = display
    try:
        completed = subprocess.run(argv, env=env, shell=False, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   timeout=timeout, check=True)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise NativeError("GUI_X11_NATIVE_UNAVAILABLE")
    if len(completed.stdout) > cap:
        raise NativeError("GUI_X11_NATIVE_OUTPUT_LIMIT")
    return completed.stdout.decode("utf-8", errors="replace").strip()


def _fields(raw):
    return dict(x.split("=", 1) for x in raw.splitlines() if "=" in x)


def _session():
    uid = os.getuid()
    try:
        if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE", "x11").lower() != "x11":
            return None
        listings = _run(["/usr/bin/loginctl", "list-sessions", "--no-legend", "--no-pager"], cap=32768)
        matches = []
        for line in listings.splitlines()[:96]:
            cells = line.split()
            if len(cells) < 2 or not re.fullmatch(r"[A-Za-z0-9]{1,12}", cells[0]):
                continue
            if not cells[1].isdigit() or int(cells[1]) != uid:
                continue
            detail = _fields(_run(["/usr/bin/loginctl", "show-session", cells[0],
                                   "-p", "Desktop", "-p", "Type", "-p", "Active",
                                   "-p", "Remote", "-p", "Display", "-p", "Class", "-p", "Seat", "-p", "LockedHint"]))
            if detail.get("Desktop", "").upper() != "KDE" or detail.get("Type") != "x11" or detail.get("Active") != "yes" or detail.get("Remote") != "no":
                continue
            if detail.get("Class") != "user" or detail.get("LockedHint") != "no" or not re.fullmatch(r"seat[0-9A-Za-z_-]{1,32}", detail.get("Seat", "")):
                continue
            matches.append((cells[0], detail.get("Display", "")))
        if len(matches) != 1:
            return None
        sid, display = matches[0]
        if not re.fullmatch(r":[0-9]{1,3}(?:\.[0-9]{1,2})?", display):
            return None
        if (os.environ.get("DISPLAY") and os.environ["DISPLAY"] != display) or (os.environ.get("XDG_SESSION_ID") and os.environ["XDG_SESSION_ID"] != sid):
            return None
        dims = _run(["/usr/bin/xdotool", "getdisplaygeometry"], display=display)
        found = re.fullmatch(r"([0-9]{3,5})\s+([0-9]{3,5})", dims)
        if found is not None:
            width, height = map(int, found.groups())
            if 320 <= width <= 16384 and 200 <= height <= 16384 and width * height <= 16000000:
                return display, width, height
    except NativeError:
        pass
    return None


def _stop(req):
    if os.path.exists(GLOBAL_STOP):
        return True
    value = req.get("stopFile")
    return isinstance(value, str) and value.endswith("/var/GUI_STOP") and os.path.exists(value)


def _num(value, minimum, maximum, default):
    if type(value) is not int:
        return default
    return min(max(value, minimum), maximum)


def _active(display, width, height):
    try:
        window = _run(["/usr/bin/xdotool", "getactivewindow"], display=display)
        if not window.isdigit() or int(window) < 1:
            raise NativeError("GUI_X11_WINDOW_UNAVAILABLE")
        active_id = int(window)
        try:
            pid = int(_run(["/usr/bin/xdotool", "getwindowpid", str(active_id)], display=display))
        except (NativeError, ValueError):
            pid = 0
        geometry = _fields(_run(["/usr/bin/xdotool", "getwindowgeometry", "--shell", str(active_id)], display=display))
        bounds = {key: int(geometry[field]) for key, field in [
            ("left", "X"), ("top", "Y"), ("width", "WIDTH"), ("height", "HEIGHT")
        ]}
        if bounds["width"] <= 0 or bounds["height"] <= 0:
            raise NativeError("GUI_X11_WINDOW_UNAVAILABLE")
        return {"foreground": str(active_id), "processId": pid, "bounds": bounds, "screenIndex": 0}
    except (NativeError, KeyError, ValueError):
        # A lock screen or no focused application must not authorize input.
        return {"foreground": "0", "processId": 0,
                "bounds": {"left": 0, "top": 0, "width": width, "height": height}, "screenIndex": 0}


def _status():
    session = _session()
    if session is None:
        return {"ok": True, "available": False, "inputAvailable": False,
                "backend": "kde-x11-xdotool-readonly", "reason": "GUI_OWNER_KDE_X11_SESSION_UNAVAILABLE",
                "screens": [], "capabilities": {"screenshot": False, "cursor": False, "listWindows": False,
                                                 "mouse": False, "keyboard": False, "focus": False}}
    _display, width, height = session
    return {"ok": True, "available": True, "readOnlyAvailable": True, "inputAvailable": False,
            "backend": "kde-x11-xdotool-readonly", "sessionType": "x11", "desktop": "KDE",
            "reason": "GUI_X11_NATIVE_INPUT_NOT_PROMOTED",
            "screens": [{"index": 0, "left": 0, "top": 0, "width": width,
                         "height": height, "primary": True}],
            "capabilities": {"screenshot": True, "cursor": True, "listWindows": True,
                             "mouse": False, "keyboard": False, "focus": False}}


def _cursor(display):
    m = _fields(_run(["/usr/bin/xdotool", "getmouselocation", "--shell"], display=display))
    try:
        return {"ok": True, "x": int(m["X"]), "y": int(m["Y"]),
                "screenIndex": int(m.get("SCREEN", "0")), "readOnly": True}
    except (KeyError, ValueError):
        raise NativeError("GUI_X11_CURSOR_UNAVAILABLE")



def _verified_x11_wm_class(display, handle, expected_pid):
    """Read only exact-window WM_CLASS; never attribute a sibling's process/class."""
    try:
        body = _run(["/usr/bin/xprop", "-id", str(handle), "_NET_WM_PID", "WM_CLASS"],
                    display=display, timeout=0.6, cap=4096)
        owner = re.search(r"^_NET_WM_PID\(CARDINAL\)\s*=\s*([0-9]{1,12})$", body, re.M)
        klass = re.search(r"^WM_CLASS\(STRING\)\s*=\s*(.+)$", body, re.M)
        if not owner or int(owner.group(1)) != expected_pid or not klass:
            return None
        classes = re.findall(r'"([^"\r\n]{1,100})"', klass.group(1))
        if len(classes) != 2:
            return None
        return classes[-1]
    except (NativeError, ValueError):
        return None

def _windows(display):
    try:
        ids = _run(["/usr/bin/xdotool", "search", "--onlyvisible", "--name", "."],
                   display=display, cap=8192).splitlines()
    except NativeError:
        ids = []
    result = []
    for raw in ids[:64]:
        if not raw.isdigit() or int(raw) < 1:
            continue
        try:
            pid = int(_run(["/usr/bin/xdotool", "getwindowpid", raw], display=display, timeout=0.5))
            if pid < 1 or os.stat("/proc/" + str(pid)).st_uid != os.getuid():
                continue
            name = _run(["/usr/bin/xdotool", "getwindowname", raw], display=display, timeout=0.5, cap=4096)
            # No arbitrary shell arguments, no process cmdline/credentials.
            window = {"handle": raw, "title": name[:160], "processId": pid}
            # Only append the X11 identity verified for this exact handle + PID.
            # Missing/ambiguous metadata remains untrusted and cannot grant AT-SPI.
            klass = _verified_x11_wm_class(display, raw, pid)
            if klass is not None:
                window["wmClass"] = klass
            result.append(window)
        except (NativeError, ValueError, OSError):
            continue
    return {"ok": True, "windows": result, "readOnly": True}


def _screenshot(display, width, height, req):
    if req.get("screenIndex", 0) != 0:
        raise NativeError("GUI_SCREEN_UNAVAILABLE")
    before = _active(display, width, height)
    try:
        image = ImageGrab.grab(bbox=(0, 0, width, height), xdisplay=display)
        if image.mode != "RGB":
            image = image.convert("RGB")
        maximum_width = _num(req.get("maxWidth"), 320, 1920, 1600)
        if image.width > maximum_width:
            height_out = max(1, round(image.height * maximum_width / image.width))
            image = image.resize((maximum_width, height_out))
        fmt = req.get("format", "jpeg")
        if fmt not in ("jpeg", "png"):
            raise NativeError("GUI_IMAGE_FORMAT_UNSUPPORTED")
        buff = io.BytesIO()
        if fmt == "jpeg":
            image.save(buff, format="JPEG", quality=_num(req.get("quality"), 25, 90, 70), optimize=True)
        else:
            image.save(buff, format="PNG", optimize=True)
        data = buff.getvalue()
    except NativeError:
        raise
    except Exception:
        raise NativeError("GUI_IMAGE_CAPTURE_FAILED")
    after = _active(display, width, height)
    if before != after:
        raise NativeError("GUI_FOREGROUND_OR_GEOMETRY_CHANGED")
    maxbytes = _num(req.get("maxBytes"), 262144, 4194304, 2097152)
    if not data or len(data) > maxbytes:
        raise NativeError("GUI_IMAGE_BYTE_LIMIT")
    return {"ok": True, "data": base64.b64encode(data).decode("ascii"),
            "mimeType": "image/jpeg" if fmt == "jpeg" else "image/png",
            "width": image.width, "height": image.height,
            "snapshot": after, "capturedAt": datetime.now(timezone.utc).isoformat()}


def handle(req):
    if type(req) is not dict or len(json.dumps(req)) > _LIMIT:
        return {"ok": False, "error": "GUI_REQUEST_INVALID"}
    if _stop(req):
        return {"ok": False, "error": "GUI_LOCAL_STOP"}
    action = req.get("action")
    if action not in _ALLOWED:
        return {"ok": False, "error": "GUI_X11_NATIVE_INPUT_NOT_PROMOTED"}
    if action == "status":
        return _status()
    session = _session()
    if session is None:
        return {"ok": False, "error": "GUI_OWNER_KDE_X11_SESSION_UNAVAILABLE"}
    display, width, height = session
    try:
        if action == "cursor":
            return _cursor(display)
        if action == "listWindows":
            return _windows(display)
        if action == "screenshot":
            return _screenshot(display, width, height, req)
    except NativeError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception:
        return {"ok": False, "error": "GUI_NATIVE_FAILED"}
    return {"ok": False, "error": "GUI_UNKNOWN_TOOL"}


def main():
    if "--self-test" in sys.argv:
        print(json.dumps({"ok": True, "protocol": 1, "input": False,
                          "supported": sorted(_ALLOWED), "stopped": os.path.exists(GLOBAL_STOP)}))
        return 0
    if "--server" in sys.argv:
        print('{"ok":true,"ready":true,"protocol":1}', flush=True)
        for line in sys.stdin:
            try:
                response = {"ok": False, "error": "GUI_REQUEST_LIMIT"} if len(line) > _LIMIT else handle(json.loads(line))
            except Exception:
                response = {"ok": False, "error": "GUI_NATIVE_FAILED"}
            print(json.dumps(response, separators=(",", ":"), ensure_ascii=False), flush=True)
        return 0
    raw = sys.stdin.read(_LIMIT + 1)
    try:
        answer = {"ok": False, "error": "GUI_REQUEST_LIMIT"} if len(raw) > _LIMIT else handle(json.loads(raw))
    except Exception:
        answer = {"ok": False, "error": "GUI_NATIVE_FAILED"}
    print(json.dumps(answer, separators=(",", ":"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
