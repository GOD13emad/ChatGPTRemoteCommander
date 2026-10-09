"""Synthetic fixture for isolated GitHub Actions Xvfb only; no owner data."""
from dashboard_ui import run_dashboard

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
    def diagnose_pages(center):
        # Inspect actual allocations after GTK layout, not merely visible=True
        # on model pages; a visually absent navigation button fails the gate.
        from gi.repository import GLib

        def report():
            pages = center.stack.get_pages()
            total = pages.get_n_items()
            visible = sum(1 for i in range(total) if pages.get_item(i).get_visible())
            names = tuple(str(pages.get_item(i).get_title()) for i in range(total))
            print(f"R36_NATIVE_STACK_PAGES={total}_VISIBLE={visible}", flush=True)
            print("R36_NATIVE_STACK_TITLES=" + ",".join(names), flush=True)
            buttons = tuple(center.nav_buttons.values())
            drawn = sum(1 for b in buttons
                        if b.get_visible() and b.get_allocated_height() >= 20)
            active = sum(1 for b in buttons if b.has_css_class("rc-nav-active"))
            print(f"R39_NAV_BUTTONS={len(buttons)}_DRAWN={drawn}_ACTIVE={active}",
                  flush=True)
            return GLib.SOURCE_REMOVE

        GLib.timeout_add(1, report)

    raise SystemExit(run_dashboard(
        "io.github.god13emad.RemoteCommander.R35Synthetic",
        monitor, profiles, workflows, followup, dark, [],
        native_test_observer=diagnose_pages))
