# Local management admission — U01 source candidate

Status: DEVELOPMENT CANDIDATE with a tested Linux owner-local IPC transport. No production control channel, UI rollout, Windows native IPC, release or full completion of U01 is claimed.

Parent: `GOD13emad/ChatGPTRemoteCommander` PR #243 at `81fd8281ae9090a23783ce91ede9809ccea1fa5d` (tree `1acf820eb2730ed87f332b6026beff13ececf627`). Keep that PR and installed Core/Browser untouched.

## Purpose and boundaries

The native Control Center needs genuine commands, not buttons that only change labels. This candidate implements the admission and result contract for `workflow.pause` and `workflow.cancel`. It forwards only the existing `workflow_control` operation into the resident Core dispatcher, then reads that same instance to verify workflow ID, resulting revision and control intent. It does not start a second WorkflowStore on production data.

The module opens no network listener, pipe, file, browser, model or GUI and is not imported by the server. It cannot start/resume a workflow, execute shell commands, change capabilities, acknowledge deliveries, restart a service, or resolve a GUI incident. A cancel receipt proves recorded control intent; it does not prove that an already-running external process has terminated.

## Admission rules

The envelope has a closed, canonical JSON shape. Duplicate or extra fields, implicit type conversions, invalid revisions, oversized messages and unknown actions are refused before admission. An HMAC with an ephemeral 32-byte key binds the exact session, device, profile, configuration hash, route generation, workflow, revision, action, request ID and expiration. Maximum wire size is 8 KiB and maximum request lifetime is 15 seconds.

HMAC possession is not OS-peer identity or authenticated ChatGPT identity. A separately reviewed native adapter must prove the local user's authority, establish the ephemeral key without exposing it to webpages or logs, revoke on route/config/account changes, and bind both callbacks to the exact resident Core. The adapter must keep peer and operation allowlists; remote web content never receives the key or direct dispatcher access.

The gateway reserves a bounded per-session request record before effect dispatch. Identical concurrent requests share one attempt. Changed content with the same ID is rejected. History is never silently evicted to make a request executable again. The session ID changes on every gateway creation; restart recovery must reconcile prior uncertain effects, not auto-resubmit with a new identity. The in-memory map is not a durable receipt journal.

Expiry and revocation are checked immediately inside the last queued callback before dispatch. An operation or readback deadline leaves an uncertain result and never retries or pretends to cancel an in-flight effect. Errors are redacted to bounded codes. A successful call is not labeled APPLIED without the independent state readback. All callbacks are trusted adapter code, not task-supplied code.

## Tests and applicability

`node --test test/local-management-contract.test.mjs test/workflow-control.test.mjs` includes 42 new admission tests and 14 existing workflow control tests. Two deterministic microtask-boundary tests failed in the first new draft and pass after moving the last admission check into the dispatch callback. The baseline failures are development findings, not newly discovered bugs in installed Commander.

Real disposable SQLite fixtures exercise pause/cancel, revision conflict, duplicate-click handling and persisted control state after reopening. They never dispatch a project step. Full Linux `npm run check` and `npm test` include the new tests explicitly; success counts may overlap across commands and must not be added as unique coverage.

## Remaining integration gates

1. Reviewed OS-specific native bootstrap/peer authorization and key lifecycle, including Windows named-pipe ACLs or a scoped Linux local socket. Port locality alone is not authentication.
2. Route/config rotation, UI reconnect, cross-process crash and durable request reconciliation in the actual resident Core integration.
3. Native UI integration on Windows and GNOME with deliberate user actions, fresh target display, duplicate-click/error feedback and accessibility. Do not weaken the existing read-only panel to create an unreviewed browser-origin bridge.
4. Independent security review, exact integrated hosted checks, genuine device/account acceptance and data-preserving update/rollback. Prior v0.10.24 unsigned permission does not authorize an unsigned v0.10.25 release.

## Primary implementation references

