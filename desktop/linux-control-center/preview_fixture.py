"""Synthetic fixture for isolated GitHub Actions Xvfb only; no owner data."""
from dashboard_ui import run_dashboard
import gi
from gi.repository import GLib

def monitor():
    return {"state":"CONNECTED","device":"CI synthetic preview","version":"0.10.20",
            "profile":"fixture","gui":"BLOCKED","guiReason":"Owner validation pending",
            "browser":"READY","activeOperations":0}
def profiles():
    return [
        {"id":"default","version":"0.10.20","port":48831,"generation":34,"root":"/CI/FAKE"},
        {"id":"secondary","version":"0.10.20","port":48832,"generation":3,"root":"/CI/FAKE"},
    ]
def workflows():
    return [
        {"id":"audit","state":"WAITING","revision":9},
        {"id":"native_validation","state":"PAUSED","revision":2},
        {"id":"failed_checkpoint","state":"FAILED","revision":1},
        {"id":"durable_not_live","state":"RUNNING","revision":6},
    ]
def followup():
    return {"state":"NOT_CONFIGURED_OR_UNVERIFIED","timerLiveState":"UNVERIFIED"}
def dark(*_):
    return False

if __name__=="__main__":
    print("R39_NATIVE_SYNTHETIC_FIXTURE_START", flush=True)
    def diagnose_pages(center):
        pages = center.stack.get_pages()
        total = pages.get_n_items()
        visible = sum(1 for i in range(total) if pages.get_item(i).get_visible())
        names = tuple(str(pages.get_item(i).get_title()) for i in range(total))
        print(f"R36_NATIVE_STACK_PAGES={total}_VISIBLE={visible}", flush=True)
        print("R36_NATIVE_STACK_TITLES=" + ",".join(names), flush=True)
        expected_routes = ("overview", "profiles", "tasks", "security")
        buttons = center.nav_buttons
        if tuple(buttons) != expected_routes or len(buttons) != 4:
            raise AssertionError("R43_EXPECTED_FOUR_NATIVE_NAV_BUTTONS")
        for destination in ("profiles", "tasks", "security", "overview"):
            control = buttons[destination]
            if not control.get_visible() or control.get_parent() is None:
                raise AssertionError("R43_NAV_BUTTON_NOT_VISIBLE")
            control.emit("clicked")
            if center.stack.get_visible_child_name() != destination:
                raise AssertionError("R43_NAV_DESTINATION_NOT_SELECTED_" + destination)
        print("R43_NATIVE_NAV_BUTTONS=4_ROUTING_PASS", flush=True)
        def verify_actual_sidebar_width():
            width = center._sidebar_native_widget.get_allocated_width()
            window_width = center.window.get_width()
            if 190 <= width <= 270 and window_width >= 900 and width * 100 <= window_width * 30:
                print(f"R44_NATIVE_SIDEBAR_WIDTH_PASS={width}_OF_{window_width}", flush=True)
            else:
                print(f"R44_NATIVE_SIDEBAR_WIDTH_FAIL={width}_OF_{window_width}", flush=True)
            return GLib.SOURCE_REMOVE
        GLib.timeout_add_seconds(2, verify_actual_sidebar_width)

    raise SystemExit(run_dashboard(
        "io.github.god13emad.RemoteCommander.R35Synthetic",
        monitor, profiles, workflows, followup, dark, [],
        native_test_observer=diagnose_pages))
