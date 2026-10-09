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
    # Synthetic CI-only introspection of real GTK page visibility. No owner state.
    import gi
    gi.require_version("Gtk", "4.0")
    from gi.repository import Gio, GLib, Gtk

    def locate_stack(widget):
        if isinstance(widget, Gtk.Stack):
            return widget
        if not isinstance(widget, Gtk.Widget):
            return None
        child = widget.get_first_child()
        while child is not None:
            found = locate_stack(child)
            if found is not None:
                return found
            child = child.get_next_sibling()
        return None

    def diagnose_pages():
        app = Gio.Application.get_default()
        window = app.get_active_window() if isinstance(app, Gtk.Application) else None
        stack = locate_stack(window) if window else None
        if stack is None:
            print("R36_NATIVE_STACK_PAGES=0_VISIBLE=0", flush=True)
            return GLib.SOURCE_REMOVE
        pages = stack.get_pages()
        total = pages.get_n_items()
        shown = sum(1 for i in range(total) if pages.get_item(i).get_visible())
        titles = tuple(pages.get_item(i).get_title() for i in range(total))
        print(f"R36_NATIVE_STACK_PAGES={total}_VISIBLE={shown}", flush=True)
        print("R36_NATIVE_STACK_TITLES="+",".join(str(x) for x in titles), flush=True)
        return GLib.SOURCE_REMOVE

    GLib.timeout_add_seconds(2, diagnose_pages)
    raise SystemExit(run_dashboard("io.github.god13emad.RemoteCommander.R35Synthetic",
                                   monitor,profiles,workflows,followup,dark,[]))
