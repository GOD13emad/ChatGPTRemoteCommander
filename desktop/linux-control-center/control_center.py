#!/usr/bin/python3
"""Remote Commander Control Center: native GNOME/Adwaita 1, safe owner-only monitoring UI.
No network / shell / credential access. Management mutations disabled until an
authenticated, revision-checked Core IPC is independently accepted.
"""
import json
import os
import re
import sqlite3
import stat
import sys
import time
from pathlib import Path

APP_ID = "io.github.god13emad.RemoteCommander.ControlCenter"
HOME = Path.home()
STATE = HOME / ".local/state/chatgpt-remote-commander"
MONITOR = STATE / "browser-companion/commander-monitor.json"
ROUTING = STATE / "routing"
WORKFLOWS = STATE / "instances/default/workflows/workflows.sqlite"
PROFILE_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
MAX_BYTES = 64 * 1024
AUTOFOLLOW_ROOT = HOME / "source/repos/RC_AUTOFOLLOW_R1"
AUTOFOLLOW_UNITS = HOME / ".config/systemd/user"


def effective_system_dark(preference: str, gtk_theme: str = "", gtk_override: str = "") -> bool:
    """GNOME color-scheme has priority; in Default mode honor an explicitly
    dark GTK theme. Do not write or change desktop preferences.
    """
    pref = (preference or "").strip().strip("\\'\\\"").casefold()
    if pref == "prefer-dark":
        return True
    if pref == "prefer-light":
        return False
    selected = (gtk_override or gtk_theme or "").casefold()
    return bool(re.search(r"(?:^|[-_: ])dark(?:$|[-_: ])", selected))



def bounded_json(path: Path, limit=MAX_BYTES):
    """Read only owner-controlled regular files. Never follow symlink input."""
    try:
        st = path.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid():
            return None
        if st.st_size > limit or st.st_size < 2:
            return None
        if st.st_mode & 0o022:
            return None
        with path.open("rb") as f:
            raw = f.read(limit + 1)
        if len(raw) > limit:
            return None
        value = json.loads(raw)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError, UnicodeError):
        return None


def monitor_status():
    m = bounded_json(MONITOR, 16384)
    if not m or m.get("schema") != 1 or m.get("kind") != "COMMANDER_LIVE_MONITOR":
        return {"state": "UNVERIFIED", "reason": "Missing/untrusted private monitor"}
    now = int(time.time() * 1000)
    expires = m.get("expiresAtEpochMs")
    observed = m.get("observedAtEpochMs")
    if not isinstance(expires, int) or not isinstance(observed, int):
        return {"state": "UNVERIFIED", "reason": "Missing timestamps"}
    if observed > now + 30000 or expires < now:
        return {"state": "DISCONNECTED", "reason": "Monitor stale"}
    identity = m.get("identity") or {}
    gui = m.get("gui") or {}
    operations = m.get("operations") or {}
    return {
        "state": "CONNECTED",
        "device": str(identity.get("deviceName", "?"))[:80],
        "version": str(identity.get("version", "?"))[:40],
        "profile": str(identity.get("profile", "?"))[:64],
        "gui": "READY" if gui.get("available") is True else "BLOCKED",
        "guiReason": str(gui.get("reason") or "")[:100],
        "browser": "READY" if (m.get("browser") or {}).get("available") is True else "UNAVAILABLE",
        "activeOperations": operations.get("active", 0),
        "extensions": len((m.get("extensions") or {}).get("items") or []),
    }


def profiles():
    records = []
    if not ROUTING.is_dir() or ROUTING.is_symlink():
        return records
    for f in sorted(ROUTING.glob("*.json")):
        if f.name.endswith(".runtime.json"):
            continue
        name = f.stem
        if not PROFILE_RE.fullmatch(name) or ".." in name:
            continue
        meta = bounded_json(f, 4096)
        runtime_path = ROUTING / (name + ".runtime.json")
        runtime = bounded_json(runtime_path, 4096)
        if not meta or not runtime or meta.get("profile") != name:
            continue
        if runtime.get("stateFile") != str(f.resolve()):
            continue
        active = meta.get("active") or {}
        records.append({
            "id": name,
            "version": str(active.get("version") or "UNKNOWN")[:30],
            "port": active.get("port"),
            "generation": meta.get("generation"),
            "root": str(active.get("projectDir") or "")[:160],
        })
    return records


