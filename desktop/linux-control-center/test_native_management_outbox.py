"""Real disposable SQLite owner-local outbox tests, no installed Core or GUI."""
import dataclasses
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from uuid import uuid4

from native_management import NativeManagementController, ManagementBlocked
from native_management_outbox import NativeRequestOutbox
from test_native_management import FakeClient, T


@unittest.skipUnless(os.name == "posix" and hasattr(os, "getuid") and os.getuid() != 0,
                     "Owner-local POSIX pending-request outbox only")
class OutboxTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="rc-native-outbox-")
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.dir.chmod(0o700)
        self.box = NativeRequestOutbox(self.dir, T)
        self.addCleanup(self.box.close)
        self.client = FakeClient()
        self.records = [{"id":"alpha","profileId":"default","revision":1,"state":"RUNNING"}]
        self.read = lambda: {"schema":1,"target":T,"records":self.records}
        self.control = NativeManagementController(self.client, self.read, self.box)

    def prepare(self):
        return self.control.prepare("alpha", 1, "workflow.pause")

    def test_private_owner_only_sqlite_and_known_scope(self):
        db = self.dir / "owner-native-controls.sqlite3"
        self.assertEqual(db.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.box.target, T)
        self.assertFalse(self.box.pending())
        self.assertFalse(self.box.has_unresolved())
        with sqlite3.connect(db) as con:
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], 1)

    def test_not_sent_until_after_durable_begin(self):
        p = self.prepare()
        original = self.client.control
        def checked(*args):
            items = self.box.pending()
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["requestId"], p.request_id)
            self.assertEqual(items[0]["state"], "IN_FLIGHT")
            return original(*args)
        self.client.control = checked
        self.assertEqual(self.control.submit_confirmed(p)["state"], "APPLIED")
        self.assertEqual(len(self.client.calls), 1)
        self.assertFalse(self.box.pending())
        self.box.close()
        reopened = NativeRequestOutbox(self.dir, T)
        self.addCleanup(reopened.close)
        self.assertFalse(reopened.has_unresolved())
        with sqlite3.connect(self.dir / "owner-native-controls.sqlite3") as con:
            self.assertEqual(con.execute("SELECT state,code FROM attempts").fetchone(),
                             ("RECORDED", "MANAGEMENT_CONTROL_READBACK_VERIFIED"))

    def test_unknown_effect_persistently_blocks_after_restart(self):
        self.client.effect = "ERROR"
        p = self.prepare()
        self.assertEqual(self.control.submit_confirmed(p)["state"], "UNCERTAIN")
        self.assertEqual(self.box.pending()[0]["state"], "UNCERTAIN")
        self.box.close()
        reopened = NativeRequestOutbox(self.dir, T)
        self.addCleanup(reopened.close)
        new_client = FakeClient()
        fresh = NativeManagementController(new_client, self.read, reopened)
        self.assertTrue(fresh.disabled)
        self.assertEqual(len(fresh.pending_controls()), 1)
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_PENDING_RECONCILIATION_REQUIRED"):
            fresh.prepare("alpha", 1, "workflow.cancel")
        self.assertFalse(new_client.calls)

    def test_crash_between_fsync_and_ipc_is_not_replayed(self):
        p = self.prepare()
        self.box.begin(p)
        self.assertEqual(self.box.pending()[0]["state"], "IN_FLIGHT")
        self.assertFalse(self.client.calls)
        self.box.close()  # simulate process shutdown
        reopened = NativeRequestOutbox(self.dir, T)
        self.addCleanup(reopened.close)
        fresh_client = FakeClient()
        fresh = NativeManagementController(fresh_client, self.read, reopened)
        self.assertTrue(fresh.disabled)
        with self.assertRaises(ManagementBlocked):
            fresh.prepare("alpha", 1, "workflow.pause")
        self.assertFalse(fresh_client.calls)

    def test_rejected_core_receipt_is_persisted_and_does_not_claim_applied(self):
        self.client.effect = "REJECTED"
        self.assertEqual(self.control.submit_confirmed(self.prepare())["state"], "REJECTED")
        self.assertFalse(self.control.disabled)
        self.assertFalse(self.box.has_unresolved())
        with sqlite3.connect(self.dir / "owner-native-controls.sqlite3") as con:
            self.assertEqual(con.execute("SELECT state FROM attempts").fetchone()[0], "REJECTED")

    def test_bad_unauthorized_or_mismatched_receipt_blocks(self):
        self.client.effect = "SPOOF"
        self.assertEqual(self.control.submit_confirmed(self.prepare())["state"], "UNCERTAIN")
        self.assertTrue(self.box.has_unresolved())
        self.assertTrue(self.control.disabled)
        self.assertEqual(self.box.pending()[0]["state"], "UNCERTAIN")

    def test_unknown_rejected_code_must_remain_pending_after_reopen(self):
        real = self.client.control
        def misleading(*args):
            reply = real(*args)
            reply["state"] = "REJECTED"
            reply["code"] = "MANAGEMENT_OUTCOME_UNCERTAIN"
            reply["newRevision"] = None
            reply.pop("controlIntent", None)
            return reply
        self.client.control = misleading
        result = self.control.submit_confirmed(self.prepare())
        self.assertEqual(result["state"], "UNCERTAIN")
        self.assertTrue(self.box.has_unresolved())
        self.box.close()
        reopened = NativeRequestOutbox(self.dir, T)
        self.addCleanup(reopened.close)
        self.assertTrue(reopened.has_unresolved())
        self.assertEqual(reopened.pending()[0]["state"], "UNCERTAIN")
        self.assertEqual(len(self.client.calls), 1)

    def test_same_attempt_cannot_be_reissued(self):
        p = self.prepare()
        self.box.begin(p)
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_PENDING_RECONCILIATION_REQUIRED"):
            self.box.begin(p)
        self.assertFalse(self.client.calls)

    def test_another_outbox_handle_observes_pending_before_new_action(self):
        p = self.prepare()
        self.box.begin(p)
        other = NativeRequestOutbox(self.dir, T)
        self.addCleanup(other.close)
        self.assertTrue(other.has_unresolved())
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_PENDING_RECONCILIATION_REQUIRED"):
            other.begin(dataclasses.replace(p, request_id=uuid4().hex))
        self.assertFalse(self.client.calls)

    def test_wrong_target_does_not_receive_pending_scope(self):
        different = {**T, "routeGeneration": T["routeGeneration"]+1}
        wrong = NativeRequestOutbox(self.dir, different)
        self.addCleanup(wrong.close)
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_OUTBOX_SCOPE_UNVERIFIED"):
            NativeManagementController(self.client, self.read, wrong)
        p = self.prepare()
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_OUTBOX_REQUEST_UNVERIFIED"):
            wrong.begin(p)
        self.assertFalse(wrong.pending())
        self.assertFalse(self.client.calls)

    def test_symlink_file_is_rejected_before_sqlite_open(self):
        self.box.close()
        target = self.dir / "protected.txt"
        target.write_text("SENTINEL")
        db = self.dir / "owner-native-controls.sqlite3"
        db.unlink()
        db.symlink_to(target)
        with self.assertRaises(ManagementBlocked):
            NativeRequestOutbox(self.dir, T)
        self.assertEqual(target.read_text(), "SENTINEL")

    def test_unsafe_directory_fails_without_creating_database(self):
        other = self.dir / "untrusted"
        other.mkdir(mode=0o700)
        other.chmod(0o777)
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_OUTBOX_DIRECTORY_UNTRUSTED"):
            NativeRequestOutbox(other, T)
        self.assertFalse((other / "owner-native-controls.sqlite3").exists())
        link = self.dir / "dir-link"
        link.symlink_to(other, target_is_directory=True)
        with self.assertRaises(ManagementBlocked):
            NativeRequestOutbox(link, T)

    def test_owner_world_readable_database_fails_closed(self):
        self.box.close()
        db = self.dir / "owner-native-controls.sqlite3"
        db.chmod(0o644)
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_OUTBOX_FILE_UNTRUSTED"):
            NativeRequestOutbox(self.dir, T)

    def test_repeated_or_fake_conclusion_cannot_modify_terminal_row(self):
        p = self.prepare()
        self.assertEqual(self.control.submit_confirmed(p)["state"], "APPLIED")
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_OUTBOX_RECORD_NOT_PENDING"):
            self.box.conclude(p.request_id, "RECORDED", "MANAGEMENT_CONTROL_READBACK_VERIFIED")
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_OUTBOX_RECEIPT_UNVERIFIED"):
            self.box.conclude(uuid4().hex, "RECORDED", "SOME_OTHER_CODE")
        self.assertFalse(self.box.pending())

    def test_worker_thread_may_commit_without_sqlite_thread_error(self):
        p = self.prepare()
        outcomes = []
        worker = threading.Thread(target=lambda: outcomes.append(self.control.submit_confirmed(p)))
        worker.start()
        worker.join(timeout=5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(len(outcomes), 1)
        self.assertEqual(outcomes[0]["state"], "APPLIED")
        self.assertFalse(self.box.has_unresolved())

    def test_explicit_read_only_core_proof_keeps_pending_without_replay(self):
        request = self.prepare()
        self.box.begin(request)
        seen = []
        def inspector(identity):
            seen.append(identity)
            return {
                "schema": 1, "state": "JOURNALED_APPLIED",
                "code": "MANAGEMENT_CONTROL_EVENT_VERIFIED",
                "action": "workflow.pause", "workflowId": "alpha",
                "requestId": request.request_id, "expectedRevision": 1,
                "evidenceKind": "CORE_VERIFIED_EVENT_CHAIN_ONLY",
                "replayed": False, "mutated": False,
                "evidence": {"schema": 1, "eventRevision": 2,
                             "eventSha256": "b" * 64, "currentRevision": 3,
                             "workerTerminationVerified": False},
            }
        outcome = self.box.inspect_pending(request.request_id, inspector)
        self.assertEqual(outcome["state"], "JOURNALED_APPLIED")
        self.assertEqual(outcome["eventSha256"], "b" * 64)
        self.assertFalse(outcome["replayed"])
        self.assertTrue(self.box.has_unresolved())
        self.assertEqual(self.box.pending()[0]["state"], "IN_FLIGHT")
        self.assertEqual(seen[0]["target"], T)
        self.assertEqual(seen[0]["requestId"], request.request_id)
        self.assertEqual(self.client.calls, [])

    def test_absent_core_event_remains_unresolved_and_blocking(self):
        request = self.prepare()
        self.box.begin(request)
        def inspector(identity):
            return {"schema": 1, "state": "UNRESOLVED",
                    "code": "MANAGEMENT_NO_EXACT_CONTROL_EVENT",
                    "action": identity["action"], "workflowId": identity["workflowId"],
                    "requestId": identity["requestId"],
                    "expectedRevision": identity["expectedRevision"],
                    "evidenceKind": "CORE_VERIFIED_EVENT_CHAIN_ONLY",
                    "replayed": False, "mutated": False, "evidence": None}
        result = self.box.inspect_pending(request.request_id, inspector)
        self.assertEqual(result["state"], "UNRESOLVED")
        self.assertTrue(self.box.has_unresolved())
        self.box.close()
        fresh = NativeRequestOutbox(self.dir, T)
        self.addCleanup(fresh.close)
        self.assertTrue(fresh.has_unresolved())

    def test_forged_identity_or_evidence_is_unverified(self):
        req = self.prepare()
        self.box.begin(req)
        valid = {
            "schema": 1, "state": "JOURNALED_APPLIED",
            "code": "MANAGEMENT_CONTROL_EVENT_VERIFIED",
            "action": "workflow.pause", "workflowId": "alpha",
            "requestId": req.request_id, "expectedRevision": 1,
            "evidenceKind": "CORE_VERIFIED_EVENT_CHAIN_ONLY",
            "replayed": False, "mutated": False,
            "evidence": {"schema": 1, "eventRevision": 2,
                         "eventSha256": "e" * 64, "currentRevision": 2,
                         "workerTerminationVerified": False},
        }
        for changed in (
            {"requestId": "other-id"}, {"expectedRevision": True},
            {"action": "workflow.cancel"}, {"schema": True},
            {"evidenceKind": "FAKE"}, {"replayed": True}, {"mutated": True},
            {"evidence": {**valid["evidence"], "eventSha256": "invalid"}},
            {"evidence": {**valid["evidence"], "workerTerminationVerified": True}},
            {"state": "APPLIED"}, {"state": []}, {"code": []},
            {"expectedRevision": 1.0},
            {"code": "MANAGEMENT_OUTCOME_UNCERTAIN"},
            {"rogueField": 1},
        ):
            with self.subTest(changed=changed):
                proof = {**valid, **changed}
                report = self.box.inspect_pending(req.request_id, lambda _x, p=proof: p)
                self.assertEqual(report["state"], "UNVERIFIED")
                self.assertTrue(self.box.has_unresolved())
        self.assertEqual(self.client.calls, [])

    def test_unknown_request_id_never_invokes_inspector(self):
        called = []
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_OUTBOX_RECORD_NOT_PENDING"):
            self.box.inspect_pending("absent", lambda req: called.append(req))
        self.assertEqual(called, [])

    def test_inspector_error_preserves_original_pending_record(self):
        req = self.prepare()
        self.box.begin(req)
        def fail(_identity):
            raise TimeoutError("no Core readback")
        report = self.box.inspect_pending(req.request_id, fail)
        self.assertEqual(report["state"], "UNVERIFIED")
        self.assertEqual(report["code"], "MANAGEMENT_JOURNAL_UNAVAILABLE")
        self.assertTrue(self.box.has_unresolved())
        self.assertEqual(self.box.pending()[0]["state"], "IN_FLIGHT")
        self.assertEqual(self.client.calls, [])

    def test_if_storage_is_closed_no_new_effect(self):
        p = self.prepare()
        self.box.close()
        with self.assertRaisesRegex(ManagementBlocked, "MANAGEMENT_SESSION_UNAVAILABLE"):
            self.control.submit_confirmed(p)
        self.assertTrue(self.control.disabled)
        self.assertEqual(self.client.calls, [])

    def test_failed_result_write_never_claims_applied(self):
        p = self.prepare()
        self.box.conclude = lambda *args: (_ for _ in ()).throw(OSError("private sqlite failed"))
        result = self.control.submit_confirmed(p)
        self.assertEqual(result["state"], "UNCERTAIN")
        self.assertEqual(result["code"], "MANAGEMENT_OUTBOX_RESULT_UNVERIFIED")
        self.assertEqual(len(self.client.calls), 1)
        self.assertTrue(self.control.disabled)
        self.assertEqual(self.box.pending()[0]["state"], "IN_FLIGHT")

    def test_fake_gtk_pending_inventory_has_no_control_buttons_after_restart(self):
        from native_management_view import attach_management_view
        from test_native_management_view import Gtk, Adw, GLib, Center
        p = self.prepare()
        self.box.begin(p)
        self.box.close()
        recovered_box = NativeRequestOutbox(self.dir, T)
        self.addCleanup(recovered_box.close)
        fresh = NativeManagementController(FakeClient(), self.read, recovered_box)
        center = Center()
        ui = attach_management_view(center, fresh, Gtk, Adw, GLib)
        self.addCleanup(ui.close)
        self.assertEqual(ui.buttons, [])
        self.assertIn("RECONCILIATION REQUIRED", ui.note.get_text())
        self.assertEqual(len(ui.list.children), 1)
        self.assertIn("NO RETRY", ui.list.children[0].child.get_text())
        self.assertEqual(self.client.calls, [])


if __name__ == "__main__":
    unittest.main()
