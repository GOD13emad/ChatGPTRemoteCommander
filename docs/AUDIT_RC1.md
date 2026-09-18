# Deep audit RC1 — consolidated v0.5.0 release candidate

Date: 2026-09-18. Status: **CODE HARDENED / RELEASE CANDIDATE / REAL-MACHINE ACCEPTANCE REQUIRED**.

This document continues `docs/AUDIT_R1.md`. R1 remains historical evidence. RC1 selects one GUI contract, reconciles newer `main` GUI improvements, closes the recorded filesystem/install/profile/process-ownership design defects in code, and makes final promotion evidence-gated.

## Authority and branch policy

- Public production remains the latest published Release until v0.5.0 acceptance is complete.
- Candidate branch: `release/v0.5.0-rc1`.
- Draft release PR: #2.
- The separate GUI research branches remain preserved for history but are **not** release authority.
- v0.5.0 authority is the audited Windows lease/frame implementation plus the later native UTF-8/focus improvements reconciled from current `main`.
- Native GUI control is Windows-only in v0.5.0. Cross-platform filesystem/shell/tunnel/runtime support remains Windows + Linux.

## Final GUI contract

A model cannot issue a direct click from an old screenshot.

1. `gui_status` verifies the interactive desktop.
2. `gui_session_begin` obtains a short-lived exclusive GUI coordination lease.
3. `gui_screenshot` returns MCP image content plus a short-lived **single-use frame**.
4. Exactly one mutating GUI action consumes the matching `lease + frame`.
5. A new screenshot verifies the visible result.
6. The session is renewed only as needed and ends with `gui_session_end`.

Additional rules:

- a second GUI lease is rejected while one is active;
- stale/replayed frames are refused before native input;
- changed foreground/monitor state is refused;
- known clean precondition failures require a fresh frame but do not require a server restart;
- ambiguous process death/timeout/SendInput/release failure hard-latches the GUI as uncertain and prevents blind retry;
- physical Escape and local `var/GUI_STOP` are owner controls and must not be bypassed remotely;
- GUI leases coordinate a shared desktop; they are not account authentication or an OS sandbox.

## Native Windows control

The native layer uses standard Win32/GDI/User32 behavior in the current user session:

- monitor geometry and screen capture;
- MCP PNG/JPEG image content;
- exact visible-window enumeration and focus;
- absolute/relative pointer movement, click, drag and wheel;
- Unicode text through `KEYEVENTF_UNICODE`;
- bounded key combinations/holds;
- full Win32 `INPUT` layout verification;
- foreground process/window preconditions;
- active input-desktop and DPI-awareness checks;
- physical modifier/button checks and best-effort release cleanup;
- global per-user native-action mutex;
- UTF-8 stdin/stdout for multilingual payloads.

It does **not** elevate, unlock Windows, switch Secure Desktop, bypass UIPI/anti-cheat/RawInput/security boundaries, or guarantee high-speed real-time gameplay.

## R1 finding disposition

| ID | RC1 state | Current disposition |
|---|---|---|
| A01 GUI action spoofing | IMPLEMENTED | Closed runtime schemas; action derived from tool name; extra fields rejected. |
| A02 concurrent GUI chats | IMPLEMENTED | Exclusive lease + busy rejection; native mutex also prevents simultaneous helper injection. |
| A03 stale visual state | IMPLEMENTED | Single-use 15s frame, monitor/foreground/PID preconditions, exact-window selector. |
| A04 Win32 INPUT layout | IMPLEMENTED | Correct INPUT union/layout and self-test; exact RC Windows gate still must execute. |
| A05 stranded keys/buttons | IMPLEMENTED | Full key prevalidation and finally release attempts; ambiguous release failure latches uncertainty. |
| A06 helper/output bounds | IMPLEMENTED | Request, timing, image and stream limits; sanitized structured errors. |
| A07 desktop/DPI identity | IMPLEMENTED-CANDIDATE | WTS/input-desktop/DPI checks in native code; real multi-monitor/DPI/lock evidence required. |
| A08 stop/destructive semantics | IMPLEMENTED-CANDIDATE | Mutating annotations, Escape/GUI_STOP and uncertainty behavior; real stop evidence required. |
| A09 HTTP browser/rebinding surface | IMPLEMENTED-CANDIDATE | Loopback Host/Origin/content-type/no-store admission; real Secure MCP Tunnel compatibility required. |
| A10 symlink/reparse containment | IMPLEMENTED | Restricted paths canonicalize existing/nearest ancestors; link escapes are rejected. |
| A11 unsafe copy/move | IMPLEMENTED | Same/ancestor/descendant rejected before mutation; copy-stage + recoverable destination swap; move preserves source until destination commit. |
| A12 path lock hierarchy | IMPLEMENTED | Canonical parent/child overlap locks; siblings can proceed independently. |
| A13 installer policy overwrite | IMPLEMENTED | Shared atomic policy merge, explicit Standard/Power/GUI transitions, unrelated field preservation and config backups. |
| A14 floating release source | IMPLEMENTED-CANDIDATE | Exact ref detached checkout + optional expected commit; Release builder stamps exact accepted commit into both installers. |
| A15 profile/credential staging | IMPLEMENTED | Strict profile identity; TunnelId/health conflicts rejected; new credentials commit only after validation on Windows/Linux. |
| A16 supervisor ownership | IMPLEMENTED | Pinned tunnel executable hash manifest, root/profile/process identity, readiness checks and scoped stop paths on Windows/Linux. |
| A17 incompatible GUI branches | DECIDED | Audited lease/frame contract is release authority; research branch is historical only. |
| A18 weak tests | PARTIAL-ACCEPTANCE | Behavioral GUI/HTTP/filesystem/config gates + native no-input gate + direct native E2E + full MCP disposable runner. Exact RC execution still required. |
| A19 audit/privacy scope | IMPROVED | Secret scan false positives fixed; screenshots/results remain outside normal audit logs; authorization/tenant review remains a trust boundary. |
| A20 release consistency/privacy | IMPLEMENTED-CANDIDATE | Tracked-files-only Plugin ZIP, exact-commit stamped installers, manifest/SHA256, independent verifier and evidence-gated release builder. Actual Release still must be built/verified from accepted commit. |

