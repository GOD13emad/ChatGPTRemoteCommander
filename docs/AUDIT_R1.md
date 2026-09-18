# Deep audit R1 — GUI control and release safety

Date: 2026-09-18. Status: **AUDIT COMPLETE / CORRECTIVE CANDIDATE / RELEASE BLOCKED**.

This report distinguishes inspected code, executed tests, historical claims and open validation. It is not a security certification. The single corrective objective in R1 is **safe admission and coordination of native GUI requests**. Other product defects below are recorded, not silently bundled into an untested release.

## Baseline and authority

| Reference | Observed commit | Role |
|---|---|---|
| `main` | `14506569eee45e671f90b51df716e24e524f41e0` | Public branch; runtime package still 0.4.4 |
| Latest release `v0.4.4` | `d9987cac01a5161814c6ea9fa1d36de1c25fe444` | Existing release; not changed by this audit |
| `gui-control-v0.5` | `7cf959b2ee83e1f9588e169d5402024fc91e33ef` | Windows GUI implementation used as R1 source baseline |
| `feature/gui-control-v0.5.0` | `3016f1ad70e8e95495792c9ec2603659a9a97ece` | Separate, incompatible Windows/X11 GUI proposal; preserved, not merged |

Both GUI proposals call themselves 0.5.0 but have different tool names and policy keys. Neither is an accepted production authority. **Do not run either GUI proposal as a production upgrade based solely on its version string.** The audit candidate is for review and explicitly scoped tests, not automatic installation. No live PC files, tunnel profiles, credentials, or services were touched.

## Goal and definition of done

The product must let authorized users operate the intended Windows/Linux computer through a private MCP connection, with correct tool identity, least necessary access, dependable start/stop/update, and honest GUI capabilities. Release acceptance requires reproducible tests on the exact artifact, real target-machine checks, negative security tests, unchanged credential hashes, rollback, and real ChatGPT tool invocation. A published ZIP, an open port, a source scan or an installed Codex skill alone is not acceptance.

## Findings

Priorities express engineering impact, not a CVSS score. `FIXED-CANDIDATE` means code changed and the stated scoped tests passed; it does not mean deployed or Windows-accepted.

