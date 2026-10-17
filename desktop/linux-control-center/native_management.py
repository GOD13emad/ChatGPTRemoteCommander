"""Optional GTK management policy for a *trusted native* already-connected client.

No default GUI import uses this module. No socket, key, database, shell, or
browser is discovered here. A native bootstrap must explicitly supply a
NativeClient and a read-only source scoped to that exact resident Core.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from uuid import uuid4

_WORKFLOW = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z")
_ALLOWED = {"workflow.pause": "PAUSED", "workflow.cancel": "CANCELLED"}
_TERMINAL = {"COMPLETED", "CANCELLED"}


class ManagementBlocked(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def deny(code):
    raise ManagementBlocked(code)


def _target(value):
    keys = ("deviceId", "profileId", "configSha256", "routeGeneration")
    if type(value) is not dict or set(value) != set(keys):
        deny("MANAGEMENT_TARGET_UNVERIFIED")
    if not all(type(value[k]) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value[k])
               for k in ("deviceId", "profileId")):
        deny("MANAGEMENT_TARGET_UNVERIFIED")
    if type(value["configSha256"]) is not str or not re.fullmatch("[a-f0-9]{64}", value["configSha256"]):
        deny("MANAGEMENT_TARGET_UNVERIFIED")
    if type(value["routeGeneration"]) is not int or value["routeGeneration"] < 1:
        deny("MANAGEMENT_TARGET_UNVERIFIED")
    return dict(value)


def _records(value, target):
    """Reject ambiguous, duplicate, unscoped or structurally stale inventories."""
    if type(value) is not dict or set(value) != {"schema", "target", "records"} or type(value["schema"]) is not int or value["schema"] != 1:
        deny("MANAGEMENT_INVENTORY_UNVERIFIED")
    if _target(value["target"]) != target or type(value["records"]) is not list or len(value["records"]) > 300:
        deny("MANAGEMENT_INVENTORY_SCOPE")
    seen = set()
    records = []
    for item in value["records"]:
        if type(item) is not dict or set(item) != {"id", "revision", "state", "profileId"}:
            deny("MANAGEMENT_INVENTORY_UNVERIFIED")
        ident = item["id"]
        if type(ident) is not str or not _WORKFLOW.fullmatch(ident) or ident in seen:
            deny("MANAGEMENT_INVENTORY_UNVERIFIED")
        seen.add(ident)
        rev = item["revision"]
        if type(rev) is not int or not 1 <= rev <= 10000 or type(item["state"]) is not str or not 0 < len(item["state"]) <= 40:
            deny("MANAGEMENT_INVENTORY_UNVERIFIED")
        if item["profileId"] != target["profileId"]:
            deny("MANAGEMENT_INVENTORY_SCOPE")
        records.append({"id": ident, "revision": rev, "state": item["state"], "profileId": target["profileId"]})
    return tuple(records)


@dataclass(frozen=True)
class PreparedControl:
    workflow_id: str
    revision: int
    state: str
    action: str
    target: tuple
    request_id: str


def receipt_status(result, prepared, expected_target):
    """A label is never promoted to APPLIED by UI convenience."""
    # A receipt is not trustworthy merely because one field says APPLIED.
    expected = {"schema", "requestId", "action", "workflowId", "target",
                "expectedRevision", "state", "code", "newRevision"}
    if type(result) is not dict or type(result.get("schema")) is not int or result["schema"] != 1:
        return {"state": "UNCERTAIN", "code": "MANAGEMENT_RECEIPT_SCHEMA_UNVERIFIED"}
    if result.get("state") == "APPLIED":
        expected.add("controlIntent")
    if set(result) != expected or type(result.get("expectedRevision")) is not int or result.get("requestId") != prepared.request_id or result.get("action") != prepared.action or result.get("workflowId") != prepared.workflow_id or result.get("expectedRevision") != prepared.revision or result.get("target") != expected_target:
        return {"state": "UNCERTAIN", "code": "MANAGEMENT_RECEIPT_IDENTITY_UNVERIFIED"}
    if result.get("state") == "APPLIED" and result.get("code") == "MANAGEMENT_CONTROL_READBACK_VERIFIED" and type(result.get("newRevision")) is int and result["newRevision"] == prepared.revision + 1 and result.get("controlIntent") == _ALLOWED[prepared.action]:
        return {"state": "APPLIED", "code": "MANAGEMENT_CONTROL_READBACK_VERIFIED", "revision": result["newRevision"]}
    if result.get("state") == "REJECTED" and result.get("newRevision") is None and type(result.get("code")) is str and re.fullmatch("[A-Z0-9_]{1,100}", result["code"]):
        return {"state": "REJECTED", "code": result["code"]}
    return {"state": "UNCERTAIN", "code": "MANAGEMENT_RESULT_UNVERIFIED"}


class NativeManagementController:
    """A single-use-at-a-time UI controller; never silently reopens IPC sessions."""
    def __init__(self, client, scoped_read, outbox=None):
        if not callable(scoped_read) or not callable(getattr(client, "control", None)):
            deny("MANAGEMENT_NATIVE_CLIENT_REQUIRED")
        self._target = _target(getattr(client, "target", None))
        # Source-only opt-in; the default read-only Control Center does not
        # discover/create an outbox, endpoint, privileged runner or secret.
        if outbox is not None:
            if (getattr(outbox, "target", None) != self._target or
                    not all(callable(getattr(outbox, name, None)) for name in
                            ("begin", "conclude", "has_unresolved", "pending"))):
                deny("MANAGEMENT_OUTBOX_SCOPE_UNVERIFIED")
        self._outbox = outbox
        self._client = client
        self._scoped_read = scoped_read
        self._guard = threading.Lock()
        self._disabled = False
        self._prepared = None

    @property
    def target(self):
        return dict(self._target)

    @property
    def disabled(self):
        if self._disabled:
            return True
        if self._outbox is not None:
            try:
                return self._outbox.has_unresolved()
            except Exception:
                self._disabled = True
                return True
        return False

    def pending_controls(self):
        """Read-only, bounded owner-private pending metadata, no auto replay."""
        if self._outbox is None:
            return ()
        try:
            return self._outbox.pending()
        except Exception:
            self._disabled = True
            return ()

    def list_controls(self):
        if self.disabled:
            return ()
        return _records(self._scoped_read(), self._target)

    def prepare(self, workflow_id, revision, action):
        if not self._guard.acquire(blocking=False):
            deny("MANAGEMENT_BUSY")
        try:
            if self._disabled:
                deny("MANAGEMENT_SESSION_UNAVAILABLE")
            if self._outbox is not None and self.disabled:
                deny("MANAGEMENT_PENDING_RECONCILIATION_REQUIRED")
            if type(action) is not str or action not in _ALLOWED or type(workflow_id) is not str or not _WORKFLOW.fullmatch(workflow_id) or type(revision) is not int or not 1 <= revision <= 10000:
                deny("MANAGEMENT_REQUEST_UNVERIFIED")
            records = self.list_controls()
            record = next((x for x in records if x["id"] == workflow_id), None)
            if not record or record["revision"] != revision:
                deny("MANAGEMENT_WORKFLOW_CHANGED")
            if record["state"] in _TERMINAL or (action == "workflow.pause" and record["state"] == "PAUSED"):
                deny("MANAGEMENT_ACTION_NOT_APPLICABLE")
            # A new deliberate click invalidates the prior (e.g. dismissed) dialog.
            self._prepared = PreparedControl(workflow_id, revision, record["state"], action,
                                              tuple(sorted(self._target.items())), uuid4().hex)
            return self._prepared
        finally:
            self._guard.release()

    def submit_confirmed(self, proposal):
        # Only the native GTK confirmation response calls this method.
        if not isinstance(proposal, PreparedControl) or proposal.target != tuple(sorted(self._target.items())):
            deny("MANAGEMENT_PROPOSAL_UNVERIFIED")
        if not self._guard.acquire(blocking=False):
            deny("MANAGEMENT_BUSY")
        try:
            if self._prepared is not proposal:
                deny("MANAGEMENT_PROPOSAL_CONSUMED")
            # Consume before checking state, sending a request or waiting for a
            # receipt. No second dispatch from this one confirmation is possible.
            self._prepared = None
            if self._disabled:
                deny("MANAGEMENT_SESSION_UNAVAILABLE")
            if self.disabled:
                deny("MANAGEMENT_SESSION_UNAVAILABLE" if self._disabled else
                     "MANAGEMENT_PENDING_RECONCILIATION_REQUIRED")
            record = next((x for x in self.list_controls() if x["id"] == proposal.workflow_id), None)
            if not record or record["revision"] != proposal.revision or record["state"] != proposal.state:
                deny("MANAGEMENT_WORKFLOW_CHANGED")
            # A durable owner-local intent is committed BEFORE the first
            # dispatch. A failed outbox write never sends any command.
            if self._outbox is not None:
                try:
                    self._outbox.begin(proposal)
                except ManagementBlocked:
                    raise
                except Exception:
                    self._disabled = True
                    return {"state": "UNCERTAIN", "code": "MANAGEMENT_OUTBOX_WRITE_UNVERIFIED"}
            # No callback may convert a lost receipt into success or retry it.
            try:
                raw = self._client.control(proposal.action, proposal.workflow_id,
                                           proposal.revision, proposal.request_id)
                result = receipt_status(raw, proposal, self._target)
            except Exception:
                result = {"state": "UNCERTAIN", "code": "MANAGEMENT_TRANSPORT_OR_EFFECT_UNVERIFIED"}
            if self._outbox is not None:
                state = {"APPLIED": "RECORDED", "REJECTED": "REJECTED",
                         "UNCERTAIN": "UNCERTAIN"}[result["state"]]
                try:
                    self._outbox.conclude(proposal.request_id, state, result["code"])
                except Exception:
                    self._disabled = True
                    return {"state": "UNCERTAIN", "code": "MANAGEMENT_OUTBOX_RESULT_UNVERIFIED"}
            if result["state"] == "UNCERTAIN":
                self._disabled = True
            return result
        finally:
            self._guard.release()
