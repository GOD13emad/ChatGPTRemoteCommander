"""Real V2 Bridge->NativeDriver->AT-SPI GTK3 E2E on a private Xvfb seat.

No production GUI/session/app is accessed. Run under dbus-run-session.
"""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

ROOT=pathlib.Path(__file__).resolve().parents[1]
TITLE="Commander Bridge QA"

def fixture(ready,proof):
    import gi
    gi.require_version("Gtk","3.0")
    from gi.repository import GLib,Gtk
    GLib.set_prgname("CommanderBridgeQAFixture")
    window=Gtk.Window(title=TITLE)
    window.set_default_size(340,140)
    box=Gtk.Box(orientation=Gtk.Orientation.VERTICAL,spacing=12)
    button=Gtk.Button(label="Apply")
    def applied(_):
        pathlib.Path(proof).write_text("APPLY_CLICKED",encoding="utf-8")
    button.connect("clicked",applied)
    box.pack_start(button,True,True,10)
    window.add(box)
    window.connect("destroy",Gtk.main_quit)
    window.show_all()
    pathlib.Path(ready).write_text("READY",encoding="utf-8")
    Gtk.main()

def main():
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        raise RuntimeError("PRIVATE_DBUS_SESSION_REQUIRED")
    import gi
    gi.require_version("Atspi","2.0")
    from gi.repository import Atspi
    xvfb=None
    app=None
    try:
        xvfb=subprocess.Popen(["/usr/bin/Xvfb","-displayfd","1",
          "-screen","0","1024x768x24","-nolisten","tcp"],
          stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
        display=xvfb.stdout.readline().strip()
        if not display.isdecimal():
            raise RuntimeError("XVFB_DISPLAY_UNAVAILABLE")
        env={**os.environ,"DISPLAY":":"+display,
          "GTK_MODULES":"gail:atk-bridge","NO_AT_BRIDGE":"0"}
        with tempfile.TemporaryDirectory(prefix="v2-atspi-bridge-") as qa:
            ready=str(pathlib.Path(qa)/"ready")
            proof=str(pathlib.Path(qa)/"applied")
            app=subprocess.Popen(["/usr/bin/python3",__file__,"--fixture",
               ready,proof],env=env,stdout=subprocess.DEVNULL,
               stderr=subprocess.DEVNULL)
            deadline=time.monotonic()+8
            while time.monotonic()<deadline and not pathlib.Path(ready).exists():
                if app.poll() is not None:raise RuntimeError("GTK_FIXTURE_EARLY_EXIT")
                time.sleep(0.08)
            if not pathlib.Path(ready).exists():
                raise RuntimeError("GTK_FIXTURE_NOT_READY")
            name=None
            while time.monotonic()<deadline and not name:
                desktop=Atspi.get_desktop(0)
                for i in range(min(desktop.get_child_count(),100)):
                    candidate=desktop.get_child_at_index(i)
                    if candidate.get_process_id()==app.pid:
                        name=(candidate.get_name() or "").strip()
                        break
                if not name:time.sleep(0.08)
            if not name:raise RuntimeError("AT_SPI_APP_ID_UNAVAILABLE")
            stat=pathlib.Path("/proc/%d/stat"%app.pid).read_text(encoding="ascii")
            ticks=stat[stat.rfind(")")+1:].split()[19]
            handles=subprocess.check_output(["/usr/bin/xdotool","search","--pid",
                 str(app.pid),"--name",TITLE],env=env,timeout=3,text=True).splitlines()
            # GTK creates an unmapped helper window carrying the application
            # name. Select only the visible, exact-title, same-process X11 window.
            verified=[]
            for candidate in handles:
                if not candidate.isdecimal():continue
                name=subprocess.check_output(["/usr/bin/xdotool","getwindowname",candidate],
                    env=env,timeout=2,text=True).strip()
                pid_of_window=subprocess.check_output(["/usr/bin/xdotool","getwindowpid",candidate],
                    env=env,timeout=2,text=True).strip()
                info=subprocess.check_output(["/usr/bin/xwininfo","-id",candidate],
                    env=env,timeout=2,text=True)
                if name==TITLE and pid_of_window==str(app.pid) and "Map State: IsViewable" in info:
                    verified.append(candidate)
            if len(verified)!=1:
                raise RuntimeError("QA_VISIBLE_OWNER_WINDOW_NOT_UNIQUE")
            handles=verified
            # GTK's accessible application name is the process name set
            # before window creation, not necessarily the title exposed by
            # the outer AT-SPI observer.
            name="CommanderBridgeQAFixture"
            preflight=subprocess.run(["/usr/bin/python3",str(ROOT/"tools/owner-atspi-semantic.py")],
                input=json.dumps({"command":"snapshot","pid":app.pid,"windowTitle":TITLE,
                  "expectedApp":name,"expectedStartTicks":ticks}),env=env,
                capture_output=True,text=True,timeout=5)
            if preflight.returncode!=0:
                raise RuntimeError("DIRECT_NATIVE_PREFLIGHT_FAILED: %s; app=%r" %
                    (preflight.stdout.strip(),name))
            result=subprocess.run(["node",str(ROOT/("test/v2-linux-owner-gui-worker-live.mjs" if
                os.environ.get("V2_QA_WORKER_MODE")=="owner-worker" else
                "test/v2-linux-atspi-bridge-live.mjs")),
                str(app.pid),name,ticks,handles[0],proof],env=env,
                encoding="utf-8",capture_output=True,timeout=15)
            if result.returncode!=0:
                raise RuntimeError("BRIDGE_E2E_FAILED: "+(result.stderr or result.stdout)[-1800:])
            expected_marker=(
                "V2_LINUX_OWNER_SESSION_CENTRAL_FENCE_E2E_PASS"
                if os.environ.get("V2_QA_WORKER_MODE")=="owner-worker"
                   and os.environ.get("V2_QA_COORDINATOR_MODE")=="central"
                else "V2_LINUX_OWNER_SESSION_WORKER_E2E_PASS"
                if os.environ.get("V2_QA_WORKER_MODE")=="owner-worker"
                else "V2_LINUX_ATSPI_NATIVE_BRIDGE_E2E_PASS")
            if expected_marker not in result.stdout:
                raise RuntimeError("BRIDGE_E2E_RECEIPT_MISSING: %s" %
                    result.stdout[-1000:])
            if pathlib.Path(proof).read_text(encoding="utf-8")!="APPLY_CLICKED":
                raise RuntimeError("INDEPENDENT_PROOF_INVALID")
            if app.poll() is not None:
                raise RuntimeError("QA_WINDOW_DID_NOT_PERSIST_THROUGH_VERIFICATION")
            print(result.stdout.strip())
            print("isolated_xvfb=true; owner_pid=%d; callback=APPLY_CLICKED"%app.pid)
    finally:
        if app and app.poll() is None:
            app.terminate()
            try:app.wait(timeout=2)
            except subprocess.TimeoutExpired:app.kill();app.wait(timeout=2)
        if xvfb and xvfb.poll() is None:
            xvfb.terminate()
            try:xvfb.wait(timeout=2)
            except subprocess.TimeoutExpired:xvfb.kill();xvfb.wait(timeout=2)

if __name__=="__main__":
    if len(sys.argv)==4 and sys.argv[1]=="--fixture":
        fixture(sys.argv[2],sys.argv[3])
    elif len(sys.argv)==1:
        main()
    else:
        raise SystemExit(2)