## Filesystem and recovery model

Restricted Power filesystem operations canonicalize paths before access and before lock acquisition. Mutating locks conflict when one path is an ancestor/descendant of another.

Copy/move:

- reject identical, source-contains-destination and destination-contains-source relationships;
- stage a full copy beside the destination;
- back up/displace an existing destination before commit;
- rollback destination displacement when commit fails;
- move removes the source only **after** destination commit;
- if source cleanup fails, both copies are retained and `moveIncomplete:true` is returned;
- recoverable delete/move refuses a target that contains its configured backup store.

Full Power Mode remains privileged and is not an OS sandbox.

## Install/update/runtime identity

Windows and Linux installers now:

- refuse dirty tracked/staged application source instead of overwriting it;
- resolve an explicit tag/branch/commit and checkout that exact commit detached;
- support expected-commit verification;
- verify the official OpenAI tunnel-client release archive SHA-256;
- derive and pin the extracted tunnel executable SHA-256 in `tools/tunnel-client.active.json`;
- preserve existing local policy when no explicit mode transition is requested;
- perform explicit Standard/Power/GUI transitions through the same atomic config merge helper;
- preserve unrelated local policy fields;
- back up explicit policy transitions;
- write runtime state with source commit, instance ID and config hash;
- refuse to stop a different instance occupying the MCP port.

The server exposes deterministic `instanceId` and `configSha256` in health/status so supervisors and installers can distinguish stale policy from another installation.

## Multi-account tunnel ownership

Windows and Linux:

- strict profile name grammar (no path/sanitize aliases);
- one profile -> one exact credential path;
- existing TunnelId / HealthPort conflicts fail closed;
- new Runtime API key is staged in memory and saved only after tunnel init/doctor validation;
- supervisor uses the exact hash-pinned tunnel executable;
- process matching includes executable + profile + managed root;
- `/readyz` is checked, and a persistently not-ready owned process is restarted;
- additional-account connectors delegate to persistent enrollment instead of launching duplicate foreground tunnels.

Different tunnels still reach the same local MCP policy unless separate OS/MCP instances are deliberately configured.

## Release packaging

`tools/build-release.ps1` requires:

1. clean exact HEAD;
2. local interactive RC acceptance summary matching that HEAD;
3. real ChatGPT/Tunnel acceptance summary matching that HEAD;
4. fresh `npm run check`, `npm test`, `npm run audit`.

It then:

- stamps the exact accepted commit into Windows/Linux Release installers;
- packages the Plugin **only from `git ls-files plugin-template`**, excluding gitignored private `.app.json`;
- creates stable + versioned Plugin ZIPs;
- creates `RELEASE_MANIFEST.json` and `SHA256SUMS.txt`;
- runs `tools/verify-release.ps1` before reporting `RELEASE_BUILD_PASS`.

## Acceptance tooling

- `test/gui-native.ps1`: no-input PowerShell/C# parser/layout/key-map gate.
- `npm run test:gui-native`: optional direct native WinForms developer E2E.
- `test/rc1-acceptance.ps1`: exact detached-worktree acceptance. No-input phase runs branch diff/check/test/audit. Interactive phase starts an isolated high-port MCP and a disposable Windows Form, then tests actual MCP screenshot/focus/click/Unicode/key/drag/frame-replay/GUI_STOP behavior and saves screenshot hashes.
- `docs/GUI_ACCEPTANCE.md`: human procedure and real Tunnel/ChatGPT gates.

## Remaining blockers before FINAL

No source-only review closes these gates:

1. Run exact squashed RC HEAD through `test/rc1-acceptance.ps1` no-input phase on Windows.
2. Run its explicitly authorized interactive disposable GUI phase and retain screenshots/state/logs.
3. Record DPI/monitor topology and negative focus/locked-desktop/stop evidence.
4. Install/update the **same accepted commit** in a controlled maintenance step while preserving credential hashes.
5. Refresh/Scan the real ChatGPT Custom App and verify actual MCP image rendering.
6. Perform one controlled real ChatGPT GUI input using lease+frame and confirm with a fresh rendered screenshot.
7. Verify second-account GUI lease contention and correct device identity.
8. Verify both tunnels recover and credentials remain unchanged.
9. Create structured remote acceptance JSON for that exact commit.
10. Build/verify Release assets, then and only then promote/tag/publish.

## Release rule

Do not call v0.5.0 FINAL because code exists, a tool scans, a process starts, or an input API reports submitted. FINAL requires visible result evidence through the exact accepted artifact and real ChatGPT/Tunnel path.
