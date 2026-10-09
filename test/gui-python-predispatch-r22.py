#!/usr/bin/env python3
"""R22 offline AST-only functional test of GUI pre-dispatch guard.

Extracts handle_input / handle functions only; no gi import, compositor,
D-Bus, native screen, keyboard, pointer or real input.
"""
import ast, pathlib, sys, time

target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[1] / "tools/gui-control-linux.py"
source = target.read_text(encoding="utf-8")
tree = ast.parse(source, filename=str(target))
parts = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ("handle_input", "handle")]
assert len(parts) == 2, "REQUIRED_FUNCTIONS_MISSING"

class GuiFailure(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

created = []

class MutterInput:
    def __init__(self, *args):
        created.append("CREATED")
        raise AssertionError("MUTTER_SESSION_WAS_CREATED")

def guard(req, deadline):
    raise GuiFailure("GUI_FOREGROUND_OR_GEOMETRY_CHANGED")

def stopped(req):
    return False

def guierr(code):
    return {"ok": False, "error": code}

def invoke_extension(req, timeout=6000):
    return {"ok": False, "error": "GUI_FOREGROUND_OR_GEOMETRY_CHANGED"}

ns = {
    "time": time,
    "OPERATION_TIMEOUT_S": 6.0,
    "guard": guard,
    "GuiFailure": GuiFailure,
    "MutterInput": MutterInput,
    "stopped": stopped,
    "guierr": guierr,
    "invoke_extension": invoke_extension,
}
exec(compile(ast.Module(body=parts, type_ignores=[]), str(target), "exec"), ns)

expected = {
    "ok": False,
    "error": "GUI_FOREGROUND_OR_GEOMETRY_CHANGED",
    "submission": "NOT_SUBMITTED",
}
for action in ("click", "move", "drag", "typeText", "keyPress"):
    actual = ns["handle_input"]({"action": action})
    assert actual == expected, (action, actual)
    assert not created, ("UNEXPECTED_NATIVE_SESSION", action)

focus = ns["handle"]({"action": "focusWindow"})
assert focus == expected, ("FOCUS_MISSING_PREDISPATCH_RECEIPT", focus)

# A malformed or post-dispatch native error may NOT become a certificate.
ns["invoke_extension"] = lambda req, timeout=6000: {
    "ok": False, "error": "GUI_FOREGROUND_OR_GEOMETRY_CHANGED", "extra": "malformed"
}
assert ns["handle"]({"action": "focusWindow"}) == {
    "ok": False, "error": "GUI_FOREGROUND_OR_GEOMETRY_CHANGED", "extra": "malformed"
}
ns["invoke_extension"] = lambda req, timeout=6000: {
    "ok": False, "error": "GUI_FOCUS_INVOKE_FAILED"
}
assert ns["handle"]({"action": "focusWindow"}) == {
    "ok": False, "error": "GUI_FOCUS_INVOKE_FAILED"
}
ns["guard"] = lambda req, deadline: (_ for _ in ()).throw(GuiFailure("GUI_OPERATION_TIMEOUT"))
try:
    ns["handle_input"]({"action": "click"})
except GuiFailure as exc:
    assert exc.code == "GUI_OPERATION_TIMEOUT"
else:
    raise AssertionError("TIMEOUT_FALSELY_CERTIFIED")
assert not created, "MUTTER_SESSION_STARTED"
print("R22_PYTHON_PREINPUT_AST_PASS")
