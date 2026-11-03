#!/usr/bin/python3
"""Bounded owner-session AT-SPI semantics. Never sends pointer/keyboard or reads values."""
import json
import os
import sys
import time
from collections import deque

import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

MAX_NODES = 240
MAX_DEPTH = 18
MAX_CHILDREN = 60
SNAPSHOT_BUDGET_SECONDS = 4.0
SNAPSHOT_DBUS_TIMEOUT_MS = 350
SNAPSHOT_STARTUP_TIMEOUT_MS = 750
READ_ROLES = {"entry", "text", "combo box", "search box"}
ACT_ROLES = {"button", "push button", "check box"}
DENY = ("password", "passcode", "secret", "token", "api key", "credit card")


def fail(code):
    raise ValueError("ATSPI_" + code)


def owner_start_ticks(pid):
    """Kernel process generation (field 22 of /proc/PID/stat), not a PID guess."""
    try:
        with open("/proc/%d/stat" % pid, encoding="ascii") as source:
            stat = source.read()
        end = stat.rfind(")")
        fields = stat[end + 1:].split()
        if end < 0 or len(fields) <= 19 or not fields[19].isdigit():
            fail("PROCESS_GENERATION_UNAVAILABLE")
        return fields[19]
    except (OSError, UnicodeError):
        fail("PROCESS_GENERATION_UNAVAILABLE")


def exact_generic_owner(pid, application, start_ticks):
    if not isinstance(application, str) or not 1 <= len(application) <= 128 or (
        any(ord(ch) < 32 or ord(ch) == 127 for ch in application)
    ):
        fail("APPLICATION_IDENTITY_INVALID")
    if not isinstance(start_ticks, str) or not 1 <= len(start_ticks) <= 24 or (
        not start_ticks.isascii() or not start_ticks.isdecimal()
    ):
        fail("PROCESS_GENERATION_INVALID")
    try:
        if os.stat("/proc/%d" % pid).st_uid != os.getuid():
            fail("PROCESS_OWNER_MISMATCH")
    except OSError:
        fail("PROCESS_OWNER_UNVERIFIED")
    if owner_start_ticks(pid) != start_ticks:
        fail("PROCESS_REPLACED")


def owner_frame(pid, window_title, deadline=None, expected_app=None, expected_start_ticks=None):
    if not isinstance(pid, int) or not 1 <= pid <= 2147483647:
        fail("PID_INVALID")
    if not isinstance(window_title, str) or len(window_title) > 300:
        fail("TITLE_INVALID")
    generic = expected_app is not None or expected_start_ticks is not None
    if generic:
        exact_generic_owner(pid, expected_app, expected_start_ticks)
    desktop = Atspi.get_desktop(0)
    apps = []
    for i in range(min(desktop.get_child_count(), 100)):
        if deadline is not None and time.monotonic() >= deadline:
            fail("SNAPSHOT_BUDGET_EXHAUSTED")
        app = desktop.get_child_at_index(i)
        if app.get_process_id() == pid:
            apps.append(app)
    if len(apps) != 1:
        fail("OWNER_APP_PID_UNVERIFIED" if generic else "OWNER_FIREFOX_PID_UNVERIFIED")
    app_name = (apps[0].get_name() or "").strip()
    if generic:
        if app_name != expected_app:
            fail("OWNER_APP_NAME_CHANGED")
    elif app_name.lower() != "firefox":
        fail("OWNER_FIREFOX_PID_UNVERIFIED")
    frames = []
    for i in range(min(apps[0].get_child_count(), 30)):
        if deadline is not None and time.monotonic() >= deadline:
            fail("SNAPSHOT_BUDGET_EXHAUSTED")
        node = apps[0].get_child_at_index(i)
        name = (node.get_name() or "").strip()
        # Firefox AT-SPI frame labels omit the compositor's " — Mozilla Firefox".
        if name and (name == window_title or (not generic and (
            window_title.startswith(name + " — ") or
            window_title.startswith(name + " - ")))):
            frames.append((i, node))
    if len(frames) != 1:
        fail("OWNER_WINDOW_AMBIGUOUS_OR_CHANGED")
    return frames[0]


def by_path(root, path):
    if not isinstance(path, list) or len(path) > MAX_DEPTH or not path:
        fail("SELECTOR_INVALID")
    current = root
    for index in path:
        if not isinstance(index, int) or not 0 <= index < MAX_CHILDREN:
            fail("SELECTOR_INVALID")
        if index >= current.get_child_count():
            fail("ELEMENT_CHANGED")
        current = current.get_child_at_index(index)
    return current


