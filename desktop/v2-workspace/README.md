# Commander V2 Workspace — GUI preview

The dark unified workspace is implemented in the existing Commander V2 source tree, matching the owner-approved visual composition: chat/drafts, projects, agents, systems, native desktop/browser slots, progress/status, and task table.

**Acceptance status:** interactive local GUI preview, not authenticated Commander V2, production installer, desktop-control integration, or Stable release. Visual panels never claim an attached stream or successful action without receipts. V1 and existing profiles/services are never changed by this app.

## Start

- Windows desktop user: double-click `start-windows.cmd` (Node.js >=22 required).
- Linux desktop user: `sh start-linux.sh` (Node.js >=22 required).
- The default browser opens automatically. Keep the launcher running while using the GUI; close the launcher to stop the loopback server. Nothing is installed as a Windows Service/systemd service or startup program.
- Default loopback port: `47955`; set `RC_V2_PORT` to another free port if needed. The interface uses browser-local drafts; at a different port drafts do **not** automatically transfer.
- Optional read-only Core health observation: set `RC_V2_CORE_URL=http://127.0.0.1:48844` in your owner session **only if this is your verified local Core endpoint**. No Core writes or tool invocation are possible through this preview.

Example PowerShell, without changing the running V1 service:

```powershell
$env:RC_V2_CORE_URL='http://127.0.0.1:48844'
& '.\start-windows.cmd'
```

## R15 — explicit V1 profile targeting (read-only)

The Workspace's owner-local V1 status and project reader defaults to
`http://127.0.0.1:47831/mcp` and profile `default`.
For a different **already-running** V1 instance, set both variables **in the
same interactive owner process** before starting Workspace:

```sh
RC_V2_V1_MCP_URL=http://127.0.0.1:47910/mcp RC_V2_V1_PROFILE=MMZ node server.mjs
```

This command is only an example for a host where port 47910 actually belongs
to `MMZ`; ports are not assumed identical between machines. Allowed endpoints
are HTTP on numeric `127.0.0.1` with exact `/mcp`, no credentials, query
or fragment, and an explicit profile. If the reported V1 profile does not
match, Workspace shows `PROFILE_MISMATCH` and refuses to read WorkflowStore
metadata. A matched profile **is not authentication** or permission to execute
a tool; all GUI and handoff routes remain read-only. Do not copy another user's
credentials, or infer a session grant from a V1 profile label.

Windows interactive-owner migration from existing pinned R12 to candidate R15:
`node upgrade-r12-to-r15.mjs` while the owner Workspace window is closed.
The current SYSTEM/Service caller cannot perform this owner upgrade.

## Security and UX

- Static UI + narrow no-dependency Node HTTP process on `127.0.0.1` only; tokened read-only status API and strict CSP/Host/method guard.
- The 48-hex token in the browser URL fragment is used in an explicit status header. The URL fragment is not sent to the HTTP server. Keep the launched URL/private browser profile private.
- No cross-origin URLs, filesystem scanning, command execution, ChatGPT account automation, cookie/session extraction, privilege elevation or GUI input.
- Clicking on unavailable control explicitly reports that owner-session pairing is required. Task editor creates only local drafts, not actual ChatGPT messages. Browser localStorage stores task text in that browser profile, so don't put secrets in draft text.
- This is a common GUI surface, not a second WorkflowStore, scheduler, auth server or Project Brain. Production integration must bind authorized V2 receipts and owner session streams to these UI slots, without inventing simulated success.

## Verification

```sh
node --check server.mjs
node --check app.js
node --test server.test.mjs
```

The UI acceptance gate additionally needs an owner-session visual run, Windows/Linux browser smoke, authenticated V2 service, native desktop/browser proof, five-host deployment, signed release and independent security/review. None is claimed by passing the four scoped Node tests.

## Upstream design sources

