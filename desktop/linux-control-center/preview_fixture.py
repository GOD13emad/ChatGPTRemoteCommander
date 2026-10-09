"""Synthetic fixture for isolated GitHub Actions Xvfb only; no owner data."""
print("R42_PHASE_FIXTURE_BOOT", flush=True)
from dashboard_ui import run_dashboard
print("R42_PHASE_UI_IMPORTED", flush=True)

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
        # The content width becomes meaningful after frame size allocation;
        # poll only this synthetic X11 fixture, bounded to 12 observations.
        attempts = [0]

        def report():
            attempts[0] += 1
            if (center.window.get_width() <= 0 or
                    center.sidebar.get_width() <= 0 or
                    center.stack.get_width() <= 0):
                if attempts[0] < 12:
                    return GLib.SOURCE_CONTINUE
                print("R47_ALLOCATION_TIMEOUT_AFTER_12_FRAMES", flush=True)
                return GLib.SOURCE_REMOVE
            pages = center.stack.get_pages()
            total = pages.get_n_items()
            visible = sum(1 for i in range(total) if pages.get_item(i).get_visible())
            names = tuple(str(pages.get_item(i).get_title()) for i in range(total))
            print(f"R36_NATIVE_STACK_PAGES={total}_VISIBLE={visible}", flush=True)
            print("R36_NATIVE_STACK_TITLES=" + ",".join(names), flush=True)
            buttons = tuple(center.nav_buttons.values())
            drawn = sum(1 for b in buttons
                        if b.get_visible() and b.get_height() >= 20)
            active = sum(1 for b in buttons if b.has_css_class("rc-nav-active"))
            print(f"R39_NAV_BUTTONS={len(buttons)}_DRAWN={drawn}_ACTIVE={active}",
                  flush=True)
            # GTK4 >=4.12: get_width() is the supported content-width API.
            # Capture real image independently before accepting width.
            width = center.sidebar.get_width()
            req_width, req_height = center.sidebar.get_size_request()
            stack_width = center.stack.get_width()
            window_width = center.window.get_width()
            print(f"R46_SIDEBAR_CONTENT_WIDTH={width}", flush=True)
            print(f"R46_SIDEBAR_REQUEST={req_width}_{req_height}", flush=True)
            print(f"R46_STACK_WIDTH={stack_width}_WINDOW_WIDTH={window_width}", flush=True)
            return GLib.SOURCE_REMOVE

        GLib.timeout_add(180, report)

    raise SystemExit(run_dashboard(
        "io.github.god13emad.RemoteCommander.R35Synthetic",
        monitor, profiles, workflows, followup, dark, [],
        native_test_observer=diagnose_pages))
