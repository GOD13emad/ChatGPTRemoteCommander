#!/usr/bin/env python3
"""Owner-local transport for the resident Node Core, never a separate executor.

Run only as an explicitly launched, unprivileged child with anonymous stdio pipes.
NativeClient is an importable, no-retry client for a future native Control Center.
No session key is written to a file, command line, environment, diagnostic or log.
SO_PEERCRED authenticates the local UID/PID, not a human click or application signer.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import re
import secrets
import select
import socket
import stat
import struct
import sys
import time

WIRE_LIMIT = 8192
PIPE_LIMIT = 65536
REPLY_LIMIT = 16384


class ManagementError(Exception):
    """A fixed error code, deliberately excluding raw OS/peer/input messages."""


def fail(code: str):
    raise ManagementError(code)


def integer(value, low=0, high=2**53-1):
    return type(value) is int and low <= value <= high


def strict_json(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                fail('MANAGEMENT_DUPLICATE_KEY')
            out[key] = value
        return out
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: fail('MANAGEMENT_JSON'))
    except (ValueError, UnicodeError, TypeError):
        fail('MANAGEMENT_JSON')


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def shape(value, names):
    if type(value) is not dict or set(value) != set(names):
        fail('MANAGEMENT_SCHEMA')


def uid_context():
    if sys.platform != 'linux' or not hasattr(socket, 'SO_PEERCRED'):
        fail('MANAGEMENT_PLATFORM_UNSUPPORTED')
    uid = os.getuid()
    if uid == 0 or uid != os.geteuid() or os.getgid() != os.getegid():
        fail('MANAGEMENT_UNPRIVILEGED_OWNER_REQUIRED')
    return uid


def peer_credentials(connection):
    size = struct.calcsize('3i')
    raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, size)
    if len(raw) != size:
        fail('MANAGEMENT_PEER_CREDENTIALS')
    pid, uid, gid = struct.unpack('3i', raw)
    if not integer(pid, 1, 2**31-1) or not integer(uid) or not integer(gid):
        fail('MANAGEMENT_PEER_CREDENTIALS')
    return pid, uid, gid


def authorize_peer(peer, owner, expected_pid=None):
    pid, uid, gid = peer
    if uid != owner or uid == 0 or (expected_pid is not None and pid != expected_pid):
        fail('MANAGEMENT_PEER_DENIED')
    return pid, uid, gid


def open_private_directory(root, uid):
    """Walk existing directories with descriptor-relative O_NOFOLLOW, no chmod.

    Parent directories must be root/owner controlled; a root-owned sticky /tmp
    ancestor is permitted. The final directory must already be private (0700).
    This does not isolate hostile processes with the same UID or root.
    """
    if type(root) is not str or not root.startswith('/') or root == '/' or '\0' in root or os.path.normpath(root) != root:
        fail('MANAGEMENT_RUNTIME_PATH')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in root.split('/')[1:]:
            newfd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = newfd
            info = os.fstat(fd)
            sticky_root = info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
            if info.st_uid not in (0, uid) or ((info.st_mode & 0o022) and not sticky_root):
                fail('MANAGEMENT_RUNTIME_ANCESTOR_UNSAFE')
        info = os.fstat(fd)
        if info.st_uid != uid or stat.S_IMODE(info.st_mode) != 0o700:
            fail('MANAGEMENT_RUNTIME_NOT_PRIVATE')
        return fd
    except Exception:
        os.close(fd)
        raise


class LineReader:
    def __init__(self, fd, limit, control=None):
        self.fd, self.limit, self.control = fd, limit, control
        self.buffer = bytearray()

    def line(self, deadline):
        while True:
            # A close frame may already be prefetched from the anonymous parent
            # pipe. Revoke before processing any buffered client frame.
            if self.control and self.control.buffer:
                check_close(strict_json(self.control.line(deadline)))
                fail('MANAGEMENT_PARENT_PROTOCOL')
            pos = self.buffer.find(b'\n')
            if pos >= 0:
                if pos > self.limit:
                    fail('MANAGEMENT_FRAME_LIMIT')
                raw = bytes(self.buffer[:pos])
                del self.buffer[:pos+1]
                try:
                    return raw.decode('utf-8', errors='strict')
                except UnicodeError:
                    fail('MANAGEMENT_UTF8')
            if len(self.buffer) > self.limit:
                fail('MANAGEMENT_FRAME_LIMIT')
            wait = deadline - time.monotonic()
            if wait <= 0:
                fail('MANAGEMENT_TRANSPORT_TIMEOUT')
            readfds = [self.fd] + ([self.control.fd] if self.control else [])
            ready, _, _ = select.select(readfds, [], [], wait)
            if not ready:
                fail('MANAGEMENT_TRANSPORT_TIMEOUT')
            if self.control and self.control.fd in ready:
                # Any unsolicited parent command here terminates the session.
                cmd = strict_json(self.control.line(deadline))
                if cmd != {'type': 'close'}:
                    fail('MANAGEMENT_PARENT_PROTOCOL')
                fail('MANAGEMENT_SESSION_REVOKED')
            chunk = os.read(self.fd, min(4096, self.limit + 1 - len(self.buffer)))
            if not chunk:
                fail('MANAGEMENT_CHANNEL_CLOSED')
            self.buffer.extend(chunk)


def parent_send(value):
    data = dump(value) + b'\n'
    if len(data) > PIPE_LIMIT:
        fail('MANAGEMENT_PARENT_LIMIT')
    while data:
        data = data[os.write(1, data):]


def check_close(value):
    if value == {'type': 'close'}:
        fail('MANAGEMENT_SESSION_REVOKED')


def run_relay():
    uid = uid_context()
    parent = LineReader(0, PIPE_LIMIT)
    init = strict_json(parent.line(time.monotonic()+10))
    shape(init, ['schema', 'root', 'uid', 'expectedClientPid', 'sessionMs', 'idleMs', 'maxRequests'])
    if init['schema'] != 1 or type(init['schema']) is not int or init['uid'] != uid or type(init['uid']) is not int:
        fail('MANAGEMENT_PARENT_IDENTITY')
    if (init['expectedClientPid'] is not None and not integer(init['expectedClientPid'], 1, 2**31-1)) or \
       not integer(init['sessionMs'], 100, 300000) or not integer(init['idleMs'], 50, 30000) or \
       not integer(init['maxRequests'], 1, 256):
        fail('MANAGEMENT_PARENT_OPTIONS')
    root = init['root']
    basefd = open_private_directory(root, uid)
    leafname = 'rcm-' + secrets.token_hex(12)
    endpoint = root + '/' + leafname + '/control.sock'
    if len(endpoint.encode()) >= 108:
        os.close(basefd)
        fail('MANAGEMENT_SOCKET_PATH_LIMIT')
    leaf_fd = None
    leaf_id = None
    socket_id = None
    listener = None
    connection = None
    old_umask = os.umask(0o077)
    try:
        os.mkdir(leafname, 0o700, dir_fd=basefd)
        leaf_fd = os.open(leafname, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=basefd)
        leaf = os.fstat(leaf_fd)
        leaf_id = (leaf.st_dev, leaf.st_ino)
        os.fchdir(leaf_fd)  # Dedicated helper only: bind is anchored to this descriptor.
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind('control.sock')
        info = os.stat('control.sock', dir_fd=leaf_fd, follow_symlinks=False)
        socket_id = (info.st_dev, info.st_ino)
        # umask 077 makes AF_UNIX socket 0700; tighten our own newly bound socket.
        os.chmod('control.sock', 0o600, dir_fd=leaf_fd, follow_symlinks=False)
        listener.listen(1)
        deadline = time.monotonic() + init['sessionMs']/1000
        parent_send({'type': 'ready', 'path': endpoint, 'pid': os.getpid(), 'uid': uid})
        for _ in range(5):
            wait = min(deadline-time.monotonic(), init['idleMs']/1000)
            if wait <= 0:
                fail('MANAGEMENT_TRANSPORT_TIMEOUT')
            ready, _, _ = select.select([listener, parent.fd], [], [], wait)
            if not ready:
                fail('MANAGEMENT_TRANSPORT_TIMEOUT')
            if parent.fd in ready:
                check_close(strict_json(parent.line(deadline)))
                fail('MANAGEMENT_PARENT_PROTOCOL')
            connection, _ = listener.accept()
            try:
                peer = authorize_peer(peer_credentials(connection), uid, init['expectedClientPid'])
                break
            except ManagementError:
                connection.close()
                connection = None
        else:
            fail('MANAGEMENT_PEER_DENIED')
        listener.close()
        listener = None
        # Never release bootstrap material before the kernel peer check above.
        parent_send({'type': 'peer', 'pid': peer[0], 'uid': peer[1], 'gid': peer[2]})
        response = strict_json(parent.line(min(deadline, time.monotonic()+10)))
        check_close(response)
        shape(response, ['type', 'bootstrap'])
        if response['type'] != 'bootstrap':
            fail('MANAGEMENT_PARENT_PROTOCOL')
        boot = dump(response['bootstrap']) + b'\n'
        if len(boot) > REPLY_LIMIT:
            fail('MANAGEMENT_PARENT_LIMIT')
        connection.settimeout(min(init['idleMs']/1000, max(0.05, deadline-time.monotonic())))
        connection.sendall(boot)
        del response, boot
        reader = LineReader(connection.fileno(), WIRE_LIMIT, control=parent)
        for sequence in range(1, init['maxRequests']+1):
            wire = reader.line(min(deadline, time.monotonic()+init['idleMs']/1000))
            # SO_PEERCRED is connection-time identity, not a live credential monitor.
            if peer_credentials(connection) != peer:
                fail('MANAGEMENT_PEER_CHANGED')
            parent_send({'type': 'request', 'sequence': sequence, 'wire': wire})
            result = strict_json(parent.line(min(deadline, time.monotonic()+25)))
            check_close(result)
            shape(result, ['type', 'sequence', 'receipt'])
            if result['type'] != 'result' or type(result['sequence']) is not int or result['sequence'] != sequence:
                fail('MANAGEMENT_PARENT_PROTOCOL')
            data = dump(result['receipt']) + b'\n'
            if len(data) > REPLY_LIMIT:
                fail('MANAGEMENT_REPLY_LIMIT')
            connection.settimeout(min(init['idleMs']/1000, max(0.05, deadline-time.monotonic())))
            connection.sendall(data)
            if result['receipt'].get('state') in ('UNCERTAIN', 'CLOSED'):
                break
        return 0
    finally:
        if connection:
            connection.close()
        if listener:
            listener.close()
        if leaf_fd is not None:
            try:
                info = os.stat('control.sock', dir_fd=leaf_fd, follow_symlinks=False)
                if stat.S_ISSOCK(info.st_mode) and (info.st_dev, info.st_ino) == socket_id:
                    os.unlink('control.sock', dir_fd=leaf_fd)
            except OSError:
                pass
            os.fchdir(basefd)
            os.close(leaf_fd)
            try:
                info = os.stat(leafname, dir_fd=basefd, follow_symlinks=False)
                if (info.st_dev, info.st_ino) == leaf_id and stat.S_ISDIR(info.st_mode):
                    os.rmdir(leafname, dir_fd=basefd)  # No recursive cleanup or foreign file deletion.
            except OSError:
                pass
        os.close(basefd)
        os.umask(old_umask)


def target_record(value):
    shape(value, ['deviceId', 'profileId', 'configSha256', 'routeGeneration'])
    for key in ('deviceId', 'profileId'):
        if type(value[key]) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', value[key]):
            fail('MANAGEMENT_TARGET')
    if type(value['configSha256']) is not str or not re.fullmatch(r'[a-f0-9]{64}', value['configSha256']) or not integer(value['routeGeneration'], 1):
        fail('MANAGEMENT_TARGET')
    return {key: value[key] for key in ('deviceId', 'profileId', 'configSha256', 'routeGeneration')}


class NativeClient:
    """Same-owner, exact server-PID client. All actions explicit; never retries.

    The native bootstrap supplies the endpoint, expected helper PID and displayed
    target through its own trusted launch channel. This client does not discover
    or trust an arbitrary socket from a webpage. Same-UID malware/root are outside
    this per-user authentication boundary; local auth is not ChatGPT authentication.
    """
    def __init__(self, endpoint, expected_server_pid, expected_target, timeout=5):
        uid = uid_context()
        if not integer(expected_server_pid, 1, 2**31-1) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 30:
            fail('MANAGEMENT_CLIENT_OPTIONS')
        self.target = target_record(expected_target)
        self.key = bytearray()
        self.socket = None
        self.requests = {}
        self.timeout = timeout
        if type(endpoint) is not str or os.path.basename(endpoint) != 'control.sock':
            fail('MANAGEMENT_ENDPOINT')
        fd = open_private_directory(os.path.dirname(endpoint), uid)
        try:
            st = os.stat('control.sock', dir_fd=fd, follow_symlinks=False)
            if not stat.S_ISSOCK(st.st_mode) or st.st_uid != uid or stat.S_IMODE(st.st_mode) != 0o600:
                fail('MANAGEMENT_ENDPOINT_UNSAFE')
        finally:
            os.close(fd)
        conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket = conn
        try:
            conn.settimeout(timeout)
            conn.connect(endpoint)
            authorize_peer(peer_credentials(conn), uid, expected_server_pid)
            self.reader = LineReader(conn.fileno(), REPLY_LIMIT)
            boot = strict_json(self.reader.line(time.monotonic()+timeout))
            shape(boot, ['schema', 'session', 'keyHex'])
            if type(boot['schema']) is not int or boot['schema'] != 1 or type(boot['keyHex']) is not str or not re.fullmatch(r'[a-f0-9]{64}', boot['keyHex']):
                fail('MANAGEMENT_BOOTSTRAP')
            session = boot['session']
            shape(session, ['schema', 'sessionId', 'target', 'actions', 'authentication'])
            if type(session['schema']) is not int or session['schema'] != 1 or not isinstance(session['sessionId'], str) or not re.fullmatch(r'[a-f0-9]{64}', session['sessionId']) or target_record(session['target']) != self.target:
                fail('MANAGEMENT_BOOTSTRAP_TARGET')
            if session['authentication'] != 'LINUX_SO_PEERCRED_SAME_UID_SESSION':
                fail('MANAGEMENT_BOOTSTRAP_AUTH')
            if session['actions'] != ['workflow.pause', 'workflow.cancel']:
                fail('MANAGEMENT_BOOTSTRAP_ACTIONS')
            self.key = bytearray.fromhex(boot['keyHex'])
            self.session_id = session['sessionId']
        except Exception:
            self.close()
            raise

    def control(self, action, workflow_id, revision, request_id):
        if not self.key or not self.socket:
            fail('MANAGEMENT_CLIENT_CLOSED')
        if type(action) is not str or action not in ('workflow.pause', 'workflow.cancel') or \
           type(workflow_id) is not str or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', workflow_id) or \
           not integer(revision, 1, 10000) or type(request_id) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', request_id):
            fail('MANAGEMENT_CLIENT_SCHEMA')
        semantic = (action, workflow_id, revision)
        if request_id in self.requests:
            old_semantic, wire = self.requests[request_id]
            if old_semantic != semantic:
                fail('MANAGEMENT_REQUEST_ID_CONFLICT')
        else:
            if len(self.requests) >= 256:
                fail('MANAGEMENT_REQUEST_BUDGET')
            now = int(time.time()*1000)
            payload = dict(schema=1, sessionId=self.session_id, target=self.target,
                           requestId=request_id, action=action, workflowId=workflow_id,
                           expectedRevision=revision, issuedAtEpochMs=now, expiresAtEpochMs=now+10000)
            signature = hmac.new(self.key, dump(payload), hashlib.sha256).hexdigest()
            wire = dump(dict(payload=payload, mac=signature)) + b'\n'
            self.requests[request_id] = (semantic, wire)
        try:
            self.socket.sendall(wire)
            receipt = strict_json(self.reader.line(time.monotonic()+self.timeout))
            if type(receipt) is not dict:
                fail('MANAGEMENT_RESPONSE_UNVERIFIED')
            base = ['schema', 'requestId', 'action', 'workflowId', 'target', 'expectedRevision', 'state', 'code', 'newRevision']
            shape(receipt, base + (['controlIntent'] if receipt.get('state') == 'APPLIED' else []))
            if type(receipt['schema']) is not int or receipt['schema'] != 1 or receipt['requestId'] != request_id or receipt['action'] != action or \
               receipt['workflowId'] != workflow_id or type(receipt['expectedRevision']) is not int or receipt['expectedRevision'] != revision or target_record(receipt['target']) != self.target:
                fail('MANAGEMENT_RESPONSE_IDENTITY')
            if receipt['state'] == 'APPLIED':
                if receipt['code'] != 'MANAGEMENT_CONTROL_READBACK_VERIFIED' or not integer(receipt['newRevision'], 1) or receipt['newRevision'] != revision+1 or receipt['controlIntent'] != ('PAUSED' if action == 'workflow.pause' else 'CANCELLED'):
                    fail('MANAGEMENT_RESPONSE_UNVERIFIED')
            elif receipt['state'] not in ('REJECTED', 'UNCERTAIN') or receipt['newRevision'] is not None or type(receipt['code']) is not str or not re.fullmatch(r'[A-Z0-9_]{1,100}', receipt['code']):
                fail('MANAGEMENT_RESPONSE_UNVERIFIED')
            if receipt['state'] == 'UNCERTAIN':
                self.close()
            return receipt
        except Exception:
            self.close()  # No retry after a possible effect or missing receipt.
            raise

    def close(self):
        for i in range(len(self.key)):
            self.key[i] = 0
        self.key.clear()
        if self.socket:
            self.socket.close()
            self.socket = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


if __name__ == '__main__':
    code = 0
    try:
        if sys.argv[1:] != ['--relay']:
            fail('MANAGEMENT_EXPLICIT_RELAY_REQUIRED')
        code = run_relay()
    except ManagementError as error:
        # Never log the raw OS exception, request body, key, username or file path.
        if str(error) not in ('MANAGEMENT_CHANNEL_CLOSED', 'MANAGEMENT_SESSION_REVOKED'):
            try:
                parent_send({'type': 'error', 'code': str(error)})
            except OSError:
                pass
            code = 2
    except Exception:
        try:
            parent_send({'type': 'error', 'code': 'MANAGEMENT_TRANSPORT_FAILED'})
        except OSError:
            pass
        code = 2
    sys.exit(code)