def workflows(limit=300):
    # Read only the existing owner-state database; SQLite query_only prevents
    # implicit schema migration, scheduling, revision writes or task execution.
    if not WORKFLOWS.is_file() or WORKFLOWS.is_symlink():
        return []
    if WORKFLOWS.stat().st_uid != os.getuid():
        return []
    records = []
    try:
        import urllib.parse
        uri = "file:" + urllib.parse.quote(str(WORKFLOWS), safe="/") + "?mode=ro"
        c = sqlite3.connect(uri, uri=True, timeout=0.4)
        try:
            c.execute("PRAGMA query_only=ON")
            c.execute("PRAGMA busy_timeout=400")
            cursor = c.execute("SELECT id,revision,snapshot FROM workflows ORDER BY id LIMIT ?", (limit,))
            for ident, rev, snapshot in cursor:
                if not isinstance(ident, str) or not PROFILE_RE.fullmatch(ident):
                    continue
                if not isinstance(snapshot, str) or len(snapshot) > 500_000:
                    continue
                try:
                    doc = json.loads(snapshot)
                except (ValueError, TypeError):
                    continue
                state = str(doc.get("lifecycleState") or "UNKNOWN")[:30]
                records.append({"id": ident, "revision": rev, "state": state})
        finally:
            c.close()
    except (OSError, sqlite3.Error):
        return []
    return records



def autofollow_status(root=None, unit_dir=None):
    """Show only explicit owner-private receipt metadata. Never trust plan text
    as an action and never infer a live systemd process from old install logs.
    """
    import hashlib
    project = Path(root) if root is not None else AUTOFOLLOW_ROOT
    units = Path(unit_dir) if unit_dir is not None else AUTOFOLLOW_UNITS
    fallback = {"state": "NOT_CONFIGURED_OR_UNVERIFIED", "modelStatus": "UNVERIFIED",
                "timerLiveState": "UNVERIFIED_NO_SYSTEMD_QUERY", "workflowMutation": False,
                "chatDeliveryBound": False, "lastReceiptId": "NONE"}
    try:
        if not project.is_dir() or project.is_symlink() or project.stat().st_uid != os.getuid():
            return fallback
        receipt = bounded_json(project / "INSTALL_R2_RECEIPT.json", 8192)
        brain = bounded_json(project / "BRAIN_VERIFY_R1.json", 4096)
        if not receipt or not brain:
            return fallback
        if receipt.get("status") != "PASS_USER_ONLY_AUTOFOLLOW_TIMER_R2":
            return fallback
        if receipt.get("workflowMutation") is not False or receipt.get("chatAccountBoundDelivery") is not False:
            return fallback
        expected = receipt.get("unitSha256")
        if not isinstance(expected, dict):
            return fallback
        for name in ("rc-autofollow.service", "rc-autofollow.timer"):
            p = units / name
            if p.is_symlink() or not p.is_file() or p.stat().st_uid != os.getuid():
                return fallback
            if p.stat().st_mode & 0o022 or p.stat().st_size > 8192:
                return fallback
            actual = hashlib.sha256(p.read_bytes()).hexdigest()
            if actual != expected.get(name):
                return fallback
        zip_path = project / "BRAIN_R1.zip"
        if zip_path.is_symlink() or not zip_path.is_file() or zip_path.stat().st_uid != os.getuid():
            return fallback
        if zip_path.stat().st_size > 1_000_000:
            return fallback
        if brain.get("status") != "PASS_R1_CUMULATIVE_AUTOFOLLOW_ACCOUNT_TRANSFER":
            return fallback
        if hashlib.sha256(zip_path.read_bytes()).hexdigest() != brain.get("sha256"):
            return fallback
        report_dir = project / "RESULTS"
        if report_dir.is_symlink() or not report_dir.is_dir():
            return {"state": "CONFIGURED_NO_REPORT", **{k:v for k,v in fallback.items() if k!="state"}}
        report = bounded_json(report_dir / "CURRENT.json", 16384)
        base = {"state": "CONFIGURED_SOURCE_VERIFIED",
                "modelStatus": "UNVERIFIED", "timerLiveState": "UNVERIFIED_NO_SYSTEMD_QUERY",
                "workflowMutation": False, "chatDeliveryBound": False, "lastReceiptId": "NONE"}
        if report and report.get("schema") == 1 and report.get("noActionsExecuted") is True and report.get("chatDelivery") is False:
            ident = report.get("id")
            value = report.get("modelStatus")
            if isinstance(ident,str) and re.fullmatch(r"RUN_[0-9]{8}T[0-9]{6}Z",ident):
                base["lastReceiptId"] = ident
            if isinstance(value,str) and re.fullmatch(r"(?:PASS_PROPOSAL_ONLY|UNVERIFIED_[A-Za-z0-9_]{1,48}|SKIPPED_[A-Za-z0-9_]{1,48})",value):
                base["modelStatus"] = value
        return base
    except (OSError, ValueError, TypeError):
        return fallback

