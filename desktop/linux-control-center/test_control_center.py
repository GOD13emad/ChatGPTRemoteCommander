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
                "gui":{"available":False,"reason":"UNVERIFIED"},
                "browser":{"available":True},"operations":{"active":0},
                "extensions":{"items":[]}}
    def test_system_theme_resolution(self):
        self.assertTrue(m.effective_system_dark("prefer-dark", "AppearanceStudio-MostWanted2005"))
        self.assertFalse(m.effective_system_dark("prefer-light", "Yaru-dark"))
        self.assertTrue(m.effective_system_dark("default", "Yaru-dark"))
        self.assertFalse(m.effective_system_dark("default", "Yaru"))
        self.assertTrue(m.effective_system_dark("default", "Yaru", "Adwaita-dark"))
        self.assertFalse(m.effective_system_dark("default", "DARKNESS"))
        self.assertFalse(m.effective_system_dark("", "", ""))

    def test_live_os_theme_signals_are_listened_to(self):
        source = P.read_text(encoding="utf-8")
        self.assertIn('changed::color-scheme', source)
        self.assertIn('changed::gtk-theme', source)
        self.assertIn("Adw.ColorScheme.FORCE_DARK", source)
        self.assertIn("Adw.ColorScheme.FORCE_LIGHT", source)
        self.assertNotIn("set_string(", source)

    def test_future_core_telemetry_is_trustworthy_and_bounded(self):
        record=self.valid_monitor()
        record["workflows"]={"automaticExecution":False,"runnerConfigured":True,
                             "persistedNonterminal":17,"currentLeases":0,"reconciliationRequired":6}
        record["delivery"]={"available":True,"pending":61,"deadLetter":0,
                            "transportReceipts":83,"authenticatedChatBound":False,
                            "privateCorrelation":"SECRET"}
        self.dump(m.MONITOR,record)
        state=m.monitor_status()
        self.assertEqual(state["state"],"CONNECTED")
        self.assertEqual(state["automaticExecution"],"NO")
        self.assertEqual(state["runnerConfigured"],"YES")
        self.assertEqual(state["persistedNonterminal"],17)
        self.assertEqual(state["currentLeases"],0)
        self.assertEqual(state["reconciliationRequired"],6)
        self.assertEqual(state["deliveryPending"],61)
        self.assertEqual(state["authenticatedChatBound"],"NO")
        self.assertNotIn("privateCorrelation",state)

    def test_old_core_lacks_counters_without_fabricating_zero(self):
        self.dump(m.MONITOR,self.valid_monitor())
        state=m.monitor_status()
        for field in ("persistedNonterminal","currentLeases","deliveryPending","reconciliationRequired"):
            self.assertIsNone(state[field])
            self.assertEqual(m.display_count(state[field]),"UNVERIFIED")
        self.assertEqual(state["automaticExecution"],"UNVERIFIED")
        self.assertEqual(state["deliveryState"],"UNVERIFIED")

    def test_invalid_and_boolean_counts_are_never_reported(self):
        snap=self.valid_monitor()
        snap["workflows"]={"persistedNonterminal":True,"currentLeases":-1,
                           "reconciliationRequired":1000001,"automaticExecution":"true"}
        snap["delivery"]={"available":True,"pending":False,"deadLetter":"0",
                          "authenticatedChatBound":"true"}
        self.dump(m.MONITOR,snap)
        state=m.monitor_status()
        for field in ("persistedNonterminal","currentLeases","reconciliationRequired","deliveryPending","deliveryDeadLetter"):
            self.assertIsNone(state[field])
        self.assertEqual(state["authenticatedChatBound"],"UNVERIFIED")
        self.assertEqual(state["automaticExecution"],"UNVERIFIED")

    def test_untrusted_and_expired_data_do_not_export_counts(self):
        stale=self.valid_monitor(adjust=-100000)
        stale["workflows"]={"currentLeases":9}
        stale["delivery"]={"available":True,"pending":41}
        self.dump(m.MONITOR,stale)
        state=m.monitor_status()
        self.assertEqual(state["state"],"DISCONNECTED")
        self.assertNotIn("deliveryPending",state)
        self.assertNotIn("currentLeases",state)

    def test_display_limits_and_read_only_gui_contract(self):
        source=P.read_text(encoding="utf8")
        self.assertIn("for item in w[:25]",source)
        self.assertIn("Completion delivery backlog",source)
        self.assertIn("Authenticated ChatGPT delivery",source)
        self.assertIn('"workflowControlEnabled": False',source)

    def test_fresh_monitor(self):
        self.dump(m.MONITOR,self.valid_monitor())
        s=m.monitor_status()
        self.assertEqual(s["state"],"CONNECTED")
        self.assertEqual(s["gui"],"BLOCKED")
        self.assertEqual(s["activeOperations"],0)
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
