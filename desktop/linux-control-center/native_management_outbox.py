"""Opt-in owner-local pending-control outbox, never a workflow execution database.

A *trusted* native bootstrap supplies an existing, owner-only 0700 directory.
Before an authorized GTK confirmation is dispatched, the exact opaque request
identity is committed with SQLite synchronous=FULL. An interrupted request is
kept as IN_FLIGHT / UNCERTAIN and blocks new controls until independently
reconciled; it is never replayed from this outbox.

No account keys, request MACs, workflow source, cookies or Core inputs are stored.
The existing WorkflowStore remains the sole authority for actual control effects.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import threading

from native_management import ManagementBlocked, PreparedControl, _target

_DBNAME = "owner-native-controls.sqlite3"
_REQ = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
_BLOCKED = ("IN_FLIGHT", "UNCERTAIN")
_DONE = ("RECORDED", "REJECTED")


def _deny(code: str):
    raise ManagementBlocked(code)


def _fingerprint(target):
    return hashlib.sha256(json.dumps(_target(target), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class NativeRequestOutbox:
    """Single-process, thread-serialized UI-only outbox with restart readback."""

    def __init__(self, owner_directory, target):
        if os.name != "posix" or not hasattr(os, "getuid") or os.getuid() == 0:
            _deny("MANAGEMENT_OUTBOX_PLATFORM_UNSUPPORTED")
        if not isinstance(owner_directory, (str, Path)):
            _deny("MANAGEMENT_OUTBOX_DIRECTORY_UNTRUSTED")
        self._directory = Path(owner_directory)
        if not self._directory.is_absolute() or self._directory.resolve() != self._directory:
            _deny("MANAGEMENT_OUTBOX_DIRECTORY_UNTRUSTED")
        self._target = tuple(sorted(_target(target).items()))
        self._scope = _fingerprint(target)
        self._lock = threading.RLock()
        self._closed = False
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        try:
            fd = os.open(self._directory, flags)
        except OSError:
            _deny("MANAGEMENT_OUTBOX_DIRECTORY_UNTRUSTED")
        try:
            d = os.fstat(fd)
            if not stat.S_ISDIR(d.st_mode) or d.st_uid != os.getuid() or (d.st_mode & 0o077):
                _deny("MANAGEMENT_OUTBOX_DIRECTORY_UNTRUSTED")
            path = self._directory / _DBNAME
            created_fd = None
            try:
                created_fd = os.open(_DBNAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                                     os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
            except FileExistsError:
                created_fd = None
            except OSError:
                _deny("MANAGEMENT_OUTBOX_FILE_UNTRUSTED")
            if created_fd is not None:
                os.close(created_fd)
                os.fsync(fd)
            try:
                file_fd = os.open(_DBNAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            except OSError:
                _deny("MANAGEMENT_OUTBOX_FILE_UNTRUSTED")
            try:
                st = os.fstat(file_fd)
                if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or (st.st_mode & 0o077) or st.st_nlink != 1:
                    _deny("MANAGEMENT_OUTBOX_FILE_UNTRUSTED")
                if created_fd is None and st.st_size == 0:
                    _deny("MANAGEMENT_OUTBOX_SCHEMA_UNTRUSTED")
            finally:
                os.close(file_fd)
            try:
                self._db = sqlite3.connect(str(path), isolation_level=None, timeout=0.6,
                                           check_same_thread=False)
                self._db.execute("PRAGMA busy_timeout=600")
                self._db.execute("PRAGMA journal_mode=DELETE")
                self._db.execute("PRAGMA synchronous=FULL")
                self._db.execute("PRAGMA trusted_schema=OFF")
                version = self._db.execute("PRAGMA user_version").fetchone()[0]
                if version not in (0, 1):
                    _deny("MANAGEMENT_OUTBOX_SCHEMA_UNTRUSTED")
                if version == 0 and created_fd is None:
                    _deny("MANAGEMENT_OUTBOX_SCHEMA_UNTRUSTED")
                if version == 0:
                    self._db.execute("CREATE TABLE IF NOT EXISTS attempts ("
                                     "request_id TEXT PRIMARY KEY, scope TEXT NOT NULL, "
                                     "workflow TEXT NOT NULL, revision INTEGER NOT NULL, "
                                     "action TEXT NOT NULL, state TEXT NOT NULL, code TEXT NOT NULL, "
                                     "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
                    self._db.execute("CREATE INDEX IF NOT EXISTS attempts_scope ON "
                                     "attempts(scope, state, workflow)")
                    self._db.execute("PRAGMA user_version=1")
                names = [row[1] for row in self._db.execute("PRAGMA table_info(attempts)")]
                if names != ["request_id", "scope", "workflow", "revision", "action", "state", "code", "created_at", "updated_at"]:
                    _deny("MANAGEMENT_OUTBOX_SCHEMA_UNTRUSTED")
            except (sqlite3.DatabaseError, OSError, ManagementBlocked) as error:
                if hasattr(self, "_db"):
                    try:
                        self._db.close()
                    except sqlite3.DatabaseError:
                        pass
                if isinstance(error, ManagementBlocked):
                    raise
                _deny("MANAGEMENT_OUTBOX_STORAGE_UNAVAILABLE")
        finally:
            os.close(fd)

    @property
    def target(self):
        return dict(self._target)

    @property
    def closed(self):
        return self._closed

    def _check(self):
        if self._closed:
            _deny("MANAGEMENT_OUTBOX_CLOSED")

    def pending(self):
        with self._lock:
            self._check()
            return tuple({"requestId": row[0], "workflowId": row[1],
                          "revision": row[2], "action": row[3], "state": row[4]}
                         for row in self._db.execute(
                             "SELECT request_id, workflow, revision, action, state FROM attempts "
                             "WHERE scope=? AND state IN ('IN_FLIGHT','UNCERTAIN') ORDER BY created_at, request_id LIMIT 1001",
                             (self._scope,)).fetchall())

    def has_unresolved(self):
        with self._lock:
            self._check()
            return self._db.execute(
                "SELECT 1 FROM attempts WHERE scope=? AND state IN ('IN_FLIGHT','UNCERTAIN') LIMIT 1",
                (self._scope,)).fetchone() is not None

    def begin(self, proposal):
        """Durable intent BEFORE effect. Never mutates WorkflowStore."""
        if (not isinstance(proposal, PreparedControl) or
                not isinstance(proposal.request_id, str) or not _REQ.fullmatch(proposal.request_id) or
                proposal.target != self._target or
                not isinstance(proposal.workflow_id, str) or
                not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", proposal.workflow_id) or
                type(proposal.revision) is not int or not (1 <= proposal.revision <= 10000) or
                proposal.action not in ("workflow.pause", "workflow.cancel")):
            _deny("MANAGEMENT_OUTBOX_REQUEST_UNVERIFIED")
        with self._lock:
            self._check()
            import datetime
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            try:
                self._db.execute("BEGIN IMMEDIATE")
                blocked = self._db.execute(
                    "SELECT 1 FROM attempts WHERE scope=? AND state IN ('IN_FLIGHT','UNCERTAIN') LIMIT 1",
                    (self._scope,)).fetchone()
                if blocked:
                    _deny("MANAGEMENT_PENDING_RECONCILIATION_REQUIRED")
                if self._db.execute("SELECT COUNT(*) FROM attempts").fetchone()[0] >= 1000:
                    _deny("MANAGEMENT_OUTBOX_FULL")
                self._db.execute("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)",
                    (proposal.request_id, self._scope, proposal.workflow_id, proposal.revision,
                     proposal.action, "IN_FLIGHT", "MANAGEMENT_OUTBOX_BEFORE_DISPATCH", now, now))
                self._db.execute("COMMIT")
            except ManagementBlocked:
                self._db.execute("ROLLBACK")
                raise
            except (sqlite3.DatabaseError, OSError):
                try: self._db.execute("ROLLBACK")
                except sqlite3.DatabaseError: pass
                _deny("MANAGEMENT_OUTBOX_WRITE_UNVERIFIED")

    def conclude(self, request_id, state, code):
        """Only the result of the exact attempted request may conclude this row."""
        if not isinstance(request_id, str) or not _REQ.fullmatch(request_id) or state not in (*_DONE, "UNCERTAIN") or (
                not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,100}", code)) or (
                state == "RECORDED" and code != "MANAGEMENT_CONTROL_READBACK_VERIFIED"):
            _deny("MANAGEMENT_OUTBOX_RECEIPT_UNVERIFIED")
        with self._lock:
            self._check()
            import datetime
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            try:
                self._db.execute("BEGIN IMMEDIATE")
                row = self._db.execute("SELECT state FROM attempts WHERE request_id=? AND scope=?",
                                       (request_id, self._scope)).fetchone()
                if row != ("IN_FLIGHT",):
                    _deny("MANAGEMENT_OUTBOX_RECORD_NOT_PENDING")
                self._db.execute("UPDATE attempts SET state=?,code=?,updated_at=? "
                                 "WHERE request_id=? AND scope=? AND state='IN_FLIGHT'",
                                 (state, code, now, request_id, self._scope))
                self._db.execute("COMMIT")
            except ManagementBlocked:
                self._db.execute("ROLLBACK")
                raise
            except (sqlite3.DatabaseError, OSError):
                try:self._db.execute("ROLLBACK")
                except sqlite3.DatabaseError:pass
                _deny("MANAGEMENT_OUTBOX_WRITE_UNVERIFIED")

    def close(self):
        with self._lock:
            if not self._closed:
                self._closed = True
                self._db.close()
