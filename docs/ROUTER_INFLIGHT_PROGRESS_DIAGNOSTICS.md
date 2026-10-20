# Router in-flight progress diagnostics (QA-only acceptance)

## Problem
A canonical loopback MCP router must preserve a potentially mutating upstream
`tools/call` request after a downstream caller disconnects. The backend might
still execute an operation or be waiting to send a response. Older versions
only returned a count and coarse request metadata. An old backend with an
ESTABLISHED loopback connection must not be killed based on elapsed wall time.

## New fields on `/router/status`
Each *currently in-flight* row in `inflightDetailsByPort` now adds:

- `clientDisconnected` — this router observed its downstream HTTP response
  close before upstream retirement. False is not a positive authentication
  of the user or proof that the downstream process is alive.
- `backendConnectionObserved` — the outbound HTTP socket connected at least
  once. It does **not** prove the worker is alive, making progress or that
  the requested tool executed or completed.
- `backendResponseStarted` — the HTTP backend has sent response headers.
- `lastBackendResponseByteAt` — most recent HTTP response data chunk observed
  by this router (ISO timestamp), initially null. Not a completion receipt.

These are process-local, ephemeral observability hints; they are not a
durable operation receipt, trusted owner attestation, or native GUI
quiescence certificate. Values are not supplied by the MCP caller.
No command argument, bearer token, remote identifier or result body is
retained in the router's status object.

## Safety / invariant
No change to route generation CAS, backend selection, timeout, automatic
retirement, upstream cancellation, native GUI input, browser sessions or
security policy. In-flight accounting is removed only on the backend
response end/close or the upstream request error, **not** on client
disconnection or "no response for N minutes". An HTTP transport close
does not prove that an earlier native side effect was not performed.
A backend owner must use separate durable operation/dispatch evidence
before any retention or retirement decision.

## Qualification
`node --test test/stable-router.test.mjs test/router-retire.test.mjs
test/router-schema-continuity.test.mjs` — 13/13 passed on disposable
localhost fixtures. Specific regressions:
- Disconnect downstream while backend is still waiting. Verify
  `clientDisconnected=true`, `backendResponseStarted=false` and
  in-flight count remains 1 until the backend completes.
- Receive some backend response bytes, hold its completion. Verify
  `lastBackendResponseByteAt` and pending count 1; only `end` frees it.
- No model-provided argument text leaks into status metadata.
- Existing route generation and retirement checks remain unchanged.

These fixtures are not a deployed change or proof of the historical
Emad-PC `run_shell` operation's completion. See issue #291 for host
read-only socket/process evidence and issue #142 for independent GUI
incident owner-review requirements.
