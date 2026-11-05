"""Opt-in owner-local profile controls for a single managed Commander preview.

No credential access, shell, privilege escalation, legacy Router mutation, or
automatic work. Actions require an explicit click in the native GTK window.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import threading


def _unique_json_pairs(pairs):
    """Reject ambiguous duplicate keys in any nested CLI/manifest object."""
    data = {}
    for key, value in pairs:
        if key in data:
            raise ValueError("CLI_DUPLICATE_JSON_OBJECT_KEY")
        data[key] = value
    return data


def managed_root():
    value = os.environ.get("COMMANDER_ONE_MANAGED_ROOT", "")
    if not value:
        return None
    root = Path(value).absolute()
    try:
        home = Path.home().resolve()
        if (root.is_symlink() or not root.is_relative_to(home) or
                root.resolve(strict=True) != root):
            return None
        marker = root / "product.json"
        if marker.is_symlink() or not marker.is_file():
            return None
        obj = json.loads(marker.read_text(encoding="utf8"), object_pairs_hook=_unique_json_pairs)
        if obj.get("schema") != 1 or obj.get("product") != "ChatGPTRemoteCommander":
            return None
        if not (root / "bin/node").is_file() or not (root / "Commander.cjs").is_file():
            return None
        if (root / "bin/node").is_symlink() or (root / "Commander.cjs").is_symlink():
            return None
        return root
    except (OSError, ValueError, TypeError, KeyError):
        return None


def available_profiles(root):
    folder = root / "state/profiles"
    if (not folder.is_dir() or folder.is_symlink() or
            (root / "state").is_symlink()):
        return ()
    found = []
    for item in sorted(folder.glob("*.json")):
        if item.is_symlink():
            continue
        name = item.stem
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9._-]{0,39}", name):
            found.append(name)
    return tuple(found)


def verified_lifecycle_receipt(receipt, action: str, profile: str) -> bool:
    """General ok=True is not proof that the named action succeeded."""
    if type(receipt) is not dict or receipt.get("ok") is not True or receipt.get("profile") != profile:
        return False
    if action == "start":
        return receipt.get("started") is True and receipt.get("verifiedHealth") is True
    if action == "stop":
        return receipt.get("stopped") is True and receipt.get("verifiedIdentity") is True
    if action == "runtime-status":
        return receipt.get("running") is True and receipt.get("verified") is True
    return False


def reported_stopped_receipt(receipt, action: str, profile: str) -> bool:
    return (action == "runtime-status" and type(receipt) is dict and
            receipt.get("ok") is True and receipt.get("profile") == profile and
            receipt.get("running") is False and receipt.get("verified") is False)


def safe_lifecycle_display(receipt, action: str, profile: str) -> dict:
    """Explicit UI field allowlist; never display raw backend receipts."""
    verified = verified_lifecycle_receipt(receipt, action, profile)
    stopped = reported_stopped_receipt(receipt, action, profile)
    safe = {
        "profile": profile, "action": action,
        "verification": "verified" if verified else "reported-stopped" if stopped else "unverified"
    }
    if verified and action == "start":
        safe.update(started=True, verifiedHealth=True)
    elif verified and action == "stop":
        safe.update(stopped=True, verifiedIdentity=True)
    elif verified and action == "runtime-status":
        safe.update(running=True, verified=True)
    elif stopped:
        safe.update(running=False, verified=False)
    return safe


def run_profile_command(root, profile, action, timeout=24, *, cancel_event=None):
    """Run only the explicit local lifecycle actions through bounded CLI I/O.

    _cli validates the managed identity and selected profile, caps stdout/stderr
    at 24 KB while reading, and kills only its private process group on error.
    """
    if action not in ("start", "stop", "runtime-status"):
        raise ValueError("INVALID_OWNER_ACTION")
    if profile not in available_profiles(root):
        raise ValueError("INVALID_OWNER_PROFILE")
    receipt = _cli(root, profile, action, timeout=timeout, allow_mutation=True,
                   cancel_event=cancel_event)
    verified = verified_lifecycle_receipt(receipt, action, profile)
    reported_stopped = reported_stopped_receipt(receipt, action, profile)
    if not verified and not reported_stopped:
        raise ValueError("CLI_ACTION_RECEIPT_UNVERIFIED")
    return {"receipt": receipt, "exitCode": 0, "verified": verified,
            "reportedStopped": reported_stopped}

def install_managed_controls(parent, Gtk, GLib):
    root = managed_root()
    if root is None:
        return False

    panel = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
    panel.set_margin_top(12)
    panel.set_margin_bottom(14)
    panel.set_margin_start(14)
    panel.set_margin_end(14)

    heading = Gtk.Label(label="Managed Preview Profiles", xalign=0)
    heading.add_css_class("title-3")
    panel.append(heading)

    note = Gtk.Label(
        label="Start, inspect or stop ONLY a profile of this owner-local preview. "
              "No actions on legacy Routers or other users' applications.",
        xalign=0, wrap=True)
    panel.append(note)

    row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
    profiles = available_profiles(root)
    picker = Gtk.DropDown.new_from_strings(list(profiles) or ["No profiles"])
    picker.set_sensitive(bool(profiles))
    row.append(picker)

    result = Gtk.Label(label="Select an action. No background operation is scheduled.",
                       xalign=0, wrap=True, selectable=True)
    result.set_margin_top(7)
    buttons = []
    waiting_for_stop_confirmation = {"profile": None}
    scope = {"open": True, "owner": None}
    cancelled = threading.Event()

    def on_owner_close(_window):
        scope["open"] = False
        waiting_for_stop_confirmation["profile"] = None
        cancelled.set()  # CLI child is then terminated with outcome UNKNOWN.
        return False

    def bind_owner_window():
        window = parent.get_root()
        if isinstance(window, Gtk.Window) and scope["owner"] is not window:
            scope["owner"] = window
            window.connect("close-request", on_owner_close)

    def update(status):
        if not scope["open"]:
            return False
        result.set_text(status[:2000])
        return False

    def on_profile_changed(_picker, _property):
        # A Stop confirmation is a one-shot decision for the exact selected
        # profile; switching away and back must not re-use a prior confirmation.
        if waiting_for_stop_confirmation["profile"] is not None:
            waiting_for_stop_confirmation["profile"] = None
            update("Profile changed; pending Stop confirmation cleared.")
    picker.connect("notify::selected", on_profile_changed)

    def action(name):
        bind_owner_window()
        if not scope["open"] or not profiles:
            return
        selected = picker.get_selected()
        if selected >= len(profiles):
            return
        profile = profiles[selected]
        if name == "stop" and waiting_for_stop_confirmation["profile"] != profile:
            waiting_for_stop_confirmation["profile"] = profile
            update("Click Stop again to confirm stopping " + profile + ".")
            return
        waiting_for_stop_confirmation["profile"] = None
        # Prevent the visible profile from changing while an action's immutable
        # profile-scoped receipt is in flight.
        picker.set_sensitive(False)
        for button in buttons:
            button.set_sensitive(False)
        update(profile + " • " + name + " • verifying...")
        def execute():
            try:
                response = run_profile_command(root, profile, name,
                                               cancel_event=cancelled)
                receipt = response["receipt"]
                text = json.dumps(safe_lifecycle_display(receipt, name, profile),
                                  ensure_ascii=False, indent=2)
                status = ("VERIFIED" if response["verified"] else
                          "REPORTED STOPPED (CLI only; no running identity)" if response.get("reportedStopped") else
                          "UNVERIFIED")
                message = status + " • " + profile + " • " + name + "\n" + text
            except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
                message = ("UNVERIFIED • " + profile + " • " + name + "\n"
                           + type(exc).__name__ + " (raw CLI output withheld; use Status to reconcile)")
            def restore_scope():
                if not scope["open"]:
                    return False
                picker.set_sensitive(bool(profiles))
                for button in buttons:
                    button.set_sensitive(True)
                return False
            GLib.idle_add(update, message)
            GLib.idle_add(restore_scope)
        threading.Thread(target=execute, daemon=True, name="commander-managed-action").start()

    for title, key in (("Status", "runtime-status"), ("Start", "start"), ("Stop", "stop")):
        button = Gtk.Button(label=title)
        button.set_tooltip_text("Explicit owner-local " + title.lower() + " for this preview")
        button.connect("clicked", lambda _btn, operation=key: action(operation))
        row.append(button)
        buttons.append(button)

    # The existing V1-08 builder includes this one managed_controls.py file.
    # A new read-only Control Center is therefore usable without modifying the
    # installer, the router, or the packaged dev23 native GTK dashboard.
    center_button = Gtk.Button(label="Control Center")
    center_button.set_tooltip_text("Read verified owner-local CLI status; unavailable data stays unknown")
    def open_center(_button):
        if not scope["open"] or not profiles:
            return
        index = picker.get_selected()
        if index >= len(profiles):
            return
        try:
            launch_window(root, profiles, initial_profile=profiles[index])
        except (OSError, ValueError, RuntimeError) as exc:
            update("Control Center unavailable: " + type(exc).__name__)
    center_button.connect("clicked", open_center)
    row.append(center_button)
    buttons.append(center_button)

    panel.append(row)
    panel.append(result)
    parent.prepend(panel) if hasattr(parent, "prepend") else parent.append(panel)
    return True

# V1-10 verified read-only GTK4 Control Center, integrated with owner-local profile UI.
"""Commander V1 / V1-10 GTK4 read-only control center candidate.