def audit():
    data = monitor_status()
    result = {
        "schema": 1,
        "product": "Remote Commander Control Center",
        "mode": "READ_ONLY_CANDIDATE",
        "monitor": data.get("state"),
        "profileCount": len(profiles()),
        "workflowCountInStore": len(workflows()),
        "operationsShownAsLiveOnly": True,
        "durableRunningIsNotActive": True,
        "workflowControlEnabled": False,
        "credentialAccess": False,
        "localAIFollowup": autofollow_status()["state"],
        "localAIWorkflowMutation": False,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


def run_gui():
    import gi
    gi.require_version("Gtk", "4.0")
    gi.require_version("Adw", "1")
    from gi.repository import Adw, Gio, GLib, Gtk

    class Center(Adw.Application):
        def __init__(self):
            super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.FLAGS_NONE)
            self.stack = Gtk.Stack()
            self.stack.set_transition_type(Gtk.StackTransitionType.CROSSFADE)
            self.window = None
            self._interface_settings = None
            self.system_dark = False
            try:
                self._interface_settings = Gio.Settings.new("org.gnome.desktop.interface")
                self._interface_settings.connect("changed::color-scheme", self.on_os_theme_changed)
                self._interface_settings.connect("changed::gtk-theme", self.on_os_theme_changed)
            except (RuntimeError, ValueError):
                self._interface_settings = None
            self.apply_system_theme()

        def apply_system_theme(self):
            pref = ""
            gtk_theme = ""
            if self._interface_settings is not None:
                try:
                    pref = self._interface_settings.get_string("color-scheme")
                    gtk_theme = self._interface_settings.get_string("gtk-theme")
                except (RuntimeError, ValueError):
                    pref = ""
                    gtk_theme = ""
            self.system_dark = effective_system_dark(pref, gtk_theme, os.environ.get("GTK_THEME", ""))
            Adw.StyleManager.get_default().set_color_scheme(
                Adw.ColorScheme.FORCE_DARK if self.system_dark else Adw.ColorScheme.FORCE_LIGHT)

        def on_os_theme_changed(self, *_args):
            self.apply_system_theme()
            if self.window is not None:
                self.refresh()

        def do_activate(self):
            if self.window:
                self.window.present()
                return
            window = Adw.ApplicationWindow(application=self)
            window.set_title("Remote Commander — Control Center")
            window.set_default_size(1040, 730)
            self.window = window
            outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
            header = Adw.HeaderBar()
            heading = Gtk.Label(label="Remote Commander")
            heading.add_css_class("title-2")
            header.set_title_widget(heading)
            refresh_btn = Gtk.Button(icon_name="view-refresh-symbolic")
            refresh_btn.set_tooltip_text("Refresh owner-private local state")
            refresh_btn.connect("clicked", lambda *_: self.refresh())
            header.pack_end(refresh_btn)
            outer.append(header)

            switch = Gtk.StackSwitcher(stack=self.stack)
            switch.set_halign(Gtk.Align.CENTER)
            switch.set_margin_top(10)
            switch.set_margin_bottom(10)
            outer.append(switch)
            for page_id,title in [("overview","Overview"),("profiles","Profiles"),("tasks","Tasks"),("settings","Settings")]:
                scroller = Gtk.ScrolledWindow()
                scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
                content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL,spacing=12)
                content.set_margin_top(20)
                content.set_margin_bottom(28)
                content.set_margin_start(25)
                content.set_margin_end(25)
                scroller.set_child(content)
                self.stack.add_titled(scroller,page_id,title)
                setattr(self, "page_"+page_id, content)
            outer.append(self.stack)
            self.stack.set_vexpand(True)
            footer = Gtk.Label(label="Owner-private monitoring only · No shell bridge · No credentials · No task replay")
            footer.add_css_class("dim-label")
            footer.set_margin_top(7)
            footer.set_margin_bottom(12)
            outer.append(footer)
            window.set_content(outer)
            self.refresh()
            GLib.timeout_add_seconds(5,self.on_timer)
            window.present()

        def on_timer(self):
            if not self.window:
                return False
            self.refresh()
            return True

        @staticmethod
        def wipe(box):
            child = box.get_first_child()
            while child:
                nxt = child.get_next_sibling()
                box.remove(child)
                child = nxt

        @staticmethod
        def row(box,title,value,subtitle=None):
            frame = Gtk.Box(orientation=Gtk.Orientation.VERTICAL,spacing=5)
            frame.add_css_class("card")
            frame.set_margin_bottom(5)
            name = Gtk.Label(label=title,xalign=0)
            name.add_css_class("heading")
            frame.append(name)
            label = Gtk.Label(label=value,xalign=0,wrap=True,selectable=True)
            frame.append(label)
            if subtitle:
                info = Gtk.Label(label=subtitle,xalign=0,wrap=True)
                info.add_css_class("dim-label")
                frame.append(info)
            box.append(frame)

        def refresh(self):
            for key in ("overview","profiles","tasks","settings"):
                self.wipe(getattr(self,"page_"+key))
            m = monitor_status()
            self.row(self.page_overview,"Commander connection",
                     f"{m['state']} · {m.get('device','unknown')} · Core {m.get('version','?')}",
                     "Private snapshot. Expired data is never displayed as current.")
            self.row(self.page_overview,"GUI admission",
                     m.get("gui","UNVERIFIED")+" "+m.get("guiReason",""),
                     "A previous uncertain input requires independent effect reconciliation.")
            self.row(self.page_overview,"Browser and Extensions",
                     f"Browser {m.get('browser','UNVERIFIED')} · Extensions {m.get('extensions','?')}")
            self.row(self.page_overview,"Active operations",
                     str(m.get("activeOperations","UNVERIFIED")),
                     "Active operations are not durable nonterminal workflow records.")
            rows=profiles()
            self.row(self.page_profiles,"Profiles",str(len(rows)),
                     "Management actions require a verified, owner-authorized Core management channel.")
            if not rows:
                self.row(self.page_profiles,"No accepted profiles","Routing metadata unavailable or not matching its runtime pair")
            for p in rows:
                self.row(self.page_profiles,p["id"],f"Core {p['version']} · port {p['port']}",
                         f"Generation {p['generation']} · {p['root']}")
            ai = autofollow_status()
            self.row(self.page_tasks,"Local AI Follow-up",
                     ai["state"] + " · " + ai["modelStatus"],
                     "Timer active state not proven by private files; last receipt " +
                     ai["lastReceiptId"] + ". Planning only: no task mutation, no ChatGPT delivery.")
            w=workflows()
            self.row(self.page_tasks,"Durable workflows",str(len(w)),
                     "Metadata is read-only. RUNNING in the store does not prove a current worker lease.")
            for item in w:
                self.row(self.page_tasks,item["id"],f"{item['state']} · revision {item['revision']}")
            self.row(self.page_settings,"Appearance",
                     f"System theme: {'Dark' if self.system_dark else 'Light'}",
                     "GNOME color-scheme takes priority; when Default, honor the effective GTK dark theme. "
                     "Changes are observed without modifying user preferences.")
            self.row(self.page_settings,"Operations / Profile controls","Not enabled in this preview",
                     "A local unauthenticated JSON file or Browser-origin JavaScript must never authorize mutations. Use the connected Core tools with a bound session.")
            self.row(self.page_settings,"Data protection","No network, token inspection, cookie access, or arbitrary shell commands",
                     "This process reads only owner-private Core monitor, routing and SQLite workflow metadata.")

    app = Center()
    return app.run(sys.argv[:1])


if __name__ == "__main__":
    raise SystemExit(audit() if "--audit" in sys.argv else run_gui())
