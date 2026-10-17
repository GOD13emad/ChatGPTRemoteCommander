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