Owner-local managed preview only. Never interacts with existing Routers, users'
desktops, native privilege brokers or unapproved browser sessions. Do not confuse
an installer metadata response with verified ChatGPT identity or OS elevation.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import threading
import os
import selectors
import signal
import time

ACTIONS = frozenset(("status", "runtime-status", "autostart-status"))
CATEGORIES = (
    "Managed host", "Profiles / accounts", "Runtime / connection", "Permissions",
    "Active operations", "Task queue", "History / receipts", "Errors",
    "Resource monitoring", "AI / extensions", "GUI control", "Update / rollback",
)
PROFILE_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9._-]{0,39}\Z")
UNAVAILABLE = "Unavailable / not verified"


@dataclass(frozen=True)
class Observation:
    observed_at_utc: str
    selected_profile: str
    values: dict[str, str]
    diagnostics: tuple[str, ...]


def validate_managed_root(root: Path) -> Path:
    """Bound the executable path to an existing owner-managed preview root.

    This is local file identity, not a publisher signature or network principal.
    """
    home = Path.home().resolve()
    if root.is_symlink():
        raise ValueError("MANAGED_ROOT_ALIAS_UNTRUSTED")
    root = root.resolve(strict=True)
    if not root.is_relative_to(home):
        raise ValueError("MANAGED_ROOT_NOT_OWNER_LOCAL")
    marker = root / "product.json"
    if not marker.is_file() or marker.is_symlink():
        raise ValueError("MANAGED_MARKER_INVALID")
    data = json.loads(marker.read_text(encoding="utf-8"), object_pairs_hook=_unique_json_pairs)
    if type(data.get("schema")) is not int or data["schema"] != 1 or data.get("product") != "ChatGPTRemoteCommander":
        raise ValueError("MANAGED_MARKER_IDENTITY_INVALID")
    for intermediate in (root / "bin", root / "state", root / "state/profiles"):
        if intermediate.is_symlink():
            raise ValueError("MANAGED_INTERMEDIATE_ALIAS_UNTRUSTED")
    for child in (root / "Commander.cjs", root / "bin/node"):
        if not child.is_file() or child.is_symlink():
            raise ValueError("MANAGED_EXECUTABLE_INVALID")
    return root


