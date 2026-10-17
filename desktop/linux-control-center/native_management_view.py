"""Opt-in, native GTK4 controls for a preauthenticated, injected management client.

This module is never imported by the default read-only Control Center entrypoint.
No Core/network/socket keys or workflow database are discovered by presentation.
"""
from __future__ import annotations

import threading

from native_management import ManagementBlocked


def attach_management_view(center, controller, Gtk, Adw, GLib):
    """Attach native widgets to the existing Tasks page; no effect without confirmation."""
    if not all(callable(getattr(controller, n, None)) for n in
               ("list_controls", "prepare", "submit_confirmed")):
        raise ValueError("MANAGEMENT_NATIVE_ADAPTER_REQUIRED")

    class NativeManagementView:
        def __init__(self):
            self.alive = True
            self.busy = False
            self.buttons = []
            self.rows = []
            self.confirm_dialog = None
            outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
            outer.add_css_class("rc-rule")
            self.container = outer
            self.title = Gtk.Label(label="Owner-local Workflow control • Preview", xalign=0, wrap=True)
            self.title.add_css_class("rc-section-title")
            outer.append(self.title)
            self.target = Gtk.Label(label="Target is not verified", xalign=0, wrap=True, selectable=True)
            self.target.add_css_class("rc-list-caption")
            outer.append(self.target)
            self.note = Gtk.Label(label="No command requested. Pause and Cancel require confirmation.",
                                  xalign=0, wrap=True, selectable=True)
            self.note.add_css_class("rc-section-caption")
            outer.append(self.note)
            self.search = Gtk.SearchEntry()
            self.search.set_placeholder_text("Filter eligible workflows")
            self.search.connect("search-changed", lambda *_: self._filter())
            outer.append(self.search)
            self.list = Gtk.ListBox()
            self.list.set_selection_mode(Gtk.SelectionMode.NONE)
            self.list.add_css_class("boxed-list")
            outer.append(self.list)
            center.tasks_page.append(outer)
            self.refresh()

        def _filter(self):
            query = self.search.get_text().casefold().strip()
            for row, indexed in self.rows:
                row.set_visible(not query or query in indexed)

        def _label(self, message, state="UNVERIFIED"):
            self.note.set_text(str(message)[:220])
            for cls in ("rc-success", "rc-danger", "rc-caution"):
                self.note.remove_css_class(cls)
            self.note.add_css_class("rc-success" if state == "APPLIED" else
                                    "rc-danger" if state == "REJECTED" else "rc-caution")

        def refresh(self):
            if not self.alive or self.busy:
                return
            for button in self.buttons:
                button.set_sensitive(False)
            self.buttons = []
            self.rows = []
            child = self.list.get_first_child()
            while child is not None:
                nxt = child.get_next_sibling()
                self.list.remove(child)
                child = nxt
            try:
                target = controller.target
                if not isinstance(target, dict):
                    raise ValueError("MANAGEMENT_TARGET_UNVERIFIED")
                values = controller.list_controls()
                if controller.disabled:
                    # Pending requests are owner-private metadata, NOT Core
                    # effect proof. They must remain visible after GUI restart
                    # but must never become clickable replay buttons.
                    pending = controller.pending_controls() if callable(getattr(
                        controller, "pending_controls", None)) else ()
                    if pending:
                        self.target.set_text(
                            f"Device {target['deviceId']} · profile {target['profileId']} · "
                            f"route #{target['routeGeneration']} · config {target['configSha256'][:12]}")
                        self._label(
                            "RECONCILIATION REQUIRED — pending native request; "
                            "do not repeat before independent Core journal inspection",
                            "UNVERIFIED")
                        for item in pending[:10]:
                            if not isinstance(item, dict):
                                continue
                            ident = str(item.get("workflowId", "?"))[:64]
                            revision = str(item.get("revision", "?"))[:7]
                            status = str(item.get("state", "UNVERIFIED"))[:25]
                            row = Gtk.ListBoxRow()
                            row.set_selectable(False)
                            row.set_activatable(False)
                            row.set_child(Gtk.Label(
                                label=f"{ident} · revision {revision} · {status} · NO RETRY",
                                xalign=0, wrap=True))
                            self.list.append(row)
                        return
                    raise ValueError("MANAGEMENT_SESSION_UNAVAILABLE")
                self.target.set_text(f"Device {target['deviceId']} · profile {target['profileId']} · "
                                     f"route #{target['routeGeneration']} · config {target['configSha256'][:12]}")
                for value in values:
                    identity, revision, state = value["id"], value["revision"], value["state"]
                    row = Gtk.ListBoxRow()
                    row.set_activatable(False)
                    row.set_selectable(False)
                    group = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
                    group.set_margin_top(10)
                    group.set_margin_bottom(10)
                    group.set_margin_start(12)
                    group.set_margin_end(12)
                    header = Gtk.Label(label=f"{identity}  ·  {state}  ·  revision {revision}",
                                       xalign=0, wrap=True)
                    group.append(header)
                    controls = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=9)
                    for action, title in (("workflow.pause", "Pause"), ("workflow.cancel", "Cancel")):
                        if state in ("CANCELLED", "COMPLETED") or (action == "workflow.pause" and state == "PAUSED"):
                            continue
                        button = Gtk.Button(label=title)
                        button.add_css_class("flat" if action == "workflow.pause" else "destructive-action")
                        button.update_property(
                            [Gtk.AccessibleProperty.LABEL],
                            [f"{title} workflow {identity}, revision {revision}; requires confirmation"])
                        button.connect("clicked", lambda _button, i=identity, v=revision, a=action:
                                       self.confirm(i, v, a))
                        self.buttons.append(button)
                        controls.append(button)
                    group.append(controls)
                    row.set_child(group)
                    self.list.append(row)
                    self.rows.append((row, (identity + " " + state).casefold()))
                if not values:
                    row = Gtk.ListBoxRow()
                    row.set_selectable(False)
                    row.set_child(Gtk.Label(label="No authorized workflow rows", xalign=0))
                    self.list.append(row)
                self._filter()
            except (ValueError, TypeError, AttributeError, KeyError):
                self.target.set_text("Native target or workflow scope UNVERIFIED")
                self._label("Controls blocked; monitoring remains read-only", "UNVERIFIED")
                row = Gtk.ListBoxRow()
                row.set_selectable(False)
                row.set_child(Gtk.Label(label="No eligible verified controls", xalign=0))
                self.list.append(row)

        def confirm(self, workflow_id, revision, action):
            if not self.alive or self.busy or center.window is None or self.confirm_dialog is not None:
                return
            try:
                prepared = controller.prepare(workflow_id, revision, action)
                target = controller.target
            except (ValueError, TypeError, KeyError, AttributeError):
                self._label("REJECTED — workflow identity or revision is stale", "REJECTED")
                self.refresh()
                return
            verb = "Pause" if action == "workflow.pause" else "Cancel"
            body = (
                f"Action: {verb} (control intent only)\nWorkflow: {prepared.workflow_id}\n"
                f"Revision: {prepared.revision}\nDevice: {target['deviceId']}\n"
                f"Profile: {target['profileId']}\nRoute generation: {target['routeGeneration']}\n"
                "An external process is NOT proven stopped by Cancel.")
            dialog = Adw.MessageDialog.new(center.window, "Confirm local Workflow control", body)
            dialog.add_response("dismiss", "Do nothing")
            dialog.add_response("confirm", verb)
            dialog.set_default_response("dismiss")
            dialog.set_close_response("dismiss")
            if action == "workflow.cancel":
                dialog.set_response_appearance("confirm", Adw.ResponseAppearance.DESTRUCTIVE)
            self.confirm_dialog = dialog
            dialog.connect("response", lambda _d, response, request=prepared:
                           self._confirmation_response(response, request))
            dialog.present()

        def _confirmation_response(self, response, prepared):
            self.confirm_dialog = None
            if response != "confirm" or not self.alive or self.busy:
                return
            self.busy = True
            for button in self.buttons:
                button.set_sensitive(False)
            self._label("REQUESTED — awaiting verified Core readback", "UNVERIFIED")
            def worker():
                try:
                    result = controller.submit_confirmed(prepared)
                except ManagementBlocked as error:
                    result = {"state": "REJECTED", "code": error.code}
                except Exception:
                    result = {"state": "UNCERTAIN", "code": "MANAGEMENT_EFFECT_UNVERIFIED"}
                GLib.idle_add(self._completed, prepared, result)
            threading.Thread(target=worker, name="rc-native-single-control", daemon=True).start()

        def _completed(self, prepared, result):
            self.busy = False
            if not self.alive or center.window is None:
                return False
            state = result.get("state", "UNCERTAIN")
            if state == "APPLIED":
                msg = (f"APPLIED: {prepared.workflow_id} revision {result.get('revision')} "
                       "control intent. External worker completion unproven.")
            elif state == "REJECTED":
                msg = "REJECTED: " + str(result.get("code", "UNKNOWN"))[:90]
            else:
                msg = "UNCERTAIN: do not retry; inspect Core before any new command."
            self._label(msg, state)
            if state != "UNCERTAIN":
                self.refresh()
            return False

        def close(self):
            self.alive = False
            if self.confirm_dialog is not None:
                self.confirm_dialog.close()
                self.confirm_dialog = None
            for button in self.buttons:
                button.set_sensitive(False)

    return NativeManagementView()
