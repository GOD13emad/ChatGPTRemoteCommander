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

    def test_autofollow_absent_is_not_active(self):
        self.assertEqual(m.autofollow_status(self.root/"missing", self.root)["state"],
                         "NOT_CONFIGURED_OR_UNVERIFIED")

    def test_autofollow_rejects_untrusted_symlink(self):
        link=self.root/"linked"
        target=self.root/"actual"
        target.mkdir()
        link.symlink_to(target, target_is_directory=True)
        self.assertEqual(m.autofollow_status(link,self.root)["state"],
                         "NOT_CONFIGURED_OR_UNVERIFIED")

    def test_autofollow_authenticated_owner_receipts_not_actions(self):
        import hashlib
        root=self.root/"follow"
        units=self.root/"units"
        root.mkdir(mode=0o700)
        units.mkdir(mode=0o700)
        (root/"RESULTS").mkdir(mode=0o700)
        expected={}
        for name in ("rc-autofollow.service","rc-autofollow.timer"):
            p=units/name
            p.write_text("unit fixture " + name,encoding="utf8")
            p.chmod(0o600)
            expected[name]=hashlib.sha256(p.read_bytes()).hexdigest()
        brain_file=root/"BRAIN_R1.zip"
        brain_file.write_bytes(b"synthetic fixture Brain identity only")
        brain_file.chmod(0o600)
        self.dump(root/"BRAIN_VERIFY_R1.json", {
            "status":"PASS_R1_CUMULATIVE_AUTOFOLLOW_ACCOUNT_TRANSFER",
            "sha256":hashlib.sha256(brain_file.read_bytes()).hexdigest()})
        self.dump(root/"INSTALL_R2_RECEIPT.json", {
            "status":"PASS_USER_ONLY_AUTOFOLLOW_TIMER_R2",
            "unitSha256":expected,"workflowMutation":False,
            "chatAccountBoundDelivery":False})
        self.dump(root/"RESULTS/CURRENT.json", {
            "schema":1,"id":"RUN_20261008T205337Z",
            "modelStatus":"UNVERIFIED_MODEL_JSONDecodeError",
            "noActionsExecuted":True,"chatDelivery":False,
            "plan":{"secret":"NEVER_SHOW_OR_EXECUTE"}})
        accepted=m.autofollow_status(root,units)
        self.assertEqual(accepted["state"],"CONFIGURED_SOURCE_VERIFIED")
        self.assertEqual(accepted["modelStatus"],"UNVERIFIED_MODEL_JSONDecodeError")
        self.assertEqual(accepted["lastReceiptId"],"RUN_20261008T205337Z")
        self.assertFalse(accepted["workflowMutation"])
        self.assertFalse(accepted["chatDeliveryBound"])
        self.assertNotIn("secret",str(accepted))
        self.assertEqual(accepted["timerLiveState"],"UNVERIFIED_NO_SYSTEMD_QUERY")
        (units/"rc-autofollow.timer").write_text("tampered timer")
        self.assertEqual(m.autofollow_status(root,units)["state"],
                         "NOT_CONFIGURED_OR_UNVERIFIED")

    def test_autofollow_no_executable_actions_in_source(self):
        source=P.read_text(encoding="utf8")
        self.assertIn("timerLiveState",source)
        self.assertNotIn("systemctl start",source)
        self.assertNotIn("systemctl stop",source)
        self.assertNotIn("subprocess.run(",source)
        self.assertNotIn("requests.post(",source)

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
