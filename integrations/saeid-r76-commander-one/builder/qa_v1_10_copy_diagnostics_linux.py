"""V1-10 native GTK Clipboard integration against a disposable owner-local CLI."""
from pathlib import Path
import os, tempfile, time, json
import gi
gi.require_version("Gtk","4.0")
from gi.repository import Gtk, GLib, Gdk
from managed_controls import launch_window, CATEGORIES
with tempfile.TemporaryDirectory(prefix="commander-v110-copy-",dir=Path.home()) as name:
    root=Path(name)
    (root/"state/profiles").mkdir(parents=True)
    (root/"bin").mkdir()
    (root/"product.json").write_text('{"schema":1,"product":"ChatGPTRemoteCommander"}')
    (root/"state/profiles/default.json").write_text("{}")
    (root/"Commander.cjs").write_text("// scoped QA fixture")
    exe=root/"bin/node"
    exe.write_text("""#!/usr/bin/env python3
import sys,json
action=sys.argv[2]
if action=="--status":
    record={"ok":True,"product":"ChatGPTRemoteCommander","build":"qa11","mode":"standard","profiles":["default"]}
elif action=="--runtime-status":
    record={"ok":True,"profile":"default","running":False,"verified":False}
elif action=="--autostart-status":
    record={"ok":True,"profile":"default","autostartEnabled":False,"reconcileRequired":False}
else:
    sys.exit(2)
record["token"]="QA11_CLIPBOARD_SECRET_SENTINEL"
record["nested"]={"password":"QA11_CLIPBOARD_SECRET_NESTED"}
print(json.dumps(record))
""")
    exe.chmod(0o700)
    window=launch_window(root,("default",),"default")
    def walk(w):
        yield w
        c=w.get_first_child()
        while c:
            yield from walk(c)
            c=c.get_next_sibling()
    copy=[x for x in walk(window) if isinstance(x,Gtk.Button) and x.get_label()=="Copy diagnostics"]
    assert len(copy)==1,"COPY_BUTTON_MISSING"
    status=[x for x in walk(window) if isinstance(x,Gtk.Label) and x.has_css_class("commander-status")]
    assert len(status)==1,"STATUS_QUERY_NOT_STARTED"
    clipboard=Gdk.Display.get_default().get_clipboard()
    state={"step":0, "content":None, "error":None}
    loop=GLib.MainLoop()
    started=time.monotonic()
    def on_read(clipboard, async_result):
        try:
            state["content"]=clipboard.read_text_finish(async_result)
        except Exception as exc:
            state["error"]=repr(exc)
    def tick():
        try:
            if time.monotonic()-started>7:
                raise TimeoutError("QA11_GTK_COPY_TIMEOUT: "+str(state))
            if (state["step"]==0 and copy[0].get_sensitive() and
                    status[0].get_label().startswith("default: observed ")):
                copy[0].emit("clicked")
                assert status[0].get_label()=="Local diagnostics copied (no raw CLI output)"
                clipboard.read_text_async(None,on_read)
                state["step"]=1
            if state["step"]==1 and state["content"] is not None:
                report=state["content"]
                assert "QA11_CLIPBOARD_SECRET" not in report, "SECRET_FIELD_EXPORTED"
                assert "token" not in report.lower() and "password" not in report.lower()
                assert "Selected managed profile: default" in report
                assert "Local preview / build qa11" in report
                assert "Backend stopped (CLI reported)" in report
                assert "NOT evidence of authenticated remote identity" in report
                assert all("\n"+c+"\n" in report for c in CATEGORIES)
                state["step"]=2
                print("QA11_GTK_REAL_CLIPBOARD_REPORT_ALL_12_CARDS_PASS",flush=True)
                window.close()
                loop.quit()
                return False
            if state["error"]:
                raise RuntimeError(state["error"])
        except Exception as exc:
            state["error"]=repr(exc)
            window.close()
            loop.quit()
            return False
        return True
    GLib.timeout_add(40,tick)
    loop.run()
    if state["error"]: raise RuntimeError(state["error"])
    assert state["step"]==2,state
    print("QA11_GTK_NO_SECRET_IN_ACTUAL_CLIPBOARD_PASS",flush=True)
