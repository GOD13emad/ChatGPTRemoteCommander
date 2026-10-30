"""Deterministic native Firefox AX traversal checks; no real desktop needed."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

TARGET = pathlib.Path(__file__).resolve().parents[1] / "tools" / "owner-atspi-semantic.py"
spec = importlib.util.spec_from_file_location("v2_bounded_atspi", TARGET)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FakeNode:
    def __init__(self, name="container", role="panel", children=None,
                 action=False, editable=False):
        self.name = name
        self.role = role
        self.children = children or []
        self.action = action
        self.editable = editable
        self.value_reads = 0

    def get_role_name(self):
        return self.role

    def get_name(self):
        return self.name

    def get_child_count(self):
        return len(self.children)

    def get_child_at_index(self, index):
        return self.children[index]

    def is_action(self):
        return self.action

    def is_editable_text(self):
        return self.editable

    def get_action_iface(self):
        return None if not self.action else FakeActions()

    def get_text(self, *_):
        self.value_reads += 1
        raise AssertionError("Reading an accessibility value is forbidden")


class FakeActions:
    def get_n_actions(self):
        return 1

    def get_action_name(self, _):
        return "click"


class TestBoundedATSPISnapshot(unittest.TestCase):
    def test_large_tree_exhausts_node_cap_without_password_or_value_reads(self):
        nodes = [FakeNode(name="password credential", role="entry", editable=True),
                 FakeNode(name="Search field", role="entry", editable=True),
                 FakeNode(name="Search", role="button", action=True)]
        root = FakeNode(children=nodes + [FakeNode(name=f"n{i}") for i in range(400)])
        with patch.object(mod.time, "monotonic", return_value=5.0):
            result = mod.snapshot(root, deadline=9.0)
        self.assertTrue(result["ok"])
        self.assertTrue(result["truncated"])
        self.assertLessEqual(result["nodesVisited"], mod.MAX_NODES)
        self.assertTrue(result["valuesRead"] is False)
        self.assertTrue(result["monitorCoordinatesUsed"] is False)
        self.assertEqual([v["name"] for v in result["controls"]], ["Search field", "Search"])
        self.assertTrue(all(n.value_reads == 0 for n in nodes))

    def test_budget_expiry_returns_only_bounded_partial_not_ambiguous_effect(self):
        root = FakeNode(children=[FakeNode(name=f"node{i}") for i in range(80)])
        tick = iter([0.0, 0.0, 0.0, 0.2, 0.8, 1.8, 2.1, 2.2, 4.2])
        def clock():
            return next(tick, 5.0)
        with patch.object(mod.time, "monotonic", side_effect=clock):
            result = mod.snapshot(root, deadline=3.0)
        self.assertTrue(result["truncated"])
        self.assertLess(result["nodesVisited"], mod.MAX_NODES)
        self.assertFalse(result["controls"])

    def test_execute_snapshot_applies_official_lib_atspi_per_call_limits(self):
        root = FakeNode(children=[FakeNode(name="Yes",role="push button",action=True)])
        with patch.object(mod.Atspi, "set_timeout") as set_timeout, \
             patch.object(mod, "owner_frame", return_value=(0,root)) as owner, \
             patch.object(mod.time, "monotonic", return_value=0.0):
            result = mod.execute({"command":"snapshot","pid":1234,"windowTitle":"Owner Firefox"})
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["controls"]),1)
        set_timeout.assert_called_once_with(350,750)
        self.assertIsNotNone(owner.call_args.args)
        self.assertEqual(owner.call_args.args[:2], (1234,"Owner Firefox"))


if __name__ == "__main__":
    unittest.main()
