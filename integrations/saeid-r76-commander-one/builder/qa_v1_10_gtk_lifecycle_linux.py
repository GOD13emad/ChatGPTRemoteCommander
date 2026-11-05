"""GTK4 event verification against a disposable owner-local fake CLI."""
from pathlib import Path
import os
import tempfile
import time
import gi
gi.require_version("Gtk","4.0")
from gi.repository import Gtk, GLib
from managed_controls import install_managed_controls
with tempfile.TemporaryDirectory(prefix="commander-v110-qa7-",dir=Path.home()) as folder:
    root=Path(folder)
    (root/"state/profiles").mkdir(parents=True)
    (root/"bin").mkdir()
    (root/"product.json").write_text('{"schema":1,"product":"ChatGPTRemoteCommander"}')
    (root/"state/profiles/default.json").write_text("{}")
    (root/"state/profiles/other.json").write_text("{}")
    (root/"Commander.cjs").write_text("// bounded GUI test stub")
    (root/"mode.txt").write_text("forged")
    cli=root/"bin/node"
    cli.write_text("""#!/usr/bin/env python3
import pathlib,json,sys
root=pathlib.Path(sys.argv[4])
action=sys.argv[2]
mode=(root/"mode.txt").read_text()
if action=="--start":
    obj={"ok":True} if mode=="forged" else {"ok":True,"profile":"default","started":True,"verifiedHealth":True}
elif action=="--stop":
    obj={"ok":True,"profile":"default","stopped":True,"verifiedIdentity":True}
else:
    obj={"ok":True,"profile":"default","running":False,"verified":False}
obj["controlToken"]="QA8_SECRET_SENTINEL"
obj["nested"]={"password":"QA8_SECRET_NESTED"}
print(json.dumps(obj))
""")
    cli.chmod(0o700)
    os.environ["COMMANDER_ONE_MANAGED_ROOT"]=str(root)
    win=Gtk.Window(title="V1-10 lifecycle button QA / isolated Xvfb")
    win.set_default_size(780,500)
    parent=Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
    win.set_child(parent)
    assert install_managed_controls(parent,Gtk,GLib)
    def walk(w):
        yield w
        c=w.get_first_child()
        while c:
            yield from walk(c)
            c=c.get_next_sibling()
    buttons={b.get_label():b for b in walk(parent) if isinstance(b,Gtk.Button) and b.get_label() in ("Start","Status","Stop","Control Center")}
    labels=[l for l in walk(parent) if isinstance(l,Gtk.Label) and (l.get_label() or "").startswith("Select an action.")]
    assert len(buttons)==4 and len(labels)==1
    pickers=[w for w in walk(parent) if isinstance(w,Gtk.DropDown)]
    assert len(pickers)==1
    picker=pickers[0]
    assert picker.get_selected()==0 and picker.get_sensitive()
    scope_transitions={"locked":0,"unlocked":0}
    def on_scope(_widget,_property):
        if picker.get_sensitive(): scope_transitions["unlocked"]+=1
        else: scope_transitions["locked"]+=1
    picker.connect("notify::sensitive",on_scope)
    result=labels[0]
    loop=GLib.MainLoop()
    errors=[]
    step=[0]
    start=time.monotonic()
    def poll():
        try:
            if time.monotonic()-start>7:
                raise TimeoutError("GTK_TEST_TIMED_OUT phase="+str(step[0])+" text="+result.get_label()[:140])
            label=result.get_label() or ""
            if "QA8_SECRET" in label or "controlToken" in label or "password" in label:
                raise AssertionError("QA8_RAW_CLI_SECRET_VISIBLE_IN_NATIVE_GTK")
            if step[0]==0:
                buttons["Stop"].emit("clicked")
                assert result.get_label().startswith("Click Stop again to confirm")
                picker.set_selected(1)  # change away from default
                picker.set_selected(0)  # change back must not preserve consent
                buttons["Stop"].emit("clicked")
                assert result.get_label().startswith("Click Stop again to confirm"), "STALE_STOP_CONFIRMATION_ACCEPTED"
                print("V110_GTK_STOP_CONFIRMATION_REVOKED_ON_PROFILE_CHANGE_PASS",flush=True)
                # Arming must be cancelled to make Start an independent action.
                buttons["Start"].emit("clicked")
                assert not picker.get_sensitive(), "PICKER_ACTIVE_WHILE_START_RUNNING"
                step[0]=1
            elif step[0]==1 and label.startswith("UNVERIFIED") and buttons["Start"].get_sensitive():
                assert picker.get_sensitive(), "PICKER_NOT_RESTORED_AFTER_FAILED_START"
                print("V110_GTK_START_FORGED_OK_REJECTED_PASS",flush=True)
                (root/"mode.txt").write_text("legitimate")
                buttons["Start"].emit("clicked")
                assert not picker.get_sensitive(), "PICKER_ACTIVE_WHILE_VALID_START_RUNNING"
                step[0]=2
            elif step[0]==2 and label.startswith("VERIFIED") and "start" in label and buttons["Stop"].get_sensitive():
                assert picker.get_sensitive(), "PICKER_NOT_RESTORED_AFTER_VALID_START"
                print("V110_GTK_START_VERIFIED_HEALTH_PASS",flush=True)
                buttons["Stop"].emit("clicked")
                assert result.get_label().startswith("Click Stop again to confirm")
                buttons["Stop"].emit("clicked")
                assert not picker.get_sensitive(), "PICKER_ACTIVE_WHILE_STOP_RUNNING"
                step[0]=3
            elif step[0]==3 and label.startswith("VERIFIED") and "stop" in label and buttons["Stop"].get_sensitive():
                assert picker.get_sensitive(), "PICKER_NOT_RESTORED_AFTER_STOP"
                assert scope_transitions["locked"]>=3 and scope_transitions["unlocked"]>=3, scope_transitions
                print("V110_GTK_PROFILE_SCOPE_LOCK_AND_RESTORE_PASS",flush=True)
                print("V110_GTK_STOP_CONFIRMED_VERIFIED_IDENTITY_PASS",flush=True)
                step[0]=4
                win.close()
                loop.quit()
                return False
        except Exception as ex:
            errors.append(repr(ex))
            win.close()
            loop.quit()
            return False
        return True
    win.present()
    GLib.timeout_add(50,poll)
    loop.run()
    if errors: raise RuntimeError(";".join(errors))
    assert step[0]==4,step
    print("QA7_GTK_REAL_BUTTON_LIFECYCLE_NO_OWNER_FOCUS_PASS",flush=True)