- Node.js IPC support: https://nodejs.org/download/release/v24.20.0/docs/api/net.html#ipc-support
- Node.js HMAC and constant-time comparison: https://nodejs.org/api/crypto.html
- Linux open descriptor semantics: https://man7.org/linux/man-pages/man2/open.2.html
- Linux openat2 path-resolution controls: https://man7.org/linux/man-pages/man2/openat2.2.html

These are design references, not evidence that a native IPC adapter has been implemented or verified here.


## Linux native IPC implementation — 2026-10-17 continuation

`startLinuxLocalManagement` in `src/local-management-linux.mjs` is an explicitly instantiated adapter, not a new daemon or automatic server import. It holds an existing `createWorkflowTools` instance and forwards only pause/cancel through its current `workflow_control` operation, then uses `workflow_get` on that same instance. The Python helper cannot dispatch commands or open workflow data. No new TCP port, shell bridge, model provider, GUI automation, service installation or elevated helper is created.

The adapter launches one owned, unprivileged `/usr/bin/python3 -I -u` relay with anonymous pipes and a minimal environment. The source helper is fixed relative to this module. The relay walks the supplied private runtime directory with descriptor-relative `O_NOFOLLOW`, requires the final directory owner and 0700 mode, creates one random 0700 session directory and a 0600 filesystem Unix socket. It never repairs permissions on rejected existing roots. Linux `SO_PEERCRED` validates the connected client's UID and optional preauthorized PID before any ephemeral key is released. The native Python client independently validates the helper's UID and exact expected PID, private socket metadata and displayed target before using the bootstrap.

This is same-UID, connection-time OS peer authentication, not proof of a human click, signer identity, ongoing peer credentials or ChatGPT account identity. The boundary does not isolate hostile root or same-UID processes. No claim of an actual different-OS-user adversarial session is made; wrong-PID rejection used real sockets, while foreign-UID rejection has separate unit fixtures. Keys are never placed in command arguments, environment variables, files or logs. Logical key buffers are cleared on close, without claiming guaranteed elimination of every interpreter-managed memory copy.

Each adapter permits one client/session with bounded input, idle/lifetime, operation deadlines and request count. The resident gateway rechecks its current device/profile/config/generation just before the actual dispatch callback and again before claiming a verified result. Changing this identity, revocation, a missing result or an uncertain effect cannot silently start another session or replay a mutation. A prefetched parent close frame is checked before a buffered client command; this ordering has a deterministic RED-to-GREEN test. The in-memory request map remains session-local, not a durable cross-restart action journal.

On normal closure or parent-pipe EOF the relay removes only the exact socket inode and its own empty private session directory. An actual killed test parent demonstrated child shutdown and socket cleanup. This is process-death recovery, not host power-loss or reboot durability. Cleanup must not delete foreign entries or a live incident record. Installed Commander instances and private Browser profiles are not involved in these tests.

The test set includes 48 admission cases, 20 Linux transport cases and the 14 existing workflow-control cases (82 Node cases in the targeted invocation), plus 13 Python credential/path/framing unit methods called by one of the transport cases. Counts overlap across targeted/check/test invocations and must not be summed as unique coverage. The first native run's two failures came from test directories unintentionally made private by inherited umask; fixtures now explicitly establish and assert the intended 0755 precondition. The failed run is retained, not relabeled as a product regression or erased.

### Remaining after Linux transport qualification

- Native GUI bootstrap and visible target/confirmation/error feedback; no real user control buttons are connected yet.
- Windows named-pipe/ACL peer bootstrap and corresponding real native tests; the previous Windows gateway results do not qualify this new Linux transport.
- Cross-process durable outcome reconciliation, restart/reconnect UX and explicit treatment of uncertain prior effects; no automated replay.
- Exact integrated hosted CI, independent review, owner-native acceptance and data-preserving package update/rollback before enabling production.