def assert_control(node, expected_role, expected_name):
    role = node.get_role_name()
    name = (node.get_name() or "").strip()
    if not isinstance(expected_role, str) or role != expected_role:
        fail("ELEMENT_ROLE_CHANGED")
    if not isinstance(expected_name, str) or name != expected_name or len(name) < 2:
        fail("ELEMENT_NAME_CHANGED")
    if any(block in name.lower() for block in DENY):
        fail("SENSITIVE_ELEMENT_REFUSED")
    return role, name


def snapshot(frame, deadline):
    queue = deque([([], frame)])
    records = []
    seen = 0
    child_truncated = False
    while queue and seen < MAX_NODES and time.monotonic() < deadline:
        path, node = queue.popleft()
        seen += 1
        role = node.get_role_name()
        name = (node.get_name() or "").strip()
        if len(name) >= 2 and len(name) <= 160 and not any(v in name.lower() for v in DENY):
            editable = role in READ_ROLES and bool(node.is_editable_text())
            actionable = role in ACT_ROLES and bool(node.is_action())
            if editable or actionable:
                act = node.get_action_iface() if actionable else None
                acts = [act.get_action_name(i) for i in range(min(act.get_n_actions(), 4))] if act else []
                records.append({
                    "path": path, "role": role, "name": name,
                    "editable": editable,
                    "action": ("check" if role == "check box" and "check" in acts else "click" if role != "check box" and "click" in acts else "press" if role != "check box" and "press" in acts else None)
                })
                if len(records) >= 80:
                    break
        if len(path) < MAX_DEPTH:
            total = node.get_child_count()
            count = min(total, MAX_CHILDREN)
            if total > MAX_CHILDREN:
                child_truncated = True
            for i in range(count):
                if time.monotonic() >= deadline:
                    break
                queue.append((path + [i], node.get_child_at_index(i)))
        elif node.get_child_count() > 0:
            child_truncated = True
    return {"ok": True, "controls": records, "truncated": bool(queue) or child_truncated,
            "nodesVisited": seen, "valuesRead": False, "monitorCoordinatesUsed": False}


def execute(request):
    if not isinstance(request, dict):
        fail("INPUT_INVALID")
    pid = request.get("pid")
    title = request.get("windowTitle")
    command = request.get("command")
    expected_app = request.get("expectedApp")
    expected_start_ticks = request.get("expectedStartTicks")
    if command == "snapshot":
        # Native AT-SPI D-Bus limits are per-call, not whole-tree budgets.
        # Use the documented libatspi timeout AND monotonic scan budget.
        # This does not promise a responsive Firefox process.
        Atspi.set_timeout(SNAPSHOT_DBUS_TIMEOUT_MS,
                          SNAPSHOT_STARTUP_TIMEOUT_MS)
        deadline = time.monotonic() + SNAPSHOT_BUDGET_SECONDS
        _, frame = owner_frame(pid, title, deadline, expected_app, expected_start_ticks)
        return snapshot(frame, deadline)
    _, frame = owner_frame(pid, title, None, expected_app, expected_start_ticks)
    path = request.get("path")
    node = by_path(frame, path)
    role, name = assert_control(node, request.get("expectedRole"), request.get("expectedName"))
    if command == "type":
        if role not in READ_ROLES or not node.is_editable_text():
            fail("NOT_EDITABLE")
        text = request.get("text")
        if not isinstance(text, str) or not 1 <= len(text) <= 1024 or "\x00" in text:
            fail("TEXT_INVALID")
        # No reading of the previous value; avoids cookies/credentials.
        result = node.get_editable_text_iface().set_text_contents(text)
        return {"ok": bool(result), "effect": "DISPATCHED" if result else "NOT_CONFIRMED",
                "valueRead": False}
    if command == "invoke":
        if role not in ACT_ROLES or not node.is_action():
            fail("NOT_BUTTON")
        action = node.get_action_iface()
        methods = [action.get_action_name(i) for i in range(min(action.get_n_actions(), 4))]
        allowed = ("check",) if role == "check box" else ("click", "press")
        matches = [i for i, x in enumerate(methods) if x in allowed]
        if len(matches) != 1:
            fail("ACTION_AMBIGUOUS")
        result = action.do_action(matches[0])
        return {"ok": bool(result), "effect": "DISPATCHED" if result else "NOT_CONFIRMED"}
    fail("UNKNOWN_COMMAND")


if __name__ == "__main__":
    try:
        data = sys.stdin.read(12000)
        request = json.loads(data)
        result = execute(request)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        code = str(error)
        if not code.startswith("ATSPI_"):
            code = "ATSPI_NATIVE_UNVERIFIED_" + type(error).__name__
        print(json.dumps({"ok": False, "error": code, "effect": "UNKNOWN"}))
        sys.exit(2)
