"""Source-only owner GUI descriptor + real read-only Core store QA.

No Gtk window/display, installed profile, credentials, network or Core action.
"""
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest


@unittest.skipUnless(os.name == "posix" and hasattr(os, "getuid") and os.getuid() != 0,
                     "Linux unprivileged owner only")
class OwnerGtkBootstrapTests(unittest.TestCase):
    def setUp(self):
        import native_owner_gtk
        self.module = native_owner_gtk
        self.temp = tempfile.TemporaryDirectory(prefix="rc-native-view-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.db = self.root / "workflows.sqlite"
        with sqlite3.connect(self.db) as conn:
            conn.execute("CREATE TABLE workflows (id TEXT, revision INTEGER, snapshot TEXT)")
            conn.execute("INSERT INTO workflows VALUES (?,?,?)",
                         ("sample", 2, json.dumps({"schema":2,"id":"sample",
                          "revision":2,"device":"fixture","configSha256":"1"*64,
                          "authority":{"profileId":"default"},"lifecycleState":"WAITING"})))
        self.db.chmod(0o600)
        self.target = {"deviceId":"fixture","profileId":"default",
                       "configSha256":"1"*64,"routeGeneration":2}

    def test_exact_readonly_core_rows_no_mutation(self):
        db = self.module._file(str(self.db))
        before = self.db.read_bytes()
        result = self.module._read_workflow_rows(db, self.target)
        self.assertEqual(result["schema"],1)
        self.assertEqual(result["target"],self.target)
        self.assertEqual(result["records"],
                         [{"id":"sample","revision":2,"state":"WAITING","profileId":"default"}])
        self.assertEqual(self.db.read_bytes(),before)

    def test_invalid_alias_permission_and_hardlink_cannot_be_read(self):
        link = self.root / "link.sqlite"
        link.symlink_to(self.db)
        with self.assertRaises(ValueError):self.module._file(str(link))
        link.unlink()
        self.db.chmod(0o644)
        with self.assertRaises(ValueError):self.module._file(str(self.db))
        self.db.chmod(0o600)
        os.link(self.db, link)
        with self.assertRaises(ValueError):self.module._file(str(self.db))
        link.unlink()
        self.assertEqual(self.module._file(str(self.db)),self.db)

    def test_unsafe_parent_directory_is_denied(self):
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):self.module._file(str(self.db))
        self.root.chmod(0o700)

    def test_untrusted_workflow_snapshot_and_duplicate_keys_are_denied(self):
        with sqlite3.connect(self.db) as con:
            con.execute("UPDATE workflows SET snapshot=?", ('{"lifecycleState":"WAITING","lifecycleState":"CANCELLED"}',))
        with self.assertRaises(ValueError):
            self.module._read_workflow_rows(self.module._file(str(self.db)),self.target)

    def test_foreign_or_corrupted_core_identity_fails_closed(self):
        valid = {"schema": 2, "id": "sample", "revision": 2,
                 "device": "fixture", "configSha256": "1"*64,
                 "authority": {"profileId": "default"}, "lifecycleState": "WAITING"}
        cases = {
            "wrong-config": {"configSha256": "2"*64},
            "wrong-profile": {"authority": {"profileId": "other"}},
            "wrong-device": {"device": "other"},
            "wrong-revision": {"revision": 3},
            "wrong-id": {"id": "other"},
            "bool-revision": {"revision": True},
            "bool-schema": {"schema": True},
            "invalid-state": {"lifecycleState": None},
            "missing-authority": {"authority": {}},
        }
        for name, changed in cases.items():
            with self.subTest(name=name):
                state = {**valid, **changed}
                with sqlite3.connect(self.db) as con:
                    con.execute("UPDATE workflows SET snapshot=?",
                                (json.dumps(state),))
                with self.assertRaisesRegex(ValueError,
                         "MANAGEMENT_WORKFLOW_SCOPE_UNVERIFIED"):
                    self.module._read_workflow_rows(self.module._file(str(self.db)),
                                                     self.target)

    def test_one_foreign_row_blocks_entire_inventory(self):
        foreign = {"schema": 2, "id": "foreign", "revision": 1,
                   "device": "fixture", "configSha256": "1"*64,
                   "authority": {"profileId": "other"},
                   "lifecycleState": "WAITING"}
        with sqlite3.connect(self.db) as con:
            con.execute("INSERT INTO workflows VALUES (?,?,?)",
                        ("foreign", 1, json.dumps(foreign)))
        with self.assertRaisesRegex(ValueError,
                                    "MANAGEMENT_WORKFLOW_SCOPE_UNVERIFIED"):
            self.module._read_workflow_rows(self.module._file(str(self.db)),
                                             self.target)

    def test_bounded_owner_descriptor_rejects_injected_commands(self):
        desc = {"schema":1,"endpoint":"/tmp/control.sock","serverPid":1234,
                "target":self.target,"workflowDb":str(self.db),
                "outboxDir":str(self.root)}
        previous = sys.stdin
        try:
            for payload in ({**desc,"command":"shell"}, {**desc,"schema":True},
                            {**desc,"target":{**self.target,"routeGeneration":True}}):
                sys.stdin=type("Input", (), {"buffer":io.BytesIO(json.dumps(payload).encode()+b"\n")})()
                with self.assertRaises((ValueError,TypeError,RuntimeError,
                                        self.module._TRANSPORT.ManagementError)):
                    self.module._descriptor()
            sys.stdin=type("Input", (), {"buffer":io.BytesIO(json.dumps(desc).encode()+b"\n")})()
            checked,target,db = self.module._descriptor()
            self.assertEqual(target,self.target)
            self.assertEqual(db,self.db)
            self.assertEqual(checked["serverPid"],1234)
        finally:
            sys.stdin=previous


if __name__ == "__main__":
    unittest.main()