Primary references reviewed for this implementation: Linux `unix(7)` SO_PEERCRED and pathname permissions (https://man7.org/linux/man-pages/man7/unix.7.html), Node IPC (https://nodejs.org/api/net.html), and Python socket APIs (https://docs.python.org/3/library/socket.html). These define interfaces; the project-specific test receipts prove only the stated fixture scope.


### Native GTK owner-control panel (isolated candidate)

run_dashboard(..., management_controller=...) accepts a trusted explicitly injected NativeManagementController. The normal installed control_center.py passes no such argument and remains read-only; no panel appears from a monitor snapshot or CLI/Browser parameter. The injected controller requires an already connected NativeClient using the Linux owner-private SO_PEERCRED transport and a separate read-only workflow inventory whose exact target matches the native session. The inventory is never treated as an authorization token.

The preview shows the target device, profile, route generation and truncated configuration hash, plus eligible workflow IDs, states and revisions. Pause/Cancel have accessible native Gtk.Button labels and a modal Adw.MessageDialog with Do nothing as the default. Only the explicit Confirm response schedules one worker-thread control call. The UI freezes action buttons while awaiting the independent Core receipt, displays APPLIED, REJECTED or UNCERTAIN truthfully, and never retries after an uncertain result. A recorded Cancel does not prove the external process has stopped.

New native_management.py strictly rejects malformed, duplicated, wrong-profile or stale inventory rows. The native_management_view.py presentation component contains no shell/browser/network imports and cannot discover a socket/key/credential. The default Control Center frontend is unchanged. Test-only fake Gtk widgets cover dialog and button callbacks without a display; this is NOT genuine GTK4 render/mouse acceptance. A test-only Python process also runs those callbacks through the real SO_PEERCRED socket against a disposable resident WorkflowStore; project execution tool dispatch is explicitly denied. Production GTK bootstrap and Windows native control remain separate open tasks.


### RTL visibility in isolated window-manager-free X11 testing

The first synthetic dark/RTL screenshot was visually unusable (two unique RGB colors), despite passing native GTK button and dialog callbacks. It was correctly retained as a negative result, not a visual PASS. Independent X11 geometry showed that the GTK top-level in the isolated headless Xvfb session had been mapped at X=-1189 with width1190 on a 1440-pixel display: nearly all of the window was offscreen. The same happened in light/RTL; dark/LTR rendered normally.

In a second independent, disposable **test-harness-only** run, the single synthetic window was repositioned within that private display after verifying the negative X coordinate. The dark/RTL screenshot then contained **829** unique colors (SHA256 ebddfbab2f22246cb46ee2f920b316c349ff1442a9e30659becc3cab1dc108b3), and light/RTL contained **826** (SHA256 2d25c9642a38afe13007fb9d27ab03553205811035d4463205c263eacf7ecbb3). Native modal visibility, dismiss (zero actions), and confirmed Cancel (one control intent) all passed. All Xvfb processes exited.

This relocation belongs **only to the synthetic test fixture**, not the product. A real compositor/window manager's placement policy, genuine GNOME Wayland interaction, Persian readability, HiDPI and owner-authenticated application acceptance remain OPEN. No global GUI settings, installed client or profile were changed. The original negative screenshots, independent corrected screenshots, logs and receipts are retained under the project evidence directory; test screenshot success must never be inherited as live desktop acceptance.


### Native management proposal and receipt strictness (security follow-up)

A deterministic regression found that one GTK confirmation proposal could trigger a second call after a REJECTED receipt, and that an APPLIED-looking receipt with a missing or mistyped schema could be accepted. The exact prior source failed six assertions across three additional test methods, recorded in source-admission-red.log. The source now issues a single controller-owned proposal token at a time; only the latest token can be consumed, and it is invalidated BEFORE checking or sending an effect. Concurrent preparation while another request is executing fails closed. Result schemas must be the exact typed version-1 shape; extras, missing keys and schema substitutions cannot display APPLIED. The new targeted suite passes 15/15 with red and green logs retained. This protects UI-local confirmation semantics; it does not make a browser/LLM-origin approval valid.

### Windows named-pipe peer-authentication feasibility (not production integration)

On the unprivileged Emad Windows QA host, PowerShell 7.6.6 / .NET 10.0.12 performed a genuine two-process handshake using NamedPipeServerStream with PipeOptions.CurrentUserOnly | FirstPipeInstance | Asynchronous. Both processes read peer PIDs through Windows GetNamedPipeClientProcessId / GetNamedPipeServerProcessId and compared values with deliberately spawned counterparts. The bounded HELLO / OK test passed without Administrator, TCP listener, elevated service or persistent pipe. This DOES NOT yet carry a Workflow command or durable Core receipt and does not test a different Windows account or integrity level. QA-only source is test/fixtures/local-management-windows-peer-proof.ps1, invoked on Windows by test/local-management-windows-peer.test.mjs. It is explicitly SKIPPED on Linux; that skip is not Windows evidence.

References: Microsoft PipeOptions.CurrentUserOnly (same Windows account AND elevation level) https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.pipeoptions?view=net-10.0 and peer process ID https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid . Same-user malware, elevated parents, process replacement and unattended account identity remain separate threats. Production Windows relay, bounded authenticated user launch, typed Core dispatch and native GUI acceptance remain OPEN.


### Native Windows owner-only IPC prototype (source-only, not an installed service)

The opt-in src/local-management-windows.mjs reuses the EXACT resident workflow_control and workflow_get implementations. Its child tools/local-management-windows.ps1 implements a one-request Windows Named Pipe (no TCP, shell callback, new workflow store or permanent service) with PipeOptions.CurrentUserOnly | FirstPipeInstance | Asynchronous. Both native peers check Windows kernel-reported process IDs (GetNamedPipeClientProcessId and GetNamedPipeServerProcessId). A fresh ephemeral session key is sent to the verified client through the pipe only; raw request bytes, secret keys and workflow contents are never written to process argv, environment or stdout. Requests carry the existing canonical HMAC, exact device/profile/config hash/route generation, workflow revision and request ID. The relay cannot execute workflows; it only forwards one frame to the existing in-memory Core gateway.

Seven live unprivileged Windows QA cases on Emad Windows PowerShell 7/.NET10/Node: explicit one-time Pause with independently read revision=2; opt-in and wrong initial target refusal; wrong actual client PID; wrong kernel server PID; delayed/UNCERTAIN workflow intent without replay; target generation rotation; and forged HMAC from same-owner process. All 7 exit 0, no project step dispatched and only the positive fixture changes disposable in-memory state. SHA-256 of QA-only helper, adapter, test: see current U01 evidence manifest. test/local-management-windows-ipc.test.mjs is automatically SKIPPED on Linux and must pass on Windows (including hosted CI) for this source tree.

Acceptance boundaries remain OPEN: this is a deliberately injected, source-only QA transport rather than installed Windows Control Center IPC. Script/Pwsh path trust must be established by the final signed installer; same-user/root malware and elevated mixed-integrity clients are not tested or proven excluded. A native GUI owner-approved bootstrap/confirmation, profile binding and durable uncertain outcome reconciliation are still required. UNCERTAIN is never APPLIED or automatically retried. A relay connection is not authenticated ChatGPT account consent; the existing Power Mode/OS and owner-release gates remain intact.

References: Microsoft PipeOptions CurrentUserOnly https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.pipeoptions?view=net-10.0 (Windows account and elevation-level check), GetNamedPipeClientProcessId https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid, GetNamedPipeServerProcessId https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid.


### Recovery after uncertain native control (existing Core journal; source-only)

New native-gateway control calls record their opaque requestId in the existing immutable Core workflow control event reason. The event is committed transactionally in the EXISTING WorkflowStore SQLite file and chained with the current SHA256 event history. No new workflow engine, separate database, blind retry or background process is created.

The trusted native parent may call endpoint.inspectControl({workflowId,requestId,action,expectedRevision}) after a session has closed. Both Linux and Windows adapters expose this read-only method, which invokes only the already-running or correctly reopened Core workflow_export reader after exact target device/profile/config-hash/route-generation revalidation. Raw event history and workflow text remain inside Core and are not returned to the GUI, socket, browser or chatbot. The returned evidence contains only event revision and digest, latest revision and the fact that an external worker exit is NOT proven.

Exactly one matching, intact hashed Core control event at expectedRevision+1 is JOURNALED_APPLIED (recorded historical control intent, not current scheduler or external process outcome). No matching event is UNRESOLVED; it MUST NOT be interpreted as NOT_APPLIED, because an external effect could still be in flight. Multiple matching events or mismatched action/revision are CONFLICT; corruption, read timeout, disconnected Core or target rotation are UNVERIFIED. NONE of these states authorizes a resubmission. This source has no independent owner/ChatGPT identity verification and the current UI has no persistent secure cross-session request-ID inventory; it alone does NOT complete durable owner-facing recovery acceptance.

The new test/local-management-reconcile.test.mjs exercises ten scenarios using disposable REAL Core WorkflowStore SQLite state: control event proof, actual SQLite close/reopen, absent marker, subsequent control revision, conflicting/duplicate marker, target generation and config rotation, corrupted event digest, timeout and missing authorized read adapter. Existing Linux real SO_PEERCRED tests also check the post-close read-only endpoint for one exact request and a never-seen request. The cross-platform Node tests run in Windows CI; Windows owned-native account acceptance remains separate.

Security boundary: requestId in an event is an exact correlation marker, NOT a cryptographic assertion of a unique human. An actor already entitled to write to that Core workflow could forge the reason. A verified journal therefore proves an explicit control event was recorded, not independent human approval. No private credentials or full workflow contents are transferred to the diagnostic response.


### Opt-in native GTK durable pending-control outbox (pilot; not installed)

A verified owner-local native bootstrap may inject NativeRequestOutbox(owner_directory, target) into NativeManagementController(client, scoped_read, outbox=...). The default installed read-only Control Center DOES NOT instantiate this class or open management IPC. The trusted bootstrap must first create and own a private 0700 real directory. The outbox refuses root, untrusted owners/modes, symlink directories/files, group/world-readable SQLite, hard-linked data files, mismatching device/profile/config SHA/route generation, unexpected SQLite schema and unbounded request inventories.

The outbox is a SMALL UI request metadata file, NOT another WorkflowStore. The sole workflow execution authority remains Core. It contains only opaque request IDs, workflow IDs, revision, action, a SHA256 target fingerprint, timestamps and status. On explicit GTK confirmation it commits an IN_FLIGHT request via SQLite FULL synchronous durability BEFORE calling the native client. Only a verified Core admission REJECTED or exact typed APPLIED receipt may transition it to terminal; unknown effect, lost transport, malformed receipt or failed outbox result persistence stays unresolved and blocks further native controls. Restart reopens the same trusted private outbox and displays RECONCILIATION REQUIRED / NO RETRY in GTK preview with ZERO executable buttons. No background work, polling, replay, owner profile installation, credential collection or auto-prune.

Observed Python regression: 75 methods PASS, including previously accepted native GTK simulations and new disposable REAL SQLite permission, symlink, pending-before-dispatch, crash-before-IPC, reopen, multi-handle, same-request, corrupt receipt, failing storage and worker-thread tests. GTK R32 and R39 workflows discover test_native_management_outbox.py automatically. Tests use temporary owner directories and never touch installed workflow databases. Windows CI must not treat skipped POSIX-only cases as Windows product acceptance; these cases explicitly SKIP on Windows.

Open: trusted installer/owner-native bootstrapping and reauthentication; manual Core-journal adjudication that binds saved request identity to a verified WorkflowStore receipt; Windows-equivalent durable owner UI storage; OS security and real user-session acceptance. Outbox metadata is not cryptographic proof of consent and cannot defend against same-UID malware/root, filesystem denial-of-service or compromised trusted native clients. Because no verified adjudication UI exists yet, unresolved rows are intentionally NOT CLEARED just to permit another click. Never classify absent Core journal evidence as NOT_APPLIED, and never claim Cancel killed an external worker.


### Native rejection code allowlist (prevents counterfeit no-effect receipts)

Previously a syntactically well-formed, identity-matching response with state REJECTED and any uppercase code was displayed as definitive no-effect. A source-only red regression reproduced an invalid management outcome marked REJECTED even though the native effect could be uncertain. The controller now accepts REJECTED only for the explicit known-no-effect admission codes emitted by the resident Core gateway, including workflow revision/identity precondition failures and native pre-dispatch expiry/revocation. All unknown rejection codes remain UNCERTAIN, disable further controls, and remain durable in the owner-local pending outbox after restart. This does not prove an external worker has stopped. The red reproduction is retained in the existing project evidence directory; the positive regression is part of the GTK Control Center test suite.


### Read-only owner pending request inspection and human WAITING_INPUT deadline

The existing UI-only NativeRequestOutbox supports an explicit inspect_pending(requestId, trustedCoreInspector) proof review. An authorized native *parent* must inject a properly identity-bound, bounded **read-only** inspector of the actual Core WorkflowStore; neither GTK, web content nor the outbox creates its own Core client. The inspector receives only exact target device/profile/config SHA/route generation and the pending request ID/action/workflow/revision. The outbox validates the returned typed Core event-chain proof (including exact request identity, eventRevision=expectedRevision+1, event digest and explicit workerTerminationVerified=false) before showing a restricted JOURNALED_APPLIED statement. No evidence, mismatch, corruption or lost read yields UNRESOLVED, CONFLICT or UNVERIFIED, never NOT_APPLIED. **All outcomes leave the original pending outbox row blocked. There is no automatic replay, clearance, background retry, new authority, or approval inferred from this diagnostic.** The source-only test uses disposable SQLite and does not inspect installed user workflows.

The project engine's actual WAITING_INPUT scheduler now keeps a valid pending human decision out of the expired-execution-deadline candidate scan, even after the original wall-clock deadline passes. An explicit tick also ignores only that suspended waiting interval while still enforcing the exact workflow scope, policy, revision, action and planner budget. On an authenticated user decision the engine extends the stored deadline by the observed pending human wait; ordinary planning/execution time still consumes the budget. A Windows CI failure on the previous revision was traced to a one-second planner admission test window that could expire under CI load, not proof that human wait consumed the execution clock. The regression now provides a six-second admission window and verifies **both automatic and explicit scheduler ticks after it expires**, plus subsequent resolution. The original red reproducer and exact green/whole-Core logs are preserved in the current project evidence path.

Limitations: inspector authenticity is inherited from a trusted native bootstrap, not proven by the returned Python dictionary alone. No actual user-session UI acceptance, cross-host installs, signed release, human approval or durable Windows owner-outbox parity is inferred. Review this source and current exact-sha CI independently before promotion.


### End-to-end lost-receipt Core/GTK/outbox integration (synthetic signal QA)

A dedicated additional Linux test in test/local-management-gtk-bridge.test.mjs now exercises **one** real owner-local Unix socket between separate Node Core and Python GTK-signal processes, including kernel SO_PEERCRED/PID admission and an actual disposable WorkflowStore. The test-only Python fixture deliberately drops an already **APPLIED** Core control reply after one real pause. This proves the UI-level outbox commits before dispatch and retains exactly one UNCERTAIN request after an outbox close/reopen, with no actionable GTK control buttons after restart. The exact request ID is independently correlated to the actual Core integrity-chained event by the trusted parent endpoint.inspectControl, yielding historical JOURNALED_APPLIED with event digest/revision and workerTerminationVerified=false; the persisted pending record is deliberately NOT unlocked or replayed. No workflow steps run and no second control dispatch occurs.

The test is **synthetic GTK signals, not an actual compositor or keyboard acceptance**; it is auto-SKIPPED on Windows. Actual Windows named-pipe tests, live owner GNOME/Wayland RTL, user-account identity binding, fully installed GUI, cross-host promotion and rollback are separate open gates. The recovered historic control intent is not evidence that a worker has stopped, and a missing event remains UNRESOLVED. The disposable QA experiment never accesses installed user profiles, credentials or workflows.
