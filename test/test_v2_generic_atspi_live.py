"""Disposable isolated-Xvfb generic GTK3 AT-SPI E2E, no primary desktop input.

Run via: dbus-run-session -- /usr/bin/python3 test/test_v2_generic_atspi_live.py
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPER = ROOT / "tools" / "owner-atspi-semantic.py"
TITLE = "Commander Generic QA"

def fixture(ready, outcome):
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import GLib, Gtk
    GLib.set_prgname("CommanderGenericQAFixture")
    win = Gtk.Window(title=TITLE)
    win.set_default_size(320, 120)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
    entry = Gtk.Entry()
    entry.set_text("")
    entry.set_placeholder_text("Query field")
    button = Gtk.Button(label="Apply")
    def applied(_):
        pathlib.Path(outcome).write_text("APPLY_CLICKED", encoding="utf-8")
        Gtk.main_quit()
    button.connect("clicked", applied)
    box.pack_start(entry, True, True, 0)
    box.pack_start(button, False, False, 0)
    win.add(box)
    win.connect("destroy", Gtk.main_quit)
    win.show_all()
    pathlib.Path(ready).write_text("READY", encoding="utf-8")
    Gtk.main()

def main():
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        raise RuntimeError("ISOLATED_DBUS_SESSION_REQUIRED")
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
    xvfb = None
    child = None
    try:
        xvfb = subprocess.Popen(["/usr/bin/Xvfb", "-displayfd", "1",
          "-screen", "0", "1024x768x24", "-nolisten", "tcp"],
          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        number = xvfb.stdout.readline().strip()
        if not number.isdecimal():
            raise RuntimeError("XVFB_DISPLAY_UNAVAILABLE")
        env = dict(os.environ, DISPLAY=":" + number,
                   NO_AT_BRIDGE="0", GTK_MODULES="gail:atk-bridge")
        with tempfile.TemporaryDirectory(prefix="v2-atspi-qa-") as private:
            ready = str(pathlib.Path(private) / "ready")
            outcome = str(pathlib.Path(private) / "result")
            child = subprocess.Popen(["/usr/bin/python3", __file__, "--fixture",
                ready, outcome], env=env, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL)
            start = time.monotonic()
            while not pathlib.Path(ready).exists() and time.monotonic()-start < 5:
                if child.poll() is not None:
                    raise RuntimeError("GTK_FIXTURE_EXITED")
                time.sleep(0.05)
            if not pathlib.Path(ready).exists():
                raise RuntimeError("GTK_FIXTURE_START_TIMEOUT")
            pid=child.pid
            app_name=None
            while time.monotonic()-start < 7 and not app_name:
                desktop=Atspi.get_desktop(0)
                for i in range(min(desktop.get_child_count(),100)):
                    app=desktop.get_child_at_index(i)
                    if app.get_process_id()==pid:
                        app_name=app.get_name()
                        break
                if not app_name:
                    time.sleep(0.1)
            if not app_name:
                raise RuntimeError("ATSPI_OWNER_APPLICATION_MISSING")
            with open("/proc/%d/stat" % pid,encoding="ascii") as f:
                row=f.read()
            ticks=row[row.rfind(")")+1:].split()[19]
            def query(command, **kw):
                request={"command":command,"pid":pid,"windowTitle":TITLE,
                    "expectedApp":app_name,"expectedStartTicks":ticks,**kw}
                p=subprocess.run(["/usr/bin/python3",str(HELPER)],input=json.dumps(request),
                    encoding="utf-8",capture_output=True,env=env,timeout=5)
                result=json.loads(p.stdout)
                if p.returncode!=0 or result.get("ok") is not True:
                    raise RuntimeError("AT_SPI_%s_FAILED:%s" % (command,result.get("error")))
                return result
            found=None
            while time.monotonic()-start < 9:
                snap=query("snapshot")
                found=next((item for item in snap["controls"] if item["name"]=="Apply"
                  and item["action"] in ("click","press")),None)
                if found:
                    break
                time.sleep(0.1)
            if not found:
                raise RuntimeError("APPLY_ACCESSIBLE_CONTROL_MISSING")
            act=query("invoke",path=found["path"],expectedRole=found["role"],
                      expectedName=found["name"])
            if act.get("effect")!="DISPATCHED":
                raise RuntimeError("AT_SPI_EFFECT_NOT_DISPATCHED")
            child.wait(timeout=4)
            if pathlib.Path(outcome).read_text(encoding="utf-8")!="APPLY_CLICKED":
                raise RuntimeError("INDEPENDENT_APPLY_PROOF_MISSING")
            print("ISOLATED_GENERIC_GTK3_ATSPI_E2E_PASS")
            print("same_owner=True; kernel_start_ticks_verified=True; exit=0; outcome=APPLY_CLICKED")
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            try: child.wait(timeout=2)
            except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=2)
        if xvfb is not None and xvfb.poll() is None:
            xvfb.terminate()
            try: xvfb.wait(timeout=2)
            except subprocess.TimeoutExpired: xvfb.kill(); xvfb.wait(timeout=2)

if __name__ == "__main__":
    if len(sys.argv)==4 and sys.argv[1]=="--fixture":
        fixture(sys.argv[2],sys.argv[3])
    elif len(sys.argv)==1:
        main()
    else:
        raise SystemExit(2)
