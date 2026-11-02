"""Guard-level tests for opt-in, owner-bound generic AT-SPI; no GUI input."""
import importlib.util
import os
import pathlib
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILE = ROOT / "tools" / "owner-atspi-semantic.py"
SPEC = importlib.util.spec_from_file_location("rc_owner_atspi", FILE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class Frame:
    def __init__(self, name):
        self.name = name
    def get_name(self):
        return self.name

class App:
    def __init__(self, name, pid, frames):
        self.name, self.pid, self.frames = name, pid, frames
    def get_process_id(self):
        return self.pid
    def get_name(self):
        return self.name
    def get_child_count(self):
        return len(self.frames)
    def get_child_at_index(self, index):
        return self.frames[index]

class Desktop:
    def __init__(self, apps):
        self.apps = apps
    def get_child_count(self):
        return len(self.apps)
    def get_child_at_index(self, index):
        return self.apps[index]

class OwnerBindingTests(unittest.TestCase):
    def setUp(self):
        self.pid = os.getpid()
        self.start = MODULE.owner_start_ticks(self.pid)
        self.original_atspi = MODULE.Atspi
    def tearDown(self):
        MODULE.Atspi = self.original_atspi
    def desktop(self, app, frames=None):
        frames = ["Exact QA"] if frames is None else frames
        fake = Desktop([App(app, self.pid, [Frame(x) for x in frames])])
        MODULE.Atspi = types.SimpleNamespace(get_desktop=lambda _: fake)
    def test_same_uid_and_kernel_generation(self):
        MODULE.exact_generic_owner(self.pid, "QA.App", self.start)
    def test_stale_or_missing_generation_rejected(self):
        with self.assertRaisesRegex(ValueError, "ATSPI_PROCESS_REPLACED"):
            MODULE.exact_generic_owner(self.pid, "QA.App", str(int(self.start) + 1))
        with self.assertRaisesRegex(ValueError, "ATSPI_PROCESS_GENERATION_INVALID"):
            MODULE.exact_generic_owner(self.pid, "QA.App", None)
    def test_invalid_application_name_rejected(self):
        for name in ("", "QA\nApp", "x"*129, None):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "ATSPI_APPLICATION_IDENTITY_INVALID"):
                MODULE.exact_generic_owner(self.pid, name, self.start)
    def test_generic_application_exact_app_and_window(self):
        self.desktop("QA.App")
        index, frame = MODULE.owner_frame(self.pid, "Exact QA",
            expected_app="QA.App", expected_start_ticks=self.start)
        self.assertEqual(index, 0)
        self.assertEqual(frame.get_name(), "Exact QA")
    def test_wrong_app_or_partial_owner_binding_rejected(self):
        self.desktop("Other.App")
        with self.assertRaisesRegex(ValueError, "ATSPI_OWNER_APP_NAME_CHANGED"):
            MODULE.owner_frame(self.pid, "Exact QA", expected_app="QA.App",
                expected_start_ticks=self.start)
        with self.assertRaisesRegex(ValueError, "ATSPI_PROCESS_GENERATION_INVALID"):
            MODULE.owner_frame(self.pid, "Exact QA", expected_app="QA.App")
    def test_generic_window_suffix_not_accepted(self):
        self.desktop("QA.App")
        with self.assertRaisesRegex(ValueError, "ATSPI_OWNER_WINDOW_AMBIGUOUS_OR_CHANGED"):
            MODULE.owner_frame(self.pid, "Exact QA — extra", expected_app="QA.App",
                expected_start_ticks=self.start)
    def test_duplicate_window_not_selected(self):
        self.desktop("QA.App", frames=["Exact QA", "Exact QA"])
        with self.assertRaisesRegex(ValueError, "ATSPI_OWNER_WINDOW_AMBIGUOUS_OR_CHANGED"):
            MODULE.owner_frame(self.pid, "Exact QA", expected_app="QA.App",
                expected_start_ticks=self.start)
    def test_legacy_firefox_mode_remains_unchanged(self):
        self.desktop("firefox")
        MODULE.owner_frame(self.pid, "Exact QA — Mozilla Firefox")
        self.desktop("QA.App")
        with self.assertRaisesRegex(ValueError, "ATSPI_OWNER_FIREFOX_PID_UNVERIFIED"):
            MODULE.owner_frame(self.pid, "Exact QA")
if __name__ == "__main__":
    unittest.main(verbosity=2)