| ID | Priority | Evidence and impact | R1 disposition |
|---|---|---|---|
| A01 | Critical | `gui-tools-windows.mjs` constructs `{action: fixed, ...input}`. Extra `action` can overwrite the route; the server does not validate the advertised input schema. A caller with screenshot routing can request another native action. | FIXED-CANDIDATE: closed runtime schemas, fixed dispatch last; negative tests. |
| A02 | High | GUI requests run independently. Filesystem path locks do not serialize a single desktop across chats. | FIXED-CANDIDATE: exclusive expiring lease, busy rejection, one native mutex; JS coordination tested, native mutex unverified. |
| A03 | High | Clicks/typing have no fresh-frame, monitor or foreground precondition. Title search takes the first matching window. | FIXED-CANDIDATE: single-use 15-second frame, monitor geometry and handle/PID preconditions, unique selector; native behavior still pending. |
| A04 | High | The Windows `INPUT` union contains only KEYBDINPUT, not MOUSEINPUT/HARDWAREINPUT; the passed structure size does not match the full Win32 INPUT layout. | Corrected union and layout assertions; Windows compilation/layout gate OPEN. |
| A05 | High | KeyCombo injects earlier keys before validating later names, without guaranteed finally cleanup. An invalid key after CTRL can strand a modifier. | Full prevalidation and release cleanup added; native partial-failure test OPEN. Hard process termination can still preempt cleanup. |
| A06 | High | Long typing and unbounded helper stdout/screenshots can exceed the watchdog or memory budget; failure output may disclose private data. | FIXED-CANDIDATE: bounded request/actions/image/streams, stdin JSON, sanitized errors, uncertainty latch; process-lifecycle tests PASS. |
| A07 | High | A platform string or UserInteractive alone does not prove the correct unlocked active desktop. DPI mismatch can shift clicks. | WTS state, input-desktop identity and thread-DPI checks added; real DPI/locked/RDP/session tests OPEN. |
| A08 | High | GUI actions are annotated `destructiveHint:false` although typing/clicking can submit, delete or change data. No local stop mechanism exists. | Correct annotations, fixed local stop file and physical Escape, uncertain-outcome latch; Node policy/stop tests PASS, native stop test OPEN. |
| A09 | Critical | The HTTP endpoint accepts JSON bodies without validating Origin/Host/content type; loopback binding alone is not a browser/DNS-rebinding defense. | FIXED-CANDIDATE: exact loopback Host, no browser Origin, JSON content-type, no-store. Actual dispatcher tested with stubbed backends. Tunnel forwarding compatibility OPEN. |
| A10 | High | Power filesystem containment checks lexical paths, then follows symlinks via stat/read/write when fullFilesystem=false. | OPEN: canonical containment, link/reparse-point and race tests needed. Full shell access remains explicitly privileged, never a sandbox. |
| A11 | High | copy/move overwrite removes destination before validating source/destination relationships; self-copy can remove its own source. | OPEN: reject same-path/ancestor/descendant hazards before writes; transactional stage/swap/rollback required. |
| A12 | High | Exact-string path locks do not conflict on parent-directory versus child-file mutations or canonical aliases. | OPEN: canonical hierarchy-aware locks or an equivalent transactional design. |
| A13 | High | Windows installer rebuilds config.local.json from defaults. Selecting Standard does not remove/disable an existing Power local policy but reports it OFF. Same-version configuration changes can leave the running old policy. | OPEN: explicit mode transitions, retain unrelated local settings, backup/rollback and config-identity restart. |
| A14 | High | A latest-release installer fetches/pulls `main`, so the executed source can differ from the release artifact. Bootstrap/Plugin ZIP integrity and version alignment are not enforced end-to-end. | OPEN: immutable revision/artifact pinning, expected hash, preflight and transactional updater. |
| A15 | High | Profile name is used in YAML paths but separately sanitized for credential names; alias/path hazards are possible. Credential write precedes successful validation. Existing profile may ignore requested TunnelId/HealthPort. | OPEN: strict profile identity, no silent replacement, stage/commit enrollment and port-owner validation. |
| A16 | High | Supervisor selects an executable by lexicographic recursive search and treats process presence/loosely matching health as success. Stop/start matching is broader than a pinned root+PID+executable identity. | OPEN: exact executable/version, owned process registry and real readiness/reconnect checks. |
| A17 | High | Parallel GUI branches disagree on names, policy and Linux support; one enables GUI as part of Power Mode, the other requires explicit opt-in. | OPEN: choose one reviewed contract; preserve both histories; no blind merge or auto-enabling GUI. |
| A18 | High | GUI tests mostly inspect strings. Tool-schema discovery is not input validation or native runtime acceptance. The original static gate also compares a lowercase text phrase with an uppercase Skill phrase. | Replaced GUI-specific gate with behavioral tests; whole-repository/native/Windows E2E gates OPEN. |
| A19 | Medium | SECURITY_AUDIT_PASS is a regex/ignore/history scan, not authorization, containment or remote exposure verification. GUI screenshot privacy and shared-desktop trust boundaries were underspecified. | Scope clarified; screenshot/text data never in candidate error logs; authentication/tenant isolation and privacy review remain OPEN. |
| A20 | Medium | Release/main/Plugin ZIP can carry different guidance. Prior Project Brain is unavailable here; current claims depend partly on historical chat reports. Public icon is larger than the previously observed 10 KB UI limit. | OPEN: consistent release manifest, UI-specific icon variant, complete private Brain merge and fresh acceptance evidence. |

## Implemented corrective design

A client first obtains a short-lived lease, captures a frame, and supplies the lease plus that single-use frame to one action. Backend routing is derived from the tool name, never caller fields. Input invalidates the frame before it is attempted. A changed foreground or monitor causes refusal rather than a guessed click. Concurrent work is rejected instead of queued behind a stale screen observation. The lease is deliberately described as coordination, **not account authentication**.

