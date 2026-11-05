#!/usr/bin/env python3
"""Exercise actual packaged GTK managed profile button events in isolated Xvfb.
Uses a temporary owner-local installation; performs no actions on live profiles.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

def command(args, check=True, timeout=35):
    completed=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
    if check and completed.returncode:
        raise RuntimeError('GTK_QA_COMMAND_FAILED:'+completed.stderr[-700:])
    return completed

def internal(root):
    import gi
    gi.require_version("Gtk","4.0")
    gi.require_version("Adw","1")
    from gi.repository import GLib,Gtk
    sys.path.insert(0,str(root/"app/desktop/linux-control-center"))
    from managed_controls import managed_root,available_profiles,install_managed_controls
    assert managed_root()==root
    profiles=available_profiles(root)
    assert set(profiles)=={"default","MMZ"}
    box=Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
    assert install_managed_controls(box,Gtk,GLib)
    panel=box.get_first_child()
    def walk(item):
        out=[]
        while item is not None:
            out.append(item)
            child=item.get_first_child()
            if child is not None:out.extend(walk(child))
            item=item.get_next_sibling()
        return out
    widgets=walk(panel)
    buttons={b.get_label():b for b in widgets if isinstance(b,Gtk.Button) and isinstance(b.get_label(),str)}
    results=[w for w in widgets if isinstance(w,Gtk.Label) and w.get_selectable()]
    assert {"Start","Status","Stop"}<=buttons.keys()
    assert len(results)==1
    selection=profiles[0]
    result=results[0]
    def await_receipt(action,value):
        match="VERIFIED • "+selection+" • "+action
        until=time.monotonic()+17
        while time.monotonic()<until:
            while GLib.MainContext.default().pending():
                GLib.MainContext.default().iteration(False)
            state=result.get_text()
            if match in state and value in state:return state
            time.sleep(.05)
        raise RuntimeError('GTK_ACTION_UNVERIFIED:'+result.get_text()[:650])
    buttons["Start"].emit("clicked")
    start=await_receipt("start",'"started": true')
    buttons["Status"].emit("clicked")
    status=await_receipt("runtime-status",'"running": true')
    buttons["Stop"].emit("clicked")
    assert "Click Stop again" in result.get_text()
    buttons["Stop"].emit("clicked")
    stop=await_receipt("stop",'"stopped": true')
    print(json.dumps({"status":"GTK_REAL_BUTTON_EVENTS_PASS",
      "selectedProfile":selection,"buttons":sorted(buttons),
      "startVerified":True,"statusVerified":True,
      "explicitStopConfirm":True,"stopVerified":True,"managedOnly":True}))
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--installer",type=Path)
    parser.add_argument("--internal-root",type=Path)
    args=parser.parse_args()
    if args.internal_root:
        internal(args.internal_root.resolve())
        return
    if not args.installer or not args.installer.is_file():
        raise RuntimeError("GTK_INSTALLER_MISSING")
    if os.name!="posix":
        raise RuntimeError("GTK_QA_ONLY_LINUX")
    with tempfile.TemporaryDirectory(prefix="commander-one-gtk-r40-",dir=Path.home()/".cache") as tmp:
        root=Path(tmp)/"installed"
        source=str(args.installer.resolve())
        command([source,"--install","--target",str(root)],timeout=60)
        cli=[str(root/"bin/node"),str(root/"Commander.cjs")]
        command(cli+["--add-profile","--profile","MMZ","--target",str(root)])
        env=os.environ.copy()
        env["COMMANDER_ONE_MANAGED_ROOT"]=str(root)
        program=["dbus-run-session","--","xvfb-run","-a","-s",
                 "-screen 0 1280x800x24",sys.executable,"-B",str(Path(__file__).resolve()),
                 "--internal-root",str(root)]
        try:
            outcome=subprocess.run(program,env=env,text=True,capture_output=True,timeout=40)
            if outcome.returncode or "GTK_REAL_BUTTON_EVENTS_PASS" not in outcome.stdout:
                raise RuntimeError("GTK_REAL_NATIVE_UI_FAIL:"+outcome.stdout[-350:]+outcome.stderr[-650:])
            print(outcome.stdout.strip().splitlines()[-1])
        finally:
            for profile in ("MMZ","default"):
                command(cli+["--stop","--target",str(root),"--profile",profile],check=False)
            controls=root/"state/controls"
            for _ in range(40):
                if not any(controls.glob("*.json")):break
                time.sleep(.1)
            if any(controls.glob("*.json")):
                raise RuntimeError("GTK_TEST_PROCESS_NOT_STOPPED_REFUSE_CLEAN")
    print("GTK_OWNER_QA_STATE_REMOVED")
if __name__=="__main__":
    main()
