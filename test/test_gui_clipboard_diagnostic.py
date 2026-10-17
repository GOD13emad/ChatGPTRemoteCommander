"""Isolated phase-observation regression: NEVER connects to the desktop or sends input."""
import importlib.util
from pathlib import Path
import sys
import time
import unittest

@unittest.skipUnless(sys.platform == "linux", "Linux-specific Mutter GUI helper")
class ClipboardObservation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "tools/gui-control-linux.py"
        spec = importlib.util.spec_from_file_location("rc_candidate_gui_helper", path)
        cls.helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.helper)

    def state(self, *, requested=0, unsupported=0, completed=0, owner=True):
        rd = self.helper.MutterInput({}, time.monotonic()+5)
        rd.clipboard_request_count = requested
        rd.clipboard_unmatched_count = unsupported
        rd.clipboard_transfer_count = completed
        rd.clipboard_stage_request_baseline = 0
        rd.clipboard_stage_unmatched_baseline = 0
        rd.clipboard_session_is_owner = owner
        rd.clipboard_payloads = {"text/plain": b"PRIVATE-CONTENT-MUST-NEVER-BE-LOGGED"}
        rd._pump = lambda seconds, predicate: False
        return rd

    def observe(self, state):
        with self.assertRaises(self.helper.GuiFailure) as caught:
            state.clipboard_wait_transfer(0, 0.80, "GUI_CLIPBOARD_PASTE_NOT_CONFIRMED")
        self.assertEqual(caught.exception.code, "GUI_CLIPBOARD_PASTE_NOT_CONFIRMED")
        report = caught.exception.clipboardDiagnostic
        self.assertEqual(report["schema"], "rc-clipboard-transfer-observation-v1")
        self.assertEqual(report["waitMs"], 800)
        self.assertNotIn("PRIVATE-CONTENT", repr(report))
        return report

    def test_no_selection_transfer_request_is_not_paste_success(self):
        report = self.observe(self.state())
        self.assertEqual(report["reason"], "NO_REQUEST")
        self.assertEqual(report["selectionRequests"], 0)
        self.assertTrue(report["ownerConfirmed"])

    def test_unhandled_selection_mime_is_distinguished(self):
        report = self.observe(self.state(requested=1, unsupported=1))
        self.assertEqual(report["reason"], "UNSUPPORTED_REQUEST")
        self.assertEqual(report["unsupportedRequests"], 1)

    def test_request_without_confirmed_completion_is_unknown(self):
        report = self.observe(self.state(requested=2, unsupported=1))
        self.assertEqual(report["reason"], "UNCONFIRMED_TRANSFER")
        self.assertEqual(report["selectionRequests"], 2)

    def test_observed_completed_transfer_remains_success(self):
        state = self.state(requested=1, completed=1)
        state._pump = lambda seconds, predicate: True
        self.assertIsNone(state.clipboard_wait_transfer(0,0.80,
                                                         "GUI_CLIPBOARD_PASTE_NOT_CONFIRMED"))

    def test_unhandled_selection_signal_counts_request_without_storing_mime(self):
        state=self.state()
        called=[]
        class Bus:
            def call_sync(self,*args):
                called.append(args)
        class Params:
            def unpack(self):
                return ("application/unknown-private-identifier",17)
        state.bus=Bus()
        state._clipboard_signal(None,None,None,None,"SelectionTransfer",Params(),None)
        self.assertEqual(state.clipboard_request_count,1)
        self.assertEqual(state.clipboard_unmatched_count,1)
        self.assertEqual(state.clipboard_transfer_count,0)
        self.assertTrue(any("SelectionWriteDone" in repr(a) for a in called))
        report=self.observe(state)
        self.assertEqual(report["reason"],"UNSUPPORTED_REQUEST")
        self.assertNotIn("application/unknown-private-identifier",repr(report))

    def test_known_selection_signal_counts_only_completed_transfer(self):
        state=self.state()
        calls=[]
        class Params:
            def unpack(self):
                return ("text/plain",27)
        state._clipboard_write_fd=lambda serial,payload:calls.append((serial,payload))
        state._clipboard_signal(None,None,None,None,"SelectionTransfer",Params(),None)
        self.assertEqual(state.clipboard_request_count,1)
        self.assertEqual(state.clipboard_unmatched_count,0)
        self.assertEqual(state.clipboard_transfer_count,1)
        self.assertEqual(len(calls),1)
        state._pump=lambda seconds,predicate:predicate()
        self.assertIsNone(state.clipboard_wait_transfer(0,0.80,"GUI_CLIPBOARD_PASTE_NOT_CONFIRMED"))

    def test_diagnostics_contain_only_closed_noncontent_fields(self):
        report = self.observe(self.state(requested=1, unsupported=1))
        self.assertEqual(set(report), {
            "schema", "reason", "ownerConfirmed", "selectionRequests",
            "unsupportedRequests", "successfulTransfers", "waitMs"})

if __name__ == "__main__":
    unittest.main()
