"""Test-only native client. The descriptor has no secrets; bootstrap stays on UDS."""
import importlib.util
import json
import os
import pathlib
import sys

module_path = pathlib.Path(__file__).resolve().parents[2] / 'tools/local-management-linux.py'
spec = importlib.util.spec_from_file_location('rc_local_transport', module_path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
try:
    descriptor = m.strict_json(sys.stdin.buffer.readline(65536))
    receipts = []
    with m.NativeClient(descriptor['endpoint'], descriptor['serverPid'], descriptor['target'], timeout=3) as client:
        for item in descriptor.get('commands', []):
            receipts.append(client.control(*item))
    print(json.dumps({'receipts': receipts, 'uid': os.getuid(), 'pid': os.getpid()}))
except m.ManagementError as error:
    print(json.dumps({'error': str(error)}))
    sys.exit(2)
except Exception:
    print(json.dumps({'error': 'MANAGEMENT_CLIENT_FAILED'}))
    sys.exit(2)