The native helper uses a correctly sized INPUT union, verifies SendInput counts, prevalidates keys, releases attempted keys/buttons in cleanup, and checks the current desktop. It does not elevate, switch protected desktops, unlock Windows, bypass anti-cheat or change network settings. Killing a hung native process can prevent cleanup; such input outcomes are latched as uncertain and must not be replayed automatically.

A screenshot returns an MCP image with bounded native-coordinate metadata. The model must inspect that image and verify a fresh image after input. `submitted:true` is not visible success. GUI edits are privileged; a user with general shell/OS access can bypass application-level controls. Different users with different trust levels need real authorization and separate OS sessions, not just different tunnels.

## Executed verification

Environment: Linux container; Node.js v22.16.0; Git 2.47.3. No live Windows host, PowerShell parser, .NET compiler or ChatGPT GUI tool path was available.

- `node --check` for changed JavaScript: PASS.
- `node test/gui-control-check.mjs`: **67 tests passed, zero failed, zero skipped**.
- Tests include strict runtime schemas, action spoof rejection, key/Unicode bounds, lease ownership/expiry, frame replay/staleness, contention, local-stop behavior, native uncertainty, image/result validation, and actual helper subprocess failure/timeout/output-bound behavior.
- HTTP integration executes the real candidate dispatcher, but filesystem/Power/platform backends are stubs. It verifies Origin/Host/content-type rejection, valid local JSON RPC, invalid tool handling and cache control.
- GUI backend results are mocked. The image fixture is not a captured real desktop or a visual acceptance test.
- Full repository `npm run check`, `npm test`, `npm run audit`, Windows native compile, Windows/Linux runtime regression and tunnel/ChatGPT end-to-end were **NOT RUN** in this audit environment.

Observed CI run 35375130999 reports failure for both Windows and Ubuntu jobs without step results. Historical chat attributed earlier failures to billing, but this audit has not re-proven that exact current cause from annotations. Do not mark remote CI PASS or assume it tested the candidate.

### Diagnostic failure retained

The first HTTP test attempted to set Host with Node fetch and expected rejection. It failed because the test client normalized Host to the actual local destination. A small raw receiver established the harness behavior. The test now uses `http.request`, verifies the sent Host, and passes. The initial failure log is retained privately with the final TAP evidence. No production guard was weakened to make the test pass.

## Open acceptance and roadmap

1. R1: review this candidate; run Windows parser/C# layout-only tests without input; inspect diff and regression evidence.
2. R2: complete native GUI validation on a disposable test app, including Farsi/emoji text, DPI/monitor mapping, stop during holds/drag, changed focus, denied/locked desktop and recovery.
3. R3: repair filesystem transactions/containment and installer/profile ownership defects, each with pre-state, regression and rollback evidence.
4. R4: reconcile Windows/Linux GUI contract and run native X11 tests on an authorized Linux desktop; unsupported Wayland must remain explicit.
5. R5: real MCP/Tunnel/ChatGPT read, image, controlled input and multi-chat tests; verify both account identities and lease conflict behavior.
6. R6: pin release artifacts, validate clean Windows/Linux install/update/stop/start and unchanged credentials, synchronize Plugin package/docs/icons, close external CI and Brain gaps.
7. Release: explicit review/acceptance, then tag/assets/promote. Never auto-promote this audit branch.

No percentage is assigned to the whole product: remaining gates are not measured by completed activity count. The scoped R1 Node suite is 67/67; Windows GUI acceptance is unproven.

## Primary references

- Microsoft INPUT structure: https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-input
- Microsoft SendInput (structure size, insertion count, UIPI and pre-held input): https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
- Microsoft OpenInputDesktop: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-openinputdesktop
- Microsoft SetThreadDpiAwarenessContext: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext
- MCP 2026-07-28 Streamable HTTP security: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
- MCP tool schema/image content: https://modelcontextprotocol.io/specification/2025-11-25/server/tools

These references support the API/protocol requirements; project defects are derived from the pinned source above. Tests support only the explicitly stated scope.
