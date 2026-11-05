"""V1-10: closing a live GTK owner window cancels only its private slow CLI."""
from pathlib import Path
import os, tempfile, time, threading
import gi
gi.require_version("Gtk","4.0")
from gi.repository import Gtk, GLib
from managed_controls import install_managed_controls
with tempfile.TemporaryDirectory(prefix="commander-v110-qa10-",dir=Path.home()) as directory:
    root=Path(directory)
    (root/"state/profiles").mkdir(parents=True)
    (root/"bin").mkdir()
    (root/"product.json").write_text('{"schema":1,"product":"ChatGPTRemoteCommander"}')
    (root/"state/profiles/default.json").write_text("{}")
    (root/"Commander.cjs").write_text("// slow private CLI fixture")
    stub=root/"bin/node"
    stub.write_text("""#!/usr/bin/env python3
import sys,os,time,json
from pathlib import Path
root=Path(sys.argv[4])
(root/"child-started").write_text(str(os.getpid()))
time.sleep(12)
(root/"child-finished").write_text("unexpected")
print(json.dumps({"ok":True,"profile":"default","started":True,"verifiedHealth":True}))
""")
    stub.chmod(0o700)
    os.environ["COMMANDER_ONE_MANAGED_ROOT"]=str(root)
    window=Gtk.Window(title="V1-10 close while CLI busy - isolated Xvfb")
    panel=Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
    window.set_child(panel)
    assert install_managed_controls(panel,Gtk,GLib)
    def walk(obj):
        yield obj
        child=obj.get_first_child()
        while child:
            yield from walk(child)
            child=child.get_next_sibling()
    start=[x for x in walk(panel) if isinstance(x,Gtk.Button) and x.get_label()=="Start"]
    picker=[x for x in walk(panel) if isinstance(x,Gtk.DropDown)]
    assert len(start)==1 and len(picker)==1
    loop=GLib.MainLoop()
    begun=time.monotonic()
    state={"phase":0,"pid":None,"errors":[]}
    def tick():
        try:
            if time.monotonic()-begun > 6:
                raise TimeoutError("GTK_CLOSE_TEST_TIMEOUT "+str(state))
            marker=root/"child-started"
            if state["phase"]==0:
                start[0].emit("clicked")
                assert not picker[0].get_sensitive()
                state["phase"]=1
            elif state["phase"]==1 and marker.exists():
                state["pid"]=int(marker.read_text())
                window.close()
                state["phase"]=2
                print("QA10_GTK_CLOSE_SENT_DURING_REAL_SLOW_START",flush=True)
            elif state["phase"]==2:
                # The cancelled private CLI should be reaped by the worker.
                try:
                    os.kill(state["pid"],0)
                    exists=True
                except ProcessLookupError:
                    exists=False
                if not exists:
                    assert not (root/"child-finished").exists()
                    state["phase"]=3
                    print("QA10_GTK_SLOW_CLI_CHILD_KILLED_AFTER_CLOSE_PASS",flush=True)
                    loop.quit()
                    return False
        except Exception as exc:
            state["errors"].append(repr(exc))
            loop.quit()
            return False
        return True
    window.present()
    GLib.timeout_add(50,tick)
    loop.run()
    if state["errors"]: raise RuntimeError(";".join(state["errors"]))
    assert state["phase"]==3, state
    print("QA10_GTK_NO_INFLIGHT_ACTION_AFTER_WINDOW_CLOSE_PASS",flush=True)

    # The separate read-only Control Center must not post an observation into
    # a destroyed window when an in-progress data collection completes.
    import managed_controls as center_mod
    from datetime import datetime, timezone
    collected=threading.Event()
    original=center_mod.collect
    def delayed_read(_root, name):
        collected.set()
        time.sleep(0.65)
        return center_mod.Observation(datetime.now(timezone.utc).isoformat(),
                   name, {"Managed host":"QA10_NEVER_SHOW_AFTER_CLOSE"}, ())
    center_mod.collect=delayed_read
    center=None
    try:
        center=center_mod.launch_window(root,("default",),"default")
        frames=[obj for obj in walk(center) if isinstance(obj,Gtk.Frame)]
        host=[f.get_child() for f in frames if f.get_label()=="Managed host"]
        assert len(host)==1
        context=GLib.MainContext.default()
        until=time.monotonic()+3
        while not collected.is_set() and time.monotonic()<until:
            while context.pending(): context.iteration(False)
            time.sleep(0.01)
        assert collected.is_set(), "CENTER_REFRESH_THREAD_NOT_STARTED"
        center.close()
        deadline=time.monotonic()+1.3
        while time.monotonic()<deadline:
            while context.pending(): context.iteration(False)
            time.sleep(0.01)
        assert host[0].get_label()==center_mod.UNAVAILABLE, "LATE_CENTER_OBSERVATION_VISIBLE"
        print("QA10_GTK_CONTROL_CENTER_LATE_OBSERVATION_DROPPED_PASS",flush=True)
    finally:
        center_mod.collect=original
        if center is not None: center.close()