def _cli(root: Path, profile: str, action: str, timeout: int = 6,
         *, allow_mutation: bool = False, cancel_event=None) -> dict:
    permitted = action in ACTIONS or (allow_mutation and action in ("start", "stop"))
    if not permitted or not PROFILE_PATTERN.fullmatch(profile):
        raise ValueError("DISALLOWED_CLI_ACTION_OR_PROFILE")
    if cancel_event is not None and cancel_event.is_set():
        raise RuntimeError("CLI_CANCELLED_OUTCOME_UNKNOWN")
    root = validate_managed_root(root)
    profile_file = root / "state/profiles" / (profile + ".json")
    if not profile_file.is_file() or profile_file.is_symlink():
        raise ValueError("MANAGED_PROFILE_NOT_FOUND_OR_ALIAS")
    # Bounded incremental pipe reads: communicate()/capture_output would buffer
    # untrusted process output without a cap before checking its final length.
    argv = [str(root / "bin/node"), str(root / "Commander.cjs"), "--" + action,
            "--target", str(root), "--profile", profile]
    process = subprocess.Popen(argv, cwd=root, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    streams = {"stdout": bytearray(), "stderr": bytearray()}
    started = time.monotonic()
    selector = selectors.DefaultSelector()
    failed = False
    try:
        assert process.stdout is not None and process.stderr is not None
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        while selector.get_map():
            if cancel_event is not None and cancel_event.is_set():
                raise RuntimeError("CLI_CANCELLED_OUTCOME_UNKNOWN")
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise subprocess.TimeoutExpired(argv, timeout)
            events = selector.select(min(remaining, 0.1) if cancel_event is not None else remaining)
            if not events:
                if cancel_event is not None:
                    continue
                raise subprocess.TimeoutExpired(argv, timeout)
            for key, _ in events:
                chunk = os.read(key.fileobj.fileno(), 4096)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                received = streams[key.data]
                if len(received) + len(chunk) > 24000:
                    raise RuntimeError(action + "_CLI_OUTPUT_OVERSIZED")
                received.extend(chunk)
        while process.poll() is None:
            if cancel_event is not None and cancel_event.is_set():
                raise RuntimeError("CLI_CANCELLED_OUTCOME_UNKNOWN")
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise subprocess.TimeoutExpired(argv, timeout)
            try:
                process.wait(timeout=min(remaining, 0.1) if cancel_event is not None else remaining)
            except subprocess.TimeoutExpired:
                if cancel_event is None:
                    raise
        if cancel_event is not None and cancel_event.is_set():
            raise RuntimeError("CLI_CANCELLED_OUTCOME_UNKNOWN")
        if process.returncode != 0:
            raise RuntimeError(action + "_CLI_NONZERO_EXIT")
        data = json.loads(streams["stdout"].decode("utf-8", errors="strict"),
                          object_pairs_hook=_unique_json_pairs)
    except BaseException:
        failed = True
        raise
    finally:
        selector.close()
        if failed or process.poll() is None:
            # Kill only the private process group created for this CLI. The
            # immediate parent may already have exited while descendants keep
            # stdout open; polling the parent alone must not leak children.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=2)
        if process.stdout: process.stdout.close()
        if process.stderr: process.stderr.close()
    if not isinstance(data, dict) or data.get("ok") is not True:
        raise ValueError(action + "_UNVERIFIED_PAYLOAD")
    return data


def safe_status_label(value, max_length=100):
    """Reject control, bidi, HTML-like and oversized untrusted CLI labels."""
    if (type(value) is not str or not value or len(value) > max_length or
            "<" in value or ">" in value or not value.isprintable()):
        return None
    return value


def safe_diagnostics_report(profile: str, shown: dict, status: str) -> str:
    """Only the UI's known categories; no raw CLI fields, stdout or stderr."""
    if not PROFILE_PATTERN.fullmatch(profile):
        raise ValueError("REPORT_PROFILE_INVALID")
    lines = [
        "Commander V1 | owner-local Control Center diagnostics",
        "Exported at UTC: " + datetime.now(timezone.utc).isoformat(),
        "Selected managed profile: " + profile,
        "Source: bounded local CLI --status / --runtime-status / --autostart-status",
        "NOT evidence of authenticated remote identity, OS grants or fleet health.",
        "Current observation: " + (safe_status_label(status, 350) or "not verified"),
        ""
    ]
    for category in CATEGORIES:
        value = shown.get(category, UNAVAILABLE)
        # The only exported values are the same typed, already-rendered tiles.
        if type(value) is not str or len(value) > 700 or not value.isprintable():
            value = UNAVAILABLE
        lines.extend((category, value, ""))
    return "\n".join(lines)


def collect(root: Path, profile: str, execute=_cli) -> Observation:
    """Collect actual limited CLI observations; independent missing feeds stay unknown."""
    root = Path(root)
    if not PROFILE_PATTERN.fullmatch(profile):
        raise ValueError("INVALID_PROFILE_NAME")
    tiles = {key: UNAVAILABLE for key in CATEGORIES}
    errors = []
    stamp = datetime.now(timezone.utc).isoformat()
    try:
        status = execute(root, profile, "status")
        if status.get("ok") is not True or status.get("product") != "ChatGPTRemoteCommander":
            raise ValueError("MANAGED_PRODUCT_MISMATCH")
        names = status.get("profiles")
        if not isinstance(names, list) or profile not in names or len(names) > 51 or not all(
            isinstance(x, str) and PROFILE_PATTERN.fullmatch(x) for x in names
        ):
            raise ValueError("SELECTED_PROFILE_NOT_IN_BACKEND_STATUS")
        build = status.get("build")
        mode = status.get("mode")
        safe_build = safe_status_label(build, 100)
        safe_mode = safe_status_label(mode, 50)
        if safe_build is not None:
            tiles["Managed host"] = "Local preview / build " + safe_build
        if safe_mode is not None:
            tiles["Permissions"] = "Package mode " + safe_mode + "; native OS grant unknown"
        tiles["Profiles / accounts"] = str(len(names)) + " profiles; account identity unknown"
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        errors.append("status: " + type(exc).__name__)
        tiles["Errors"] = "Status CLI rejected or unavailable (" + type(exc).__name__ + ")"
        return Observation(stamp, profile, tiles, tuple(errors))

    try:
        runtime = execute(root, profile, "runtime-status")
        if runtime.get("ok") is True and runtime.get("profile") == profile:
            if runtime.get("running") is True and runtime.get("verified") is True:
                tiles["Runtime / connection"] = "Local backend running (identity-checked by CLI)"
            elif runtime.get("running") is False and runtime.get("verified") is False:
                tiles["Runtime / connection"] = "Backend stopped (CLI reported)"
            # Missing or contradictory verification remains explicitly unknown.
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        errors.append("runtime-status: " + type(exc).__name__)
        tiles["Errors"] = "Runtime CLI unavailable (" + type(exc).__name__ + ")"

    try:
        startup = execute(root, profile, "autostart-status")
        if startup.get("ok") is True and startup.get("profile") == profile and type(startup.get("autostartEnabled")) is bool:
            tiles["Update / rollback"] = (
                "Autostart " + ("enabled" if startup["autostartEnabled"] else "disabled") +
                "; updater and rollback state unknown"
            )
            if startup.get("reconcileRequired") is True:
                tiles["Update / rollback"] += "; reconciliation needed"
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        errors.append("autostart-status: " + type(exc).__name__)
        tiles["Errors"] = ("Multiple CLI read failures" if len(errors) > 1 else
                           "Autostart CLI unavailable (" + type(exc).__name__ + ")")
    return Observation(stamp, profile, tiles, tuple(errors))


def launch_window(root: Path, profiles: tuple[str, ...], initial_profile: str | None = None):
    """Start GTK4 only when user explicitly opens this candidate app."""
    root = validate_managed_root(root)
    if not profiles or any(not PROFILE_PATTERN.fullmatch(name) or
                           not (root / "state/profiles" / (name + ".json")).is_file() or
                           (root / "state/profiles" / (name + ".json")).is_symlink()
                           for name in profiles):
        raise ValueError("MANAGED_PROFILES_INVALID")
    import gi
    gi.require_version("Gtk", "4.0")
    from gi.repository import Gtk, GLib, Gdk, GObject

    provider = Gtk.CssProvider()
    provider.load_from_data(b"""
        window.commander-ui { background-color: #0d1728; color: #e6eefb; }
        label.commander-heading { color: #f5f9ff; font-weight: 800; font-size: 25px; margin: 0 0 8px 0; }
        box.commander-toolbar { background-color: #15253b; border-radius: 12px; padding: 12px; }
        dropdown.commander-picker { min-width: 175px; }
        button.commander-refresh { background: #1a74af; color: #f8fcff; border-radius: 9px; padding: 8px 18px; font-weight: bold; }
        label.commander-status { color: #8abfe9; font-size: 13px; margin: 8px 0; }
        frame.commander-card { background-color: #182940; border: 1px solid #2e4664; border-radius: 12px; padding: 6px; }
        frame.commander-card > label { color: #9ac9ff; font-weight: bold; }
        label.commander-value { color: #c6d7ed; font-size: 13px; }
        label.commander-footnote { color: #8c9fb8; font-size: 12px; margin-top: 5px; }
    """)
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    window = Gtk.Window(title="Commander V1 | Verified Control Center")
    window.add_css_class("commander-ui")
    window.set_default_size(1160, 760)
    window.set_name("commander-v1-local-control-center")
    outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
    outer.set_margin_top(24); outer.set_margin_bottom(20)
    outer.set_margin_start(24); outer.set_margin_end(24)
    window.set_child(outer)
    heading = Gtk.Label(label="Commander V1  /  Control Center", xalign=0)
    heading.add_css_class("commander-heading")
    heading.add_css_class("title-2")
    outer.append(heading)
    toolbar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
    toolbar.add_css_class("commander-toolbar")
    outer.append(toolbar)
    picker = Gtk.DropDown.new_from_strings(list(profiles) or ["No managed profiles"])
    picker.set_sensitive(bool(profiles))
    if initial_profile in profiles:
        picker.set_selected(profiles.index(initial_profile))
    picker.add_css_class("commander-picker")
    toolbar.append(picker)
    button = Gtk.Button(label="Refresh verified data")
    button.add_css_class("commander-refresh")
    button.set_sensitive(bool(profiles))
    toolbar.append(button)
    copy_button = Gtk.Button(label="Copy diagnostics")
    copy_button.set_tooltip_text("Explicitly copy only the visible local data; never raw CLI output")
    toolbar.append(copy_button)
    status = Gtk.Label(label="No status requested", xalign=0)
    status.set_wrap(True)
    status.add_css_class("commander-status")
    outer.append(status)
    scroll = Gtk.ScrolledWindow(vexpand=True)
    grid = Gtk.Grid(column_spacing=14, row_spacing=14)
    grid.set_column_homogeneous(True)
    labels = {}
    for i, category in enumerate(CATEGORIES):
        frame = Gtk.Frame(label=category)
        frame.add_css_class("commander-card")
        label = Gtk.Label(label=UNAVAILABLE, wrap=True, xalign=0, yalign=0)
        label.add_css_class("commander-value")
        label.set_margin_top(14); label.set_margin_bottom(14)
        label.set_margin_start(14); label.set_margin_end(14)
        frame.set_child(label)
        grid.attach(frame, i % 3, i // 3, 1, 1)
        labels[category] = label
    scroll.set_child(grid)
    outer.append(scroll)
    foot = Gtk.Label(label="Only owner-local managed CLI is queried; no admin, account or remote identity is inferred.", xalign=0)
    foot.set_wrap(True)
    foot.add_css_class("commander-footnote")
    outer.append(foot)
    generation = {"id": 0}
    alive = {"open": True}
    def on_close(_window):
        alive["open"] = False
        generation["id"] += 1
        return False
    window.connect("close-request", on_close)

    def reset(*_):
        generation["id"] += 1
        for label in labels.values():
            label.set_label(UNAVAILABLE)
        status.set_label("Selection changed; refresh for this profile")

    def copy_diagnostics(_button):
        if not alive["open"] or not copy_button.get_sensitive() or not profiles:
            return
        index = picker.get_selected()
        if index >= len(profiles):
            return
        try:
            report = safe_diagnostics_report(
                profiles[index], {key: labels[key].get_label() for key in CATEGORIES},
                status.get_label())
            display = Gdk.Display.get_default()
            if display is None:
                raise RuntimeError("GTK_CLIPBOARD_DISPLAY_UNAVAILABLE")
            # GTK4 Gdk.Clipboard exposes GObject.Value/set_content, not set_text.
            value = GObject.Value(GObject.TYPE_STRING, report)
            provider = Gdk.ContentProvider.new_for_value(value)
            if not display.get_clipboard().set_content(provider):
                raise RuntimeError("GTK_CLIPBOARD_SET_REJECTED")
            status.set_label("Local diagnostics copied (no raw CLI output)")
        except (OSError, RuntimeError, ValueError, TypeError) as exc:
            status.set_label("Unable to copy diagnostics: " + type(exc).__name__)

    def refresh(*_):
        if not alive["open"] or not profiles:
            return
        idx = picker.get_selected()
        if idx >= len(profiles):
            return
        name = profiles[idx]
        generation["id"] += 1
        this = generation["id"]
        button.set_sensitive(False)
        copy_button.set_sensitive(False)
        picker.set_sensitive(False)
        status.set_label(name + ": querying local CLI...")
        for label in labels.values():
            label.set_label(UNAVAILABLE)

        def deliver(observation):
            if not alive["open"] or this != generation["id"]:
                return False
            for category, value in observation.values.items():
                labels[category].set_label(value)
            status.set_label(name + ": observed " + observation.observed_at_utc +
                             (" / " + ", ".join(observation.diagnostics) if observation.diagnostics else ""))
            picker.set_sensitive(True)
            button.set_sensitive(True)
            copy_button.set_sensitive(True)
            return False

        def worker():
            try:
                observation = collect(root, name)
            except Exception as exc:
                observation = Observation(datetime.now(timezone.utc).isoformat(), name,
                    {key: UNAVAILABLE for key in CATEGORIES},
                    ("Unexpected failure: " + type(exc).__name__,))
            GLib.idle_add(deliver, observation)
        threading.Thread(target=worker, daemon=True, name="commander-ui-read-only-snapshot").start()

    picker.connect("notify::selected", reset)
    button.connect("clicked", refresh)
    copy_button.connect("clicked", copy_diagnostics)
    # Embed in the existing GtkApplication event loop rather than starting a
    # nested GLib main loop. Window is opened by an explicit owner click.
    application = Gtk.Application.get_default()
    if isinstance(application, Gtk.Application):
        window.set_application(application)
    window.present()
    GLib.idle_add(refresh)
    return window
    loop.run()