- [Chat On Steroids](https://github.com/totec448-spec/chat-on-steroids) — workspace/worker/task UX patterns; no copied code, no competing runtime.
- [Codex ChatGPT Web](https://github.com/miuuyy/codex-chatgpt-web) — concept/reference for model/harness routes; this preview does not invoke unofficial browser bridges or consume ChatGPT Work credits.
- GUI image is an owner-approved target design, not a real product screenshot. The interface intentionally uses honest no-stream placeholders until integration is verified.


## MMZ owner-private telemetry adapter (R6 follow-up)

The unified GUI now reuses the **read-only data contract**, not the separate executable/runtime, of Mohammad's local development sources:
- /home/mmz/source/repos/RC_CONTROL_CENTER_PRODUCT_R1/desktop/linux-control-center/control_center.py, inspected SHA-256 5478d5620234e6037825b3baca2a07206dd1aa1d42268a203d8d83e973039946
- /home/mmz/source/repos/RC_UI_MONITOR_R1/desktop/linux-control-center/control_center.py, inspected SHA-256 ee23db980da38a5cea2c08da117e406e1dc6e7bfa3672e13493870bf77975751
- The adapter lives at local-evidence.mjs and uses only Node standard libraries. It is a **limited port of the monitor/registry reader semantics**, not a vendored GTK UI or browser automation extension. Source provenance remains attached to existing MMZ repositories. Original uncommitted branches remain unchanged.

The Linux owner-local Workspace reads the existing ~/.local/state/chatgpt-remote-commander/browser-companion/commander-monitor.json and multi-chat registry/events, if present. All file reads enforce UID, owner-only file/directory permissions, regular files, no-follow symlink and size limits; monitor timestamps expire, and cross-project Chat events cannot confer authenticated status. Any observed GUI availability is labelled AVAILABLE_REQUIRES_AUTH. The Projects view may list metadata titles from the current user's private registry in that same browser process. It must not be interpreted as proof of model control or connected ChatGPT identity. Workflow observations are telemetry only, not execution receipts. Windows reports UNSUPPORTED for this Linux-specific private state source; the existing independent loopback health probe remains.

No extra service, worker, chat/browser credential, SQLite database, workflow manager or account is created. The bridge remains read-only. There is no implicit external network access, data sync or ChatGPT Work dispatch. Do not use a SYSTEM/root instance to access another user's metadata: the adapter's Linux UID gate is scoped to the process owner.

Verification:
- Windows: node --test server.test.mjs local-evidence.test.mjs (Linux-only file fixtures report SKIP).
- Linux: the same test command fully exercises owner-only files and staleness/correlation fixtures.
- Live owner Linux check is limited to sanitized metadata; it cannot prove user-session GUIs, provider auth, or account-level permissions.
- R6 GUI owner-session live stream/actuation, R2 identities, R5 CEF connector and R9 Stable are OPEN.


## Owner-local standalone Chromium application window

This is a distinct Chromium app-mode window built on the existing V2 GUI files, not a full Electron binary or an authenticated ChatGPT Work client. It uses a separate owner-local browser profile with extensions/sync disabled and a single-instance lock. The gateway closes when the app window closes.

Run directly: Windows start-desktop-windows.cmd; Linux sh start-desktop-linux.sh. Requires Node.js 22+ and installed Chrome/Edge on Windows or Chrome/Chromium on Linux.

User-local install from the latest extracted package containing MANIFEST.json:
- Windows PowerShell: run install-user-windows.ps1. Runtime under %LOCALAPPDATA%\CommanderV2\WorkspacePreview; Start Menu shortcut Commander V2 Workspace Preview.
- Linux: bash install-user-linux.sh. Runtime under ~/.local/share/CommanderV2/WorkspacePreview; desktop entry under ~/.local/share/applications.
- No Administrator/root, Windows service, systemd unit, startup app, browser extension, existing browser profile mutation or V1 migration.
- Reinstall only succeeds with identical runtime hashes and a matching shortcut. Conflicting targets stop without replacement.
- Dedicated browser profile persists local draft text between launches under the owning user's CommanderV2 state directory. Do not put secrets in drafts.
- After power loss a stale owner lock can remain; check for live window/process before independently reconciling that single lock. The app refuses to delete unknown locks.
- This is still a GUI preview. It cannot claim ChatGPT auth, command dispatch or desktop/browser input without separate live-gate acceptance.

Scoped tests: node --test server.test.mjs local-evidence.test.mjs desktop-app.test.mjs.


## R4: owner-seat observation and explicit version-pinned upgrade

The GUI now reads the Windows V2OwnerSeat latest.json heartbeat only from the *actual current user's* local profile and rechecks the operating-system user identity. It shows sanitized counts of known browser processes/windows; no titles, process IDs, credentials, login state, or actions are exposed. Monitor-only observations NEVER grant chat or tool permissions. Remote Commander under its separate machine/service token correctly reports NOT_CONFIGURED; the owner launches the application from their Start Menu for same-user observation. Linux retains its owner-private MMZ monitor adapter.

For systems with the exact prior R3 install, extract the R4 ZIP and run `node upgrade-user.mjs` under the *actual desktop owner account*, while the GUI is closed. This validates pinned R3 source hashes in PREVIOUS_RELEASE.json, stages eight runtime files, upgrades in place while preserving the separate browser-profile/drafts directory, verifies hashes, and rolls back staged changes if an update step fails. Unknown local modifications or active/stale app instance locks block changes. The install-user scripts only accept identical reinstalls or fresh installs, not silent upgrades. This mechanism does not enroll ChatGPT, create grants, or modify V1.

Tests: `node --test server.test.mjs local-evidence.test.mjs owner-seat-evidence.test.mjs desktop-app.test.mjs upgrade-user.test.mjs`. An OS-user interactive GUI check and authenticated V2 workflow receipts still remain separate OPEN acceptance gates.


## R5: real workflow status presentation, no simulated receipt

The same installed V2 Workspace GUI now has /api/workflow (GET, local host + 48-hex session token; no browser-supplied route/target or workflow identity). The endpoint is NOT_CONNECTED by default; no service is started, no extra database is created, and no V1 bearer/profile is imported. The GUI uses textContent only and displays the actual bounded canonical WorkflowStore step IDs/statuses and workflow lifecycle only if a trusted owner-native application composition passes a trustedWorkflowReader callback. That callback must itself independently check OAuth principal, real owner-native session, consent, exact workflow_read grant and data freshness, e.g. via existing readV2OwnerWorkflowSummary; the UI callback is not wired to a provider in this preview. Rejects malformed callback results, input injection, duplicate steps and false receipt claims. isExecutionReceipt=false is immutable; this view cannot turn a recorded step into a completed workflow.

Source tests: node --test server.test.mjs workflow-view.test.mjs upgrade-user.test.mjs and the other bundled scoped tests. Version-pinned in-place upgrade now R4 -> R5, preserving the dedicated browser profile and local drafts; PREVIOUS_RELEASE.json is derived from the exact R4-fixed ZIP sha256 003444651d7b8a71a368505b23f752c82382b34ec4b5f8a74857aec31a4e71c5, not a guessed baseline. For already installed R4, from extracted R5 under the same OS owner session while the UI is closed run node upgrade-user.mjs. install-user-* scripts are for new/identical installs, not a substitute for the pinned updater. This is not a real OAuth enrollment, tool dispatch or Stable acceptance.


## R6: reconciled Coordinator record (not a verified worker effect)

The owner-local GUI now supports optional `/api/fenced-receipt` (GET, loopback token; no model-supplied route or receipt ID). This read-only route is disabled without the `trustedReceiptReader` native owner dependency; absent enrollment yields NOT_CONNECTED, and revoked/malformed evidence yields UNVERIFIED with no private error disclosure.

The canonical Core module `src/v2-owner-fenced-receipt.mjs` re-attests the native session and current OAuth principal, checks exact caller, workflow_read grant and explicit owner approval, ties receiptId to the attested operationId, and obtains the result from the existing V2CentralCoordinator.getFencedReceipt database. It rechecks grants/session after the read, rejects unexpected fields and fake results, and never treats Coordinator commitment as successful external worker action. GUI text always states workerEffectVerified=false. No additional Coordinator, database, worker, login, or runtime service is introduced.

The existing GUI is intentionally a developer preview until the real owner OAuth account/session, authorized operation, live actuator receipt and external effect validation have been independently accepted. The R5->R6 upgrade changes nine runtime files in place, checks the exact R5 SHA-256 `fedf3d141c73004efb46ed6367b33b7defc0f46823c184f57f3e390cabef0810`, preserves private browser-profile/drafts, and rejects unknown installations or locks rather than replacing them.


## R7: owner-private file-effect attestation (restricted scope)

The existing V2CentralCoordinator and V2GuardedArtifactActuator now have a strictly owner-attested read-only reconciliation through src/v2-owner-private-artifact-proof.mjs. It verifies the exact native route, OAuth principal, workflow_read grant and consent before and after checking both the central fenced receipt and digest of an actual immutable file in the existing Coordinator-private artifact store. The proof is **limited to this private staged artifact**. It never claims successful desktop, browser, terminal, workflow acceptance, or arbitrary project file changes. If the file is absent, mismatched, modified or the native grant was revoked, successful effect cannot be claimed.

The local GUI optionally reads /api/private-artifact through its existing ephemeral token and injected trustedPrivateArtifactReader dependency. Unconfigured preview defaults to NOT_CONNECTED; malformed or rejected evidence returns UNVERIFIED. The three panels remain distinct: WorkflowStore state, central Coordinator DB receipt, and physically verified Coordinator-private artifact. The latter explicitly reports workerEffectVerified=false. No extra app service, secret, external endpoint, login reuse, or V1 modifications.

The owner-local updater changes the same nine runtime files in place from exactly verified R6 ZIP SHA256 66fbe753737adac070c9541ab917096f6717e95dc4ea996af756079ea996e34a, retaining browser-profile and drafts, and preserving the prior rollback/fail-closed rules. This is still preview NoPromote pending real native consent, OAuth, worker effect & independent end-to-end acceptance.


## R8 — transport observation in Systems

The owner-local read-only GUI now probes exactly one *pinned localhost* V2 RPC port per known installed machine: Windows Emad-PC-Ultimate and Linux aliemad-Labtop use 127.0.0.1:48789; MMZ uses 127.0.0.1:48787. It sends a bounded anonymous POST with empty JSON to the existing get-receipt path. An HTTP 401 yields ANONYMOUS_DENIED, proving only a local listener refused unauthenticated access. It never reads or sends a worker token, passes a route, authenticates ChatGPT, or claims a Worker effect. All non-401 responses, missing listeners and unknown machines remain unverified. The Systems/Agents panels display this read-only state and explicitly label both owner RPC and ChatGPT OAuth NOT VERIFIED.

R8 is installed in place over exactly pinned R7 SHA256 29b7348051678832f57936f727f48a934b68c09d4ae727585d2b914bb7b476e2, with one added runtime module transport-evidence.mjs; existing owner browser-profile/drafts and V1 remain untouched. It refuses active locks, modified R7 baselines and unexpected preexisting transport-evidence.mjs, and verifies runtime hashes on completion. This is still LOCAL_GUI_PREVIEW_NO_PROMOTION, not Stable.


## R9 — owner-native read-only diagnostic Coordinator evidence

R9 shows the *existing diagnostic* central Coordinator fenced receipt and matching immutable artifact inside the Workspace Workflow/History panels **only** when it can read already-approved, owner-local V2 Worker credentials under the same Linux user. It never creates or imports another account, changes privileges, grants a new host, or reuses V1 secrets. Supported existing diagnostic configurations are the Ali laptop and MMZ laptop; Windows is deliberately NOT_CONNECTED because MMZ has not approved its native V2 diagnostic credential. The native diagnostic reader validates exact known host/user, rejects root/SYSTEM, hash-checks the existing trusted RPC client and route contract, verifies the owner's private token file, and binds only the already authorized local-v2-diagnostic receipt id. It compares the central receipt with the independently observed immutable artifact SHA-256 and fence. The private bearer secret stays on the owner machine and is never emitted in the GUI/API.

The GUI labels this evidence explicitly as **not an external desktop/browser action** and **not authenticated ChatGPT OAuth**; it does not infer Worker effect success from a Coordinator receipt. Missing, revoked, tampered or unreachable client/credential/Coordinator evidence remains NOT_CONNECTED or UNVERIFIED; no cached success, bypass or independent re-enrollment. R9 uses a pinned in-place R8→R9 transaction that preserves existing personal profiles and drafts, and does not alter V1.
