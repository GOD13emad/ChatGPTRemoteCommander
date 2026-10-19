import importlib.util
import json
import os
import sqlite3
import stat
import tempfile
import time
import unittest
from pathlib import Path

P = Path(__file__).with_name("control_center.py")
spec = importlib.util.spec_from_file_location("rc_center", P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SafeMonitorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="rc-center-r1-")
        self.root = Path(self.tmp.name)
        self.old = (m.MONITOR,m.ROUTING,m.WORKFLOWS)
        m.MONITOR = self.root/"monitor.json"
        m.ROUTING = self.root/"routing"
        m.WORKFLOWS = self.root/"workflows.sqlite"
        m.ROUTING.mkdir(mode=0o700)
    def tearDown(self):
        m.MONITOR,m.ROUTING,m.WORKFLOWS = self.old
        self.tmp.cleanup()
    def dump(self,p,obj):
        p.write_text(json.dumps(obj),encoding="utf8")
        p.chmod(0o600)
    def valid_monitor(self,adjust=0):
        now=int(time.time()*1000)
        return {"schema":1,"kind":"COMMANDER_LIVE_MONITOR",
                "observedAtEpochMs":now-100,"expiresAtEpochMs":now+10000+adjust,
                "identity":{"deviceName":"fixture","version":"0.10.20","profile":"default"},
                "gui":{"enabled":True,"available":False,"uncertain":False,"reason":"GUI_OFFLINE","capabilities":{"screenshot":True,"mouse":True}},
                "browser":{"enabled":True,"available":True,"uncertain":False},"operations":{"active":0},
                "extensions":{"items":[]}}
    def test_fresh_monitor(self):
        self.dump(m.MONITOR,self.valid_monitor())
        s=m.monitor_status()
        self.assertEqual(s["state"],"CONNECTED")
        self.assertEqual(s["gui"],"UNAVAILABLE")
        self.assertEqual(s["activeOperations"],0)
    def test_uncertain_native_gui_blocks_input_despite_available_backend(self):
        snap=self.valid_monitor()
        snap["gui"].update(available=True,uncertain=True,backend="gnome-mutter")
        self.dump(m.MONITOR,snap)
        state=m.monitor_status()
        self.assertEqual(state["gui"],"BLOCKED")
        self.assertEqual(state["guiInput"],"BLOCKED")
        self.assertEqual(state["privateDesktop"],"NOT_VERIFIED")
    def test_native_observer_is_not_native_control(self):
        snap=self.valid_monitor()
        snap["gui"].update(available=True,backend="gnome-mutter",sessionType="wayland")
        self.dump(m.MONITOR,snap)
        state=m.monitor_status()
        self.assertEqual(state["gui"],"OBSERVE_READY")
        self.assertEqual(state["guiInput"],"TAKEOVER_REQUIRED")
        self.assertEqual(state["privateDesktop"],"NOT_VERIFIED")
        self.assertIn("wayland",state["guiReason"])
    def test_malformed_and_missing_gui_flags_fail_closed(self):
        snap=self.valid_monitor()
        snap["gui"].update(available=True,uncertain="false")
        self.dump(m.MONITOR,snap)
        self.assertEqual(m.monitor_status()["gui"],"UNVERIFIED")
        snap["gui"].update(uncertain=False,capabilities={})
        self.dump(m.MONITOR,snap)
        self.assertEqual(m.monitor_status()["gui"],"UNVERIFIED")
        self.assertEqual(m.monitor_status()["guiInput"],"BLOCKED")
        snap["gui"]["capabilities"]={"screenshot":True,"mouse":False}
        self.dump(m.MONITOR,snap)
        self.assertEqual(m.monitor_status()["gui"],"OBSERVE_READY")
        self.assertEqual(m.monitor_status()["guiInput"],"INPUT_DISABLED")
        snap["gui"]=["invalid"]
        self.dump(m.MONITOR,snap)
        self.assertEqual(m.monitor_status()["gui"],"UNVERIFIED")
    def test_browser_uncertainty_and_missing_active_count_fail_closed(self):
        snap=self.valid_monitor()
        snap["browser"]["uncertain"]=True
        snap["operations"]={}
        self.dump(m.MONITOR,snap)
        self.assertEqual(m.monitor_status()["browser"],"BLOCKED")
        self.assertIsNone(m.monitor_status()["activeOperations"])
        snap["operations"]["active"]=True
        self.dump(m.MONITOR,snap)
        self.assertIsNone(m.monitor_status()["activeOperations"])
    def test_invalid_monitor_time_window_rejected(self):
        snap=self.valid_monitor()
        snap["expiresAtEpochMs"]+=24*3600*1000
        self.dump(m.MONITOR,snap)
        self.assertEqual(m.monitor_status()["state"],"DISCONNECTED")
        snap=self.valid_monitor()
        snap["observedAtEpochMs"]=True
        self.dump(m.MONITOR,snap)
        self.assertEqual(m.monitor_status()["state"],"UNVERIFIED")
    def test_stale_monitor_never_shows_connected(self):
        self.dump(m.MONITOR,self.valid_monitor(adjust=-100000))
        self.assertEqual(m.monitor_status()["state"],"DISCONNECTED")
    def test_missing_private_file(self):
        self.assertEqual(m.monitor_status()["state"],"UNVERIFIED")
    def test_symlink_rejected(self):
        original=self.root/"owner.json"
        self.dump(original,self.valid_monitor())
        m.MONITOR.symlink_to(original)
        self.assertEqual(m.monitor_status()["state"],"UNVERIFIED")
    def test_unsafe_permissions_rejected(self):
        self.dump(m.MONITOR,self.valid_monitor())
        m.MONITOR.chmod(0o666)
        self.assertEqual(m.monitor_status()["state"],"UNVERIFIED")
    def test_profile_pair_exact_canonical_root(self):
        p=m.ROUTING/"default.json"
        self.dump(p,{"profile":"default","active":{"version":"0.10.20","port":48832},"generation":4})
        q=m.ROUTING/"default.runtime.json"
        self.dump(q,{"stateFile":str(p.resolve())})
        self.assertEqual(m.profiles()[0]["id"],"default")
        self.dump(q,{"stateFile":"/tmp/wrong.json"})
        self.assertEqual(m.profiles(),[])
    def test_read_only_sqlite_does_not_modify_database(self):
        c=sqlite3.connect(m.WORKFLOWS)
        c.execute("CREATE TABLE workflows (id TEXT, revision INTEGER, snapshot TEXT)")
        c.execute("INSERT INTO workflows VALUES (?,?,?)",("probe",3,json.dumps({"lifecycleState":"WAITING"})))
        c.commit(); c.close()
        before=m.WORKFLOWS.stat().st_mtime_ns
        self.assertEqual(m.workflows(),[{"id":"probe","revision":3,"state":"WAITING"}])
        self.assertEqual(m.WORKFLOWS.stat().st_mtime_ns,before)
    def test_rejects_spoofed_workflow_identifiers(self):
        c=sqlite3.connect(m.WORKFLOWS)
        c.execute("CREATE TABLE workflows (id TEXT, revision INTEGER, snapshot TEXT)")
        c.execute("INSERT INTO workflows VALUES (?,?,?)",("../escape",1,json.dumps({"lifecycleState":"RUNNING"})))
        c.commit();c.close()
        self.assertEqual(m.workflows(),[])


if __name__=="__main__":
    unittest.main(verbosity=2)
