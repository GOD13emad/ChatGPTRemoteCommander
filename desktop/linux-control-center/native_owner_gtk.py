#!/usr/bin/python3
"""Source-only, explicit owner-console GTK entrypoint attached to resident Core.

Never imports, launches or duplicates a WorkflowStore engine. The trusted Core
parent supplies a bounded descriptor through an inherited pipe *only* after it
spawns this specific owner GUI child and pins its OS PID to Linux SO_PEERCRED.
Neither browsing/remote MCP content nor dashboard UI creates a management key.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import urllib.parse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from control_center import (APP_ID, monitor_status, profiles, workflows,
                            autofollow_status, effective_system_dark, unique_json_pairs)
from dashboard_ui import run_dashboard
from native_management import NativeManagementController
from native_management_outbox import NativeRequestOutbox

_SPEC = importlib.util.spec_from_file_location("trusted_rc_native_client",
                                                ROOT / "tools/local-management-linux.py")
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError("MANAGEMENT_NATIVE_SCRIPT_NOT_AVAILABLE")
_TRANSPORT = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_TRANSPORT)


def _file(path):
    if type(path) is not str or not os.path.isabs(path) or "\0" in path:
        raise ValueError("MANAGEMENT_WORKFLOW_DB_UNVERIFIED")
    p = Path(path)
    if p != p.resolve(strict=True) or p.name != "workflows.sqlite":
        raise ValueError("MANAGEMENT_WORKFLOW_DB_UNVERIFIED")
    directory = p.parent
    st = directory.lstat()
    if (not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid()
            or st.st_mode & 0o077):
        raise ValueError("MANAGEMENT_WORKFLOW_DB_UNVERIFIED")
    record = p.lstat()
    if (not stat.S_ISREG(record.st_mode) or record.st_uid != os.getuid()
            or record.st_mode & 0o077 or record.st_nlink != 1):
        raise ValueError("MANAGEMENT_WORKFLOW_DB_UNVERIFIED")
    return p


def _descriptor():
    raw = sys.stdin.buffer.readline(8193)
    if not raw.endswith(b"\n") or len(raw) > 8192:
        raise ValueError("MANAGEMENT_PARENT_BOOTSTRAP_UNVERIFIED")
    desc = _TRANSPORT.strict_json(raw)
    if type(desc) is not dict or set(desc) != {
            "schema", "endpoint", "serverPid", "target", "workflowDb", "outboxDir"}:
        raise ValueError("MANAGEMENT_PARENT_BOOTSTRAP_UNVERIFIED")
    if type(desc["schema"]) is not int or desc["schema"] != 1:
        raise ValueError("MANAGEMENT_PARENT_BOOTSTRAP_UNVERIFIED")
    target = _TRANSPORT.target_record(desc["target"])
    if type(desc["outboxDir"]) is not str or not Path(desc["outboxDir"]).is_absolute():
        raise ValueError("MANAGEMENT_OUTBOX_DIRECTORY_UNTRUSTED")
    # Even after accepting a descriptor, NO effect is possible before
    # NativeClient verifies the real server PID and current session target.
    return desc, target, _file(desc["workflowDb"])


def _read_workflow_rows(db, target):
    if not db.is_file() or db.is_symlink():
        raise ValueError("MANAGEMENT_WORKFLOW_DB_UNVERIFIED")
    uri = "file:" + urllib.parse.quote(str(db), safe="/") + "?mode=ro"
    with sqlite3.connect(uri, uri=True, timeout=1) as con:
        con.execute("PRAGMA query_only=ON")
        rows = con.execute("SELECT id,revision,snapshot FROM workflows ORDER BY id LIMIT 301").fetchall()
        if len(rows) > 300:
            raise ValueError("MANAGEMENT_WORKFLOW_LIMIT")
        entries = []
        for name, revision, snapshot in rows:
            item = json.loads(snapshot, object_pairs_hook=unique_json_pairs)
            # Snapshot content is untrusted data, not a profile or device
            # authority. Reject the entire inventory if one row is unbound.
            # The resident Core still verifies its own journal at mutation.
            if (type(item) is not dict or
                    type(item.get("schema")) is not int or item["schema"] not in (1, 2) or
                    type(name) is not str or item.get("id") != name or
                    type(revision) is not int or not 1 <= revision <= 10000 or
                    type(item.get("revision")) is not int or item["revision"] != revision or
                    type(item.get("device")) is not str or item["device"] != target["deviceId"] or
                    type(item.get("configSha256")) is not str or
                    item["configSha256"] != target["configSha256"] or
                    type(item.get("authority")) is not dict or
                    type(item["authority"].get("profileId")) is not str or
                    item["authority"]["profileId"] != target["profileId"] or
                    type(item.get("lifecycleState")) is not str or
                    not 0 < len(item["lifecycleState"]) <= 40):
                raise ValueError("MANAGEMENT_WORKFLOW_SCOPE_UNVERIFIED")
            entries.append({"id": name, "revision": revision,
                            "state": item["lifecycleState"],
                            "profileId": target["profileId"]})
        return {"schema": 1, "target": target, "records": entries}


def main():
    if (sys.platform != "linux" or not hasattr(os, "getuid")
            or os.getuid() == 0 or os.getuid() != os.geteuid()):
        raise ValueError("MANAGEMENT_OWNER_REQUIRED")
    desc, target, db = _descriptor()
    with _TRANSPORT.NativeClient(desc["endpoint"], desc["serverPid"], target, timeout=5) as client:
        box = NativeRequestOutbox(desc["outboxDir"], target)
        try:
            controller = NativeManagementController(
                client, lambda: _read_workflow_rows(db, target), outbox=box)
            # Separate Application ID avoids silently activating an already
            # running read-only instance under the existing app identity.
            return run_dashboard(APP_ID + ".NativePreview",
                                 monitor_status, profiles, workflows,
                                 autofollow_status, effective_system_dark,
                                 argv=["native-owner-preview"],
                                 management_controller=controller)
        finally:
            box.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        # Do not write private paths, database content, workflow identity,
        # session keys, cookies or raw descriptor data to stdout/stderr.
        sys.stderr.write("MANAGEMENT_NATIVE_OWNER_GUI_UNAVAILABLE\n")
        raise SystemExit(2)
