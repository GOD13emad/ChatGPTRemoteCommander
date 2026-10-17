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
    if type(result) is not dict or result.get("requestId") != prepared.request_id or result.get("action") != prepared.action or result.get("workflowId") != prepared.workflow_id or result.get("expectedRevision") != prepared.revision or result.get("target") != expected_target:
        return {"state": "UNCERTAIN", "code": "MANAGEMENT_RECEIPT_IDENTITY_UNVERIFIED"}
    if result.get("state") == "APPLIED" and result.get("code") == "MANAGEMENT_CONTROL_READBACK_VERIFIED" and type(result.get("newRevision")) is int and result["newRevision"] == prepared.revision + 1 and result.get("controlIntent") == _ALLOWED[prepared.action]:
        return {"state": "APPLIED", "code": "MANAGEMENT_CONTROL_READBACK_VERIFIED", "revision": result["newRevision"]}
    if result.get("state") == "REJECTED" and result.get("newRevision") is None and type(result.get("code")) is str and re.fullmatch("[A-Z0-9_]{1,100}", result["code"]):
        return {"state": "REJECTED", "code": result["code"]}
    return {"state": "UNCERTAIN", "code": "MANAGEMENT_RESULT_UNVERIFIED"}


class NativeManagementController:
    """A single-use-at-a-time UI controller; never silently reopens IPC sessions."""
    def __init__(self, client, scoped_read):
        if not callable(scoped_read) or not callable(getattr(client, "control", None)):
            deny("MANAGEMENT_NATIVE_CLIENT_REQUIRED")
        self._target = _target(getattr(client, "target", None))
        self._client = client
        self._scoped_read = scoped_read
        self._guard = threading.Lock()
        self._disabled = False

    @property
    def target(self):
        return dict(self._target)

    @property
    def disabled(self):
        return self._disabled

    def list_controls(self):
        if self._disabled:
            return ()
        return _records(self._scoped_read(), self._target)

    def prepare(self, workflow_id, revision, action):
        if self._disabled:
            deny("MANAGEMENT_SESSION_UNAVAILABLE")
        if type(action) is not str or action not in _ALLOWED or type(workflow_id) is not str or not _WORKFLOW.fullmatch(workflow_id) or type(revision) is not int or not 1 <= revision <= 10000:
            deny("MANAGEMENT_REQUEST_UNVERIFIED")
        records = self.list_controls()
        record = next((x for x in records if x["id"] == workflow_id), None)
        if not record or record["revision"] != revision:
            deny("MANAGEMENT_WORKFLOW_CHANGED")
        if record["state"] in _TERMINAL or (action == "workflow.pause" and record["state"] == "PAUSED"):
            deny("MANAGEMENT_ACTION_NOT_APPLICABLE")
        return PreparedControl(workflow_id, revision, record["state"], action,
                               tuple(sorted(self._target.items())), uuid4().hex)

    def submit_confirmed(self, proposal):
        # Only the native GTK confirmation response calls this method.
        if not isinstance(proposal, PreparedControl) or proposal.target != tuple(sorted(self._target.items())):
            deny("MANAGEMENT_PROPOSAL_UNVERIFIED")
        if not self._guard.acquire(blocking=False):
            deny("MANAGEMENT_BUSY")
        try:
            if self._disabled:
                deny("MANAGEMENT_SESSION_UNAVAILABLE")
            record = next((x for x in self.list_controls() if x["id"] == proposal.workflow_id), None)
            if not record or record["revision"] != proposal.revision or record["state"] != proposal.state:
                deny("MANAGEMENT_WORKFLOW_CHANGED")
            # No callback may convert a lost receipt into success or retry it.
            try:
                raw = self._client.control(proposal.action, proposal.workflow_id,
                                           proposal.revision, proposal.request_id)
            except Exception:
                self._disabled = True
                return {"state": "UNCERTAIN", "code": "MANAGEMENT_TRANSPORT_OR_EFFECT_UNVERIFIED"}
            result = receipt_status(raw, proposal, self._target)
            if result["state"] == "UNCERTAIN":
                self._disabled = True
            return result
        finally:
            self._guard.release()
