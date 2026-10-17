"""Test-only forged GTK signal harness over a REAL authenticated Unix socket.

Not an actual display/mouse acceptance test. Never touches installed state.
"""
import importlib.util
import json
import pathlib
import sqlite3
import sys
import time
import urllib.parse

repo = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo / 'desktop/linux-control-center'))
from native_management import NativeManagementController
from native_management_view import attach_management_view
from test_native_management_view import Gtk, Adw, GLib, Dialog, Center, await_state

module_path = repo / 'tools/local-management-linux.py'
spec = importlib.util.spec_from_file_location('rc_client', module_path)
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


def run(descriptor):
    target = descriptor["target"]
    db = pathlib.Path(descriptor["db"])
    assert db.is_file() and not db.is_symlink()
    url = "file:" + urllib.parse.quote(str(db), safe="/") + "?mode=ro"
    def read_scoped():
        con = sqlite3.connect(url, uri=True, timeout=1)
        try:
            con.execute("PRAGMA query_only=ON")
            rows = con.execute('SELECT id,revision,snapshot FROM workflows LIMIT 300').fetchall()
            return {"schema":1,"target":target,"records":[
                {"id":name,"revision":revision,"state":json.loads(blob)["lifecycleState"],
                 "profileId":target["profileId"]} for name,revision,blob in rows]}
        finally:
            con.close()

    with transport.NativeClient(descriptor["endpoint"], descriptor["serverPid"], target, timeout=3) as client:
        controller = NativeManagementController(client, read_scoped)
        center = Center()
        view = attach_management_view(center, controller, Gtk, Adw, GLib)
        initial = read_scoped()["records"][0]
        before_buttons = len(view.buttons)
        assert initial["revision"] == 1 and before_buttons == 2
        verb = descriptor["action"]
        index = 0 if verb == "pause" else 1
        button = view.buttons[index]
        button.emit("clicked")
        assert Dialog.last is not None and Dialog.last.default == "dismiss"
        assert "Device: fixture" in Dialog.last.body and "Revision: 1" in Dialog.last.body
        assert read_scoped()["records"][0]["revision"] == 1, "A click must not dispatch"
        mode = descriptor["mode"]
        Dialog.last.response("confirm" if mode == "confirm" else "dismiss")
        if mode == "confirm":
            await_state(view, "APPLIED")
        result = read_scoped()["records"][0]
        output = {
            "mode":mode,"action":verb,
            "initialRevision":initial["revision"],"finalRevision":result["revision"],
            "finalState":result["state"],"feedback":view.note.text,
            "confirmationDialog":True,"targetConfirmed":True,
            "nativePeerUid":__import__('os').getuid(),
            "viewStatus":"ISOLATED_SYNTHETIC_GTK_SIGNAL_NOT_NATIVE_RENDER"
        }
        view.close()
        return output


try:
    descriptor = transport.strict_json(sys.stdin.buffer.readline(65536))
    print(json.dumps(run(descriptor), separators=(',',':')))
except Exception:
    print(json.dumps({"error":"MANAGEMENT_SYNTHETIC_GTK_BRIDGE_FAILED"}))
    sys.exit(2)
