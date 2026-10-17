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
                "gui":{"enabled":True,"available":False,"uncertain":False,"reason":"UNVERIFIED"},
                "browser":{"enabled":True,"available":True,"uncertain":False},"operations":{"active":0},
                "extensions":{"items":[]}}
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


    def render_fixture(self, doc):
        self.dump(m.MONITOR, doc)
        return m.monitor_status()
    def test_uncertain_gui_never_ready(self):
        d=self.valid_monitor(); d['gui'].update(available=True, uncertain=True)
        self.assertEqual(self.render_fixture(d)['gui'], 'UNCERTAIN')
    def test_uncertain_browser_never_ready(self):
        d=self.valid_monitor(); d['browser']['uncertain']=True
        self.assertEqual(self.render_fixture(d)['browser'], 'UNCERTAIN')
    def test_disabled_component_never_ready(self):
        for key in ('gui','browser'):
            with self.subTest(key=key):
                d=self.valid_monitor();d[key].update(enabled=False,available=True)
                self.assertEqual(self.render_fixture(d)[key], 'DISABLED')
    def test_missing_component_flags_are_unverified(self):
        for key in ('gui','browser'):
            for flag in ('enabled','available','uncertain'):
                with self.subTest(key=key,flag=flag):
                    d=self.valid_monitor();d[key]['available']=True;d[key].pop(flag)
                    self.assertEqual(self.render_fixture(d)[key], 'UNVERIFIED')
    def test_missing_or_invalid_live_count_is_not_zero(self):
        for value in (None,True,False,-1,1000000,'7',7.5):
            with self.subTest(value=value):
                d=self.valid_monitor();d['operations']['active']=value
                self.assertIsNone(self.render_fixture(d)['activeOperations'])
        d=self.valid_monitor();d.pop('operations')
        self.assertIsNone(self.render_fixture(d)['activeOperations'])
    def test_unknown_extension_inventory_not_zero(self):
        d=self.valid_monitor();d.pop('extensions')
        self.assertIsNone(self.render_fixture(d)['extensions'])
    def test_malformed_nested_sections_never_raise_or_connect(self):
        for key in ('identity','gui','browser','operations','extensions'):
            with self.subTest(key=key):
                d=self.valid_monitor();d[key]=['not-an-object']
                self.assertEqual(self.render_fixture(d)['state'],'UNVERIFIED')
    def test_boolean_schema_not_integer_version(self):
        d=self.valid_monitor();d['schema']=True
        self.assertEqual(self.render_fixture(d)['state'],'UNVERIFIED')
    def test_invalid_expiry_window_never_connects(self):
        for observed,expires in ((True,9999999999999),(1,9999999999999),(9999999999999,9999999999999)):
            with self.subTest(observed=observed,expires=expires):
                d=self.valid_monitor();d.update(observedAtEpochMs=observed,expiresAtEpochMs=expires)
                self.assertNotEqual(self.render_fixture(d)['state'],'CONNECTED')
    def test_duplicate_json_keys_are_rejected(self):
        raw=json.dumps(self.valid_monitor());m.MONITOR.write_text(raw[:-1]+',"schema":1}',encoding='utf8');m.MONITOR.chmod(0o600)
        self.assertEqual(m.monitor_status()['state'],'UNVERIFIED')
    def test_explicit_complete_readiness_and_zero_preserved(self):
        d=self.valid_monitor();d['gui']['available']=True;s=self.render_fixture(d)
        self.assertEqual(s['gui'],'READY');self.assertEqual(s['browser'],'READY');self.assertEqual(s['activeOperations'],0)
    def test_extension_cap_does_not_claim_exhaustive_total(self):
        d=self.valid_monitor();d['extensions']['items']=[{'id':f'ext-{i}','version':'1.0.0'} for i in range(32)]
        s=self.render_fixture(d);self.assertEqual(s['extensions'],32);self.assertIsNone(s['extensionsTotal']);self.assertTrue(s['extensionsMayBeTruncated'])


if __name__=="__main__":
    unittest.main(verbosity=2)
