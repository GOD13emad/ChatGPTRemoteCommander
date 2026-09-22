# Changelog

## 0.8.24 — 2026-09-22

- Make GNOME/Wayland GUI extension updates session-safe: byte-identical extension trees are no longer replaced.
- When extension bytes really change, disable the active extension before atomic replacement, then re-enable it; recover enabled-but-inactive state with one bounded disable/enable cycle and bridge polling.
- Keep the no-logout/no-reboot/no-desktop-takeover invariant while allowing the GUI D-Bus bridge to become active in the current GNOME 46 session when possible.
- Ignore runtime `/var/` state/log output so the control checkout remains clean without deleting operational logs.
- Preserve v0.8.23 published-release authority and all earlier route, persistent-terminal, GUI-policy and cleanup protections.

## 0.8.23 — 2026-09-22

- Correct stable-channel discovery: ordinary Git tags are no longer treated as releases.
- Prefer GitHub's documented `/releases/latest` web redirect on both Linux and Windows, with the Releases REST endpoint as fallback.
- Fail closed if published-release discovery is unavailable; never fall back to the highest raw semantic-version tag.
- Preserve v0.8.22 route/drain barriers and all prior GUI, persistent-terminal and updater safety controls.

## 0.8.22 — 2026-09-22

- Prevent nested blue/green generations from overwriting an unresolved `route.previous`. Windows and Linux now attempt to finish the existing drain after candidate validation but before any new route mutation; unresolved drains stop the candidate with `BLOCKED_EXISTING_DRAIN` / `AUTO_UPDATE_EXISTING_DRAIN_BLOCK`.
- Complete Windows deferred-drain terminal safety: `Complete-DeferredDrains` checks persistent-terminal descendants before every direct old-backend stop path, including zero-inflight/cancellable maintenance.
- Enforce the invariant inside `tools/router-switch.mjs`: any switch with an existing `current.previous` fails closed with `ROUTER_PREVIOUS_NOT_DRAINED`, so a future caller cannot silently overwrite older route authority.
- Add a functional router regression proving rejected nested switches leave generation, active and previous state unchanged, plus Windows/Linux ordering regressions around existing-drain admission.
- Preserve all v0.8.21 Linux GNOME/Wayland GUI and zero-interference controls, v0.8.20 persistent-terminal admission, and v0.8.19 cleanup-only/no-recycle protection.

## 0.8.21 — 2026-09-22

- Add guarded native GUI control for Linux GNOME 46 / Wayland through a local GNOME Shell extension plus bounded helper, while preserving the existing exclusive lease, fresh single-use frame and explicit-current-user takeover boundary.
- Make zero-interference machine-readable and migration-stable: observe-only by default, background/headless preferred, foreground mutation forbidden without an explicit current request, and durable workflows unable to acquire GUI takeover.
- Recheck foreground window and monitor geometry immediately before Linux native input, honor local GUI stop files, and authenticate the per-user Shell bridge with a mode-0600 token.
- Install and synchronize the Linux GUI extension through fresh install and candidate-first update paths without forcing logout, GNOME restart or reboot. GNOME 46 may require the next normal desktop session before a newly introduced local extension becomes active; gui_status remains fail-closed until then.
- Prefer Git repository tags for Linux stable-version discovery, using the GitHub Releases API only as fallback, reducing exposure to API rate-limit/403/timeout failures.
- Clarify durable scheduler semantics: automatic recovery/reconciliation/readiness remains enabled, while automaticExecution=false and runnerConfigured=false truthfully state that Remote Commander is an execution/control plane rather than a duplicate model runtime.
- Preserve v0.8.20 persistent-terminal cutover/drain protection and v0.8.19 cleanup-only/no-recycle behavior unchanged while adding GUI backend synchronization to control-code maintenance and final promotion.
- Add Linux GUI contract/packaging/parser regression, zero-interference migration/status regression and stress evidence separating local MCP latency from external connector latency and decision quality.

## 0.8.20 — 2026-09-21

- Prevent automatic cutover while the currently active backend owns any persistent interactive terminal. Candidate validation can complete, but candidates are stopped before route mutation and the updater records `BLOCKED_PERSISTENT_TERMINALS` / `AUTO_UPDATE_PERSISTENT_TERMINAL_BLOCK`.
- Protect already-draining previous backends on both Windows and Linux: a live persistent terminal now emits `DRAIN_PERSISTENT_TERMINAL_DEFER` before any old-backend stop path, including the zero-inflight path.
- Detect only the interactive shells created by Remote Commander `start_terminal` (`pwsh -NoLogo -NoProfile` on Windows and shell `--noprofile --norc` on Linux), avoiding false positives from ordinary non-interactive updater/run-shell children.
- Align terminal-session upgrade behavior with established session-drain designs: keep the endpoint/session owner alive or defer cutover rather than orphaning an interactive session. A full terminal broker/reconnect architecture is intentionally deferred because the smaller admission/drain guard achieves the required safety outcome with much less new complexity.
- Carry forward v0.8.19 cleanup-only/no-recycle protection and all prior candidate-first, ownership, GUI non-interference, durable-workflow and rollback controls.

## 0.8.19 — 2026-09-21

- Break a confirmed Windows auto-update maintenance feedback loop: stale superseded-release cleanup is now independent of supervisor recycle, so a locked old release can no longer restart a healthy supervisor every scheduler cycle.
- Supervisor recycle is now reserved for actual control-code promotion. Cleanup-only maintenance records explicit `RELEASE_CLEANUP_PASS`, `RELEASE_CLEANUP_DEFER`, and `AUTO_UPDATE_CLEANUP_PENDING` evidence without disrupting a healthy tunnel/backend.
- Make Windows release cleanup observable and fail-closed instead of silently swallowing locked-directory deletion failures; cleanup-pending state is persisted in the updater receipt.
- Apply the same cleanup-only/no-recycle separation to Linux maintenance to prevent the equivalent self-restart feedback loop.
- Add contract regression that cleanup-only paths on both platforms must not contain supervisor recycle.
- Live behavioral regressions on Windows proved both cases: removable stale release cleanup preserved the same supervisor PID; an intentionally locked stale release produced `AUTO_UPDATE_CLEANUP_PENDING` while the same supervisor PID remained alive and no recycle event was emitted.
- Production cleanup retired ownership-proven orphan backends from v0.8.9, v0.8.10 and v0.8.11 only after proving they were unrouted, idle, connection-free and without unsafe descendants. Subsequent scheduled update checks remained `AUTO_UPDATE_CURRENT`.

## 0.8.18 — 2026-09-21

- Fix Windows updater child-process stdio inheritance: staged long-lived backends are now launched with detached `Start-Process` semantics rather than inheriting the MCP `run_shell` stdout/stderr pipe. A behavioral regression proves the updater parent can observe EOF and exit while the child remains alive.
- Replace version-gated legacy drain recovery with evidence-gated stale-drain recovery. Cleanup requires zero backend active operations/queue, no unexpected TCP peer beyond the canonical router, no persistent-terminal/other unsafe descendant, GUI not busy/leased, ownership identity, and an immediate second evidence check before stop.
- Persistent terminal processes are never auto-classified as idle-safe. This prevents an updater from terminating a completed-but-still-owned interactive project shell without explicit session closure.
- Atomically retire `route.previous` after ownership-proven drain/cleanup on Windows and Linux using generation/profile/port/commit preconditions, preventing stale previous-route metadata from surviving maintenance.
- Fix runtime version authority drift carried by v0.8.16/v0.8.17: `src/server-v0.3.mjs` now reports the same version as package/plugin metadata, and onboarding regression requires equality.
- Preserve all v0.8.17 Linux updater-lock descriptor protections, v0.8.16 Linux lifecycle hardening, and v0.8.15 Windows test-transport stabilization.

## 0.8.17 — 2026-09-21

- Fix a confirmed Linux updater-lock inheritance defect: long-lived promoted backend and stable-router processes now explicitly close updater lock file descriptor 9 before exec, so the first successful cutover cannot permanently block every later update with `AUTO_UPDATE_ALREADY_RUNNING`.
- Add updater contract regressions requiring both long-lived Linux processes to close the inherited lock descriptor.
- This successor release preserves all v0.8.16 Linux lifecycle/package hardening and exists because v0.8.16 was already published immutably before live post-promotion evidence exposed the inherited-lock root cause.

## 0.8.16 — 2026-09-21

- Fix Linux systemd/crontab supervisor runtime discovery by prepending the installer-managed portable Node runtime before any routed recovery or automatic-update work; generated systemd user units also persist that PATH explicitly.
- Preserve executable mode in Git/release metadata for all Linux lifecycle scripts instead of relying on post-checkout chmod. This prevents the installer from manufacturing tracked mode-only dirtiness that can block control-checkout promotion with `control tracked dirty`.
- Extend Linux disable lifecycle cleanup to ownership-validate and stop routed backend/router processes, not only direct control-checkout servers and tunnel processes.
- Restore bounded connect/total timeout policy for the tunnel-client binary download by routing the asset fetch through the shared `curl_fetch` helper.
- Add source-integrity regressions for Linux executable modes, portable-runtime bootstrapping, routed cleanup markers, and bounded tunnel-client download.
- Make systemd supervisor recycle self-safe: post-cutover cleanup and durable PASS logging complete before an asynchronous `systemctl --user restart --no-block`, avoiding self-termination of the updater inside the service control group.
- Live Ubuntu audit that motivated this patch: v0.8.13 runtime/tunnel were healthy, but the systemd user supervisor PATH omitted the portable Node directory and no scheduled auto-update launch was recorded despite `autoUpdate.enabled=true`; the source authority was already v0.8.15.
- Retain v0.8.15 test-transport stabilization and all v0.8.13 supervisor continuity/no-live-work-recycle protections.

## 0.8.15 — 2026-09-21

- Fix a nondeterministic release/installer test-harness failure caused by Node Fetch blocked-port policy. The stable-router tests previously chose any OS-assigned free port and then accessed the router through `fetch`; valid TCP ports such as 5060 can be rejected as unsafe by Fetch before the request reaches the local router.
- Replace local router test traffic with `node:http` requests, matching the transport under test and removing browser-style blocked-port behavior from the harness. Product/router runtime code is unchanged by this fix.
- Add repeated focused validation: the stable-router suite passed 10 consecutive runs after the harness correction.
- Supersede the unpublished v0.8.14 candidate tag; no v0.8.14 GitHub release was published. All v0.8.14 candidate-cleanup/installer hardening is carried forward unchanged.
- Retain v0.8.13 supervisor continuity, v0.8.12 monotonic updates, v0.8.11 response-drain accounting and v0.8.10 zero-interference desktop authority.

## 0.8.14 — 2026-09-21

- Fix pre-cutover candidate leakage on Windows and Linux. Every spawned candidate is ownership-tracked immediately, and validation failures clean only the exact owned candidate before returning failure.
- Remove unattended Windows candidate dependence on the shared interactive `gui_status` helper. Update validation now uses the native no-input self-test plus candidate `system_status` GUI backend/policy fields, avoiding `GUI_NATIVE_BUSY` contention without taking desktop control.
- Preserve v0.8.13 supervisor continuity hardening: busy routed backends and healthy canonical routers remain protected from transient health/source-drift recycling.
- Add updater-contract regression coverage for immediate candidate tracking, ownership-safe failure cleanup, shared-GUI-helper independence, and Linux validation cleanup traps.
- Ship a release-specific installer bundle with pinned Windows/Linux installers, Work-plugin installers, setup documents and SHA-256 manifest; fresh-install acceptance is performed in an isolated install directory before publication.
- Retain v0.8.12 monotonic no-downgrade updates, v0.8.11 response-drain accounting and v0.8.10 zero-interference desktop authority.

## 0.8.13 — 2026-09-21

- Harden active routed-backend recovery after live evidence showed that one transient two-second health miss could force-stop a busy backend and trigger a burst of multi-chat HTTP 502 failures.
- Require three consecutive backend health misses, readable canonical-router activity, zero in-flight work, and a final health/activity re-check immediately before any ownership-proven backend recycle.
- Defer recovery whenever router activity is unavailable or work is still in flight; unknown or mutating work is never killed merely because liveness probes missed.
- Preserve a healthy canonical router when only its loaded source hash is stale; source activation is deferred and logged instead of intentionally creating an update-time canonical-listener gap.
- Apply the no-live-source-recycle policy to both Windows and Linux supervisors and add a behavioral Windows regression proving busy-backend and healthy-router guards cannot be bypassed.
- Retain v0.8.12 monotonic no-downgrade updates, v0.8.11 downstream-disconnect drain accounting, v0.8.10 zero-interference desktop authority, Full Power persistence and no-blind-replay semantics unchanged.

## 0.8.12 — 2026-09-21

- Make stable-channel automatic updates monotonic on Windows and Linux: when the installed active version is newer than the latest stable release, unattended update exits with `AUTO_UPDATE_NEWER_CURRENT` instead of downgrading.
- Preserve explicit operator control: `-Force`/`--force` continues to permit deliberate exact-ref downgrade/testing when requested.
- Add Windows/Linux updater-contract regressions requiring the downgrade guard to execute before candidate gates or route cutover.
- Correct release sequencing for this project: publish and verify the immutable stable release before live promotion so the scheduled stable updater and manual promotion share the same authority.
- Retain the v0.8.11 router disconnect-drain fix and v0.8.10 zero-interference desktop authority unchanged.

## 0.8.11 — 2026-09-21

- Fix stable-router drain accounting when the downstream MCP client disconnects before a completed upstream response is fully consumed. The router now detaches the closed downstream response and continues consuming the backend response to its real end/close event instead of leaving a permanent inflight entry.
- Preserve mutation safety: downstream disconnect does **not** cancel or retry the upstream request. The old backend is considered drainable only after the upstream response actually completes or closes.
- Add a deterministic regression that reproduced the production failure before the fix (`inflight=1` after client disconnect) and passes after the fix.
- Record and recover the v0.8.10 production incident with ownership-proven shutdown of the superseded backend only after its audit showed `run_shell ok=true`, no non-console child workload remained, and the route/runtime marker/PID/port/profile all matched.
- Retain all v0.8.10 zero-interference desktop controls unchanged.

## 0.8.10 — 2026-09-21

- Add a zero-interference GUI session boundary: `gui_session_begin` defaults to observe-only, while mouse/keyboard/scroll/focus mutations require an explicit `takeover` session with a current-user authorization basis.
- Enforce takeover mode in the MCP controller before consuming a frame or invoking native input, so Full Power alone cannot seize the user's pointer or foreground application.
- Prevent durable/resumed workflows from acquiring takeover mode or dispatching GUI mutations; interactive desktop input is direct-session-only so stale workflow memory cannot become authorization.
- Update Plugin, Work, setup, security and GUI-acceptance contracts to prefer shell/filesystem/API/headless/background paths unless the current user explicitly requests desktop interaction.
- Add regressions proving observe-only sessions can inspect the desktop but reject native mutation, and that takeover mode remains guarded by the existing lease/fresh-frame/uncertain-outcome protections.
- Keep unattended updates strictly no-input; interactive GUI E2E remains a separately authorized disposable-release gate.

## 0.8.9 — 2026-09-21

- Replace the unattended Windows updater's interactive GUI E2E gate with the existing native no-input self-test, preventing scheduled updates from stealing desktop focus or failing because Windows denies background foreground activation.
- Keep real focus/click/Farsi+Japanese typing/button/screenshot/cursor/foreground GUI E2E as a mandatory release-validation gate on the exact clean release commit.
- Keep candidate hardware validation of the GUI backend through candidate MCP `gui_status`, so the target machine must still prove the native backend is available before promotion.
- Preserve v0.8.8 router loaded-source SHA binding and ownership-proven stale-router recycle, plus v0.8.7 persistent GUI latency and conservative drain handling.
- Add updater-contract regression proving interactive `test:gui-native` is not invoked by unattended candidate updates.

## 0.8.8 — 2026-09-21

- Bind every running stable router to a SHA-256 of the exact `stable-router.mjs` source loaded by that process and expose the digest through router status/runtime state.
- Make Windows and Linux supervisors require the running router source digest to match the authoritative promoted checkout; stale or pre-hash routers are recycled automatically.
- Keep router recycle ownership-proven through runtime marker, canonical port/state-file identity and process identity checks; unknown canonical listeners remain fail-closed.
- Preserve v0.8.7 GUI latency improvements, conservative post-cutover drain handling, Full Power capability persistence, durable workflow recovery and immutable release policy.
- Add regression coverage for loaded-source hash binding and supervisor source-drift recycle contracts on both Windows and Linux.

## 0.8.7 — 2026-09-21

- Replace per-GUI-call PowerShell startup and C# recompilation with a bounded, lazily started persistent helper using newline-delimited JSON over existing child-process pipes; keep the one-shot helper path for compatibility and regression.
- Preserve all GUI safety invariants: single desktop lease, fresh single-use frame, foreground/geometry validation, local emergency stop, global native mutex, bounded output/timeouts, and uncertain-mutation suspension with no blind replay.
- On the validated Windows target, reduce warm GUI status from ~1.78 s to ~16 ms median, controller window listing to ~37 ms median, and common 1000 px screenshot reads to ~87 ms median.
- Add conservative router in-flight metadata without retaining request arguments, classify only known long-lived transport requests as cancellable, and expose JSON drain details while preserving the old numeric router-status interface.
- Change Windows/Linux post-cutover drain handling so unknown or mutating long-running work is deferred rather than force-killed; promote control state, preserve compatible old release/schema state, and complete cleanup automatically when the old request ends.
- Keep GitHub immutable-release policy and full-SHA/least-privilege Actions hardening from v0.8.6.

## 0.8.6 — 2026-09-20

- Make workflow checkpoints atomically synchronize WAITING lifecycle, scheduler enablement and next-run projection in the same SQLite transaction, closing the observed workflow snapshot/scheduler divergence.
- Add regression coverage that requires checkpointed workflows to report WAITING consistently while preserving automatic continuation when enabled.
- Harden GitHub Actions with explicit read-only contents permission and full commit-SHA pins for checkout/setup-node instead of floating major-version tags.
- Prepare publication under GitHub immutable-releases policy so the next published release tag and assets cannot be changed after publication.
- Preserve direct local-validated GitHub Release publication while the account-level hosted-Actions billing lock remains an external GitHub Support gate.

## 0.8.5 — 2026-09-20

- Make profile-instance test fixtures platform-native so the release gate uses Windows absolute paths on Windows and POSIX absolute paths on Linux instead of feeding Windows-only fixture paths to the Linux local-path guard.
- Preserve the production fail-closed local-path validator unchanged; this is a release-gate portability fix, not a relaxation of filesystem authority.
- Reproduce the GitHub Ubuntu job locally on Ubuntu 24.04 with Node 22 and verify `npm run check`, `npm test`, and `npm run audit` all pass.
- GitHub-hosted CI remains externally blocked from starting while the repository owner's GitHub account reports a billing lock; jobs receive no runner and execute zero steps.

## 0.8.4 — 2026-09-20

- Fix Windows updater target discovery so only immediate profile directories are considered; historical `instance.json` files inside profile backup trees can no longer be mistaken for live profiles.
- Fail closed when a direct profile directory name disagrees with the profile recorded in its `instance.json`.
- Add regression coverage that forbids recursive instance discovery. This closes the v0.8.3 `-NoPromote` cleanup failure where archived `saeed-emad` records produced duplicate candidates and an ownership mismatch before any route cutover.
- v0.8.3 was published but is superseded by this hotfix before production promotion; live v0.7.3 remained authoritative throughout discovery.

## 0.8.3 — 2026-09-20

- Make native Windows GUI E2E self-contained in clean Git checkouts by creating its ignored runtime `var` directory before launching the fixture app.
- Make `-NoPromote` candidate validation ownership-safe and self-cleaning so diagnostic backends cannot remain running after a successful dry run.
- Harden tunnel-ID history scanning to the canonical lowercase `tunnel_` prefix and add a regression that rejects uppercase status/error symbols as credential false positives.
- v0.8.2 was intentionally not tagged or released after the clean detached-worktree gate exposed the GUI test-harness directory assumption.

## 0.8.2 — 2026-09-20

- Include the tracked `tools/build-candidate-config.mjs` runtime helper required by clean staged automatic updates.
- Harden `test/source-integrity.mjs` so lifecycle/updater runtime dependencies must be Git-tracked, preventing untracked working-tree helpers from making local gates pass while clean release checkouts fail.
- Includes the v0.8.1 Windows gate-argument fix; v0.8.1 was intentionally not tagged or released after clean-stage validation exposed the missing tracked helper.

## 0.8.1 — 2026-09-20

- Fix Windows auto-update gate execution: the helper parameter named `Args` collided with PowerShell's automatic `$args` variable, causing staged `npm run check` to launch npm without arguments and fail closed before cutover.
- Add an explicit missing-gate-arguments guard so the updater cannot silently treat an empty gate command as valid.
- Preserve the v0.8.0 candidate-first safety behavior: the failed updater never reached cutover, so live v0.7.3 production remained unchanged during discovery of this defect.

## 0.8.0 — 2026-09-20

- Capability Profile v2: explicit Full Power enables every known capability by default and automatically adopts new capabilities on later upgrades; only persistent explicit opt-outs keep individual capabilities disabled.
- Full Power durable orchestration now covers the complete filesystem, shell, process, persistent-terminal and GUI surface while preserving intent-before-effect journaling, operation classification, reconciliation and no blind mutation replay.
- Durable Workflows R2 adds scheduler state, operation receipts, idempotency keys, one-writer project-root leases, crash recovery, retry/root-cause budgets, user revision overrides, execution-profile persistence, Project Brain synchronization and evidence-backed FINAL completion.
- Candidate validation uses a consistent shadow workflow database; live schema finalization occurs only after verified cutover, preserving rollback compatibility before the commit point.
- Candidate-first automatic updates on Windows and Linux stage releases side-by-side, run repository/security/hardware diagnostics before promotion, and leave the active installation untouched when validation fails.
- Stable loopback routing provides generation-guarded atomic cutover, drains in-flight work on the previous backend, and removes superseded backends/releases after successful drain.
- Post-commit maintenance recovery and supervisor recycle keep the promoted runtime authoritative without requiring logout or reboot.
- Stable-channel automatic update checks are enabled by default. Full Power includes automatic and zero-downtime lifecycle capabilities unless explicitly opted out.
- Linux receives parity for candidate-first install/update, shadow workflow validation, hardware self-test, route recovery and scheduled automatic update checks.
- Cross-platform release contracts now cover all-on Full Power, persistent opt-outs, router safety, workflow crash/reconcile behavior, Linux shell parsing and native Windows GUI E2E.

## 0.7.3 — 2026-09-19

- Sanitize `REMOTE_COMMANDER_CONFIG` at Windows supervisor startup. A supervisor launched from an isolated MCP context can no longer inherit that profile config into primary MCP startup.
- Keep isolated MCP launch explicit through `ProcessStartInfo.Environment[REMOTE_COMMANDER_CONFIG]`; primary and per-profile configuration selection are now unambiguous.
- Add regression coverage to the profile-reconfiguration contract after reproducing the live primary-port timeout caused by inherited environment state.
- When an isolated profile explicitly enables Power + GUI, durable workflows can journal the bounded power/file and GUI tool subset (including fresh-frame GUI actions) while shell, delete, process-kill and terminal control remain excluded from durable replay.


## 0.7.2 — 2026-09-19

- Add transactional reconfiguration for existing isolated profiles without changing Tunnel ID, DPAPI credential, MCP port, runtime marker path, or durable workflow store.
- Add ownership-proven isolated MCP recycle: supervisor may stop a mismatched listener only when runtime marker PID/port/profile/projectDir prove it owns that exact process; unknown listeners remain fail-closed.
- Add a Windows reconfiguration wrapper with bounded health verification and backup rollback when the new instance does not come healthy.
- Keep permanent delete disabled; Power Mode and GUI remain explicit opt-ins per isolated profile.


## 0.7.1 — 2026-09-19

- Security hardening for isolated Standard profiles: command execution allowlist is empty by default, so general-purpose interpreters/compilers cannot escape project-path policy.
- Remove `run_project_command` from the default durable workflow execution set for Standard isolated profiles. Explicit isolated Power Mode may opt back into the base command allowlist.
- Keep per-profile memory, runtime markers and tunnel routing unchanged; no credential or Tunnel ID rotation is required.


## 0.7.0 — 2026-09-19

- Add opt-in durable project workflows with crash-safe intent/receipt journaling, checkpoint evidence hashes, resume/reconcile semantics and logical export.
- Add per-profile local MCP isolation so additional ChatGPT accounts can use distinct ports, configs, audit logs, runtime markers and private workflow databases.
- Add transactional Windows profile migration that reuses the existing tunnel ID and DPAPI Runtime API credential, validates a candidate MCP with tunnel-client doctor, and rolls back the profile on failure.
- Keep isolated secondary profiles conservative by default: Standard Mode, no shell/process/GUI/full-filesystem access unless explicitly opted in.
- Integrate workflow/profile recovery tests into standard release gates.


## 0.6.5 — 2026-09-19

- Fail closed when `expectedSha256` is malformed or targets a missing file; no parent/file creation occurs on a failed precondition.
- Preserve the complete promoted destination and recovery metadata when a move source deletion partially fails; never delete the last complete copy to restore an overwritten target.
- Add focused recovery regressions for Standard and Power Mode writes/moves.


## 0.6.4 — 2026-09-19

- Bounded Linux external downloads with explicit connect and total timeouts so unavailable TLS/network paths fail deterministically instead of hanging indefinitely.
- Applied the same bounded-download policy to the Linux Work Plugin template fetch and bounded the Linux account connector's local MCP health probe.
- Added regression contracts so release checks fail if the timeout controls are removed.
- Reproduced the original failure on WSL2: DNS resolved `nodejs.org` but TLS connection attempts timed out while the old installer waited without a deadline.
- Retains v0.6.3 read-only doctor diagnostics and isolated concurrency testing, plus all v0.6.2 runtime/tunnel/GUI hardening.

## 0.6.3 — 2026-09-19

- Isolated the concurrency smoke server inside a disposable application copy so tests never write, restore, or race with the live `var/mcp-runtime.json` ownership marker.
- Added a hard regression asserting the live ownership-marker SHA-256 is unchanged by the concurrency gate.
- Added a loopback-only read-only `npm run doctor` diagnostic for health, active server version/device, core tool discovery, optional config SHA-256 comparison, and drift detection.
- Added doctor regression coverage for healthy state, version drift, missing core tools, URL-secret rejection, remote-host rejection, and timeout/argument validation.
- Re-ran the full Windows release gate including MCP conformance, audit rotation, filesystem safety, 67/67 GUI contract tests, security audit, and native Windows screenshot/input/focus E2E.

## 0.6.2 — 2026-09-19

- Fixed Windows tunnel profile path ambiguity by passing the repository-managed profile directory explicitly to tunnel-client init, doctor, and run.
- Windows enrollment now recognizes an already-ready tunnel-client process for the same profile during an installation handoff, even when that process belongs to the previous installation path.
- Preserves the existing `%APPDATA%\\tunnel-client` profile store; no profile migration or secret rewrite is required.
- Prevents false doctor failures during in-place production promotion when the previous healthy tunnel already owns the profile health port.
- Added Windows runtime-contract gates for explicit profile-dir binding and upgrade-ready profile detection.

## 0.6.1 — 2026-09-19

- Fixed exact release identity checks for annotated Git tags by peeling fetched refs to their commit before ExpectedCommit comparison.
- Added Linux parity for exact expected-commit verification through `--expected-commit` / `REMOTE_COMMANDER_EXPECTED_COMMIT`.
- Made fresh source acquisition transactional: failed Windows installs remove incomplete fresh checkouts; Linux stages into a temporary checkout and only moves it into place after fetch, peel, expected-commit verification, and checkout succeed.
- Detects existing incomplete Git installations with no HEAD instead of treating them as valid update targets.
- Added a regression using a real annotated Git tag to prove raw `FETCH_HEAD` differs from the release commit while `FETCH_HEAD^{commit}` resolves exactly to it.
- Reproduced and closed the v0.6.0 clean-production installer failure; positive clean install and negative wrong-ExpectedCommit cleanup both PASS.

## 0.6.0 — 2026-09-19

- Completed real dual-era MCP conformance for legacy 2025 clients and MCP `2026-07-28` stateless clients.
- Added required modern `tools/list` cache hints, strict modern header/body version classification, `Mcp-Method`/`Mcp-Name` routing validation, and modern rejection of the removed `notifications/initialized` lifecycle.
- Added centralized closed-schema tool-input validation. Known-tool validation/handler failures now return normal MCP tool results with `isError: true`; unknown tools remain JSON-RPC protocol errors.
- Hardened tool risk annotations so potentially overwriting/destructive file/process/shell operations are conservatively marked destructive/open-world where applicable.
- Added a dependency-free MCP conformance gate and independently validated the candidate with the official `@modelcontextprotocol/client@2.0.0` in legacy, modern-auto, and modern-pinned modes.
- Added serialized bounded audit logging with an 8 MiB default segment limit and three retained rotated generations; concurrent-rotation regression verifies parseable, non-duplicated JSONL.
- Revalidated the existing Power Mode full-filesystem compatibility, concurrency, filesystem safety, runtime ownership, HTTP admission, secret scan, Windows GUI contract, and native screenshot/input/screenshot E2E.
- Kept OpenAI `tunnel-client v0.0.14` pinned after current-release verification; it remains the published rollout target for MCP 2026-07-28/sessionless tunnel traffic.

## 0.5.2 — 2026-09-19

- Restored full-filesystem compatibility for the five legacy MCP tools when explicit Power Mode has `fullFilesystem=true`. `list_directory`, `read_text`, `write_text`, and `run_project_command` can now use absolute paths outside configured `allowedRoots` subject to OS permissions and the existing policy.
- Kept command hardening intact: `run_project_command` remains executable-allowlisted, while `python -c` and Node eval/print modes remain blocked.
- Power-mode legacy writes outside configured roots now use the configured Power Mode backup root instead of creating repository-style backup directories beside the target.
- Added explicit effective-access signaling to `system_status`: `allowedRootsEnforced`, `effectiveAccess.filesystem`, and `legacyFiveToolCompatibility`.
- Updated MCP tool descriptions and server instructions so clients do not misinterpret configured roots as an active boundary while full-filesystem Power Mode is enabled.
- Added regression coverage for legacy read/write/list/command access outside configured roots plus HTTP/MCP metadata/instruction consistency.

## 0.5.1 — 2026-09-19

- Fixed concurrency-test isolation so `npm test` preserves the live `var/mcp-runtime.json` ownership marker instead of leaving the temporary port-47931 test server identity behind.
- Verified the fix against a live supervised v0.5.x runtime: the runtime-state SHA-256 was identical before and after the full test suite, then controlled MCP recycle restored a self-written marker for the actual port-47831 process.
- Re-ran `npm run check`, `npm test`, `npm run audit`, and the native Windows GUI E2E gate successfully after the fix.
- Removed the obsolete public `release/v0.5.0-rc1` branch after creating a local rollback bundle; this removed stale audit-only test fixtures from reachable public branch history and restored `SECURITY_AUDIT_PASS`.
- Keeps the v0.5.0 GUI/runtime feature set and security boundaries unchanged; this is a maintenance and release-integrity patch.

## 0.5.0 — 2026-09-18

- Added opt-in Windows GUI Control for trusted Power Mode machines with MCP image screenshots, mouse move/delta/click/drag/scroll, Unicode typing, bounded key combinations, window discovery/focus, and a local emergency stop.
- Added a repeatable native Windows GUI E2E gate using a disposable WinForms target. It verifies real screenshot capture, exact-window focus, mouse click, Farsi/Japanese Unicode typing, button activation, post-action screenshot change, cursor restore, and best-effort focus restore.
- Fixed redirected PowerShell stdin/stdout to explicit UTF-8 so multilingual GUI typing is not corrupted by the host console code page; hardened focus with verified thread-input attachment and safe detach.
- Pinned release installers to `v0.5.0` by default while keeping explicit source-ref/commit overrides for controlled validation and recovery.
- Added an exclusive expiring desktop lease and short-lived single-use frame tokens. Every GUI mutation must be based on a fresh screenshot; concurrent chats cannot independently drive the same desktop.
- Added strict runtime GUI schemas, fixed native dispatch, sanitized helper errors, bounded subprocess/image output, corrected Win32 INPUT layout, DPI/foreground/desktop checks, and an uncertain-outcome latch instead of blind retries.
- Hardened loopback HTTP admission against untrusted Host/Origin/content-type requests while preserving Secure MCP Tunnel architecture.
- Hardened Power Mode containment against canonical path/symlink escapes, same/ancestor/descendant copy/move hazards, and parent/child lock races. Copy/move overwrite now stages and rolls back instead of deleting the destination first.
- Made Windows installer mode transitions real and config-aware: local policy is merged/backed up, Standard disables an existing Power policy, health exposes config identity, and same-version config changes restart the owned MCP.
- Pinned tunnel-client executable identity with recorded SHA-256, strict profile names, exact TunnelId/HealthPort reuse, post-validation credential persistence, readiness checks, and ownership-safe stop/start.
- Converted the legacy multi-account foreground connector to the persistent supervisor path.
- Public configuration remains Power/GUI disabled by default. Secure Desktop/UAC, lock screen, anti-cheat/protected input and high-speed real-time gameplay remain explicit platform limits.

## 0.4.4 — 2026-09-18

- Fixed the public Bash one-line Work Plugin installer when executed via `curl | bash -s`: `BASH_SOURCE[0]` is now expanded safely under `set -u`, eliminating the harmless but confusing unbound-variable warning.
- Kept the v0.4.3 app-identity guardrail, self-contained Release template download, private-path fixes, and exact-app verification unchanged.


## 0.4.3 — 2026-09-18

- Added an explicit app-identity guardrail for Work/Plugin binding: bind only the exact Custom App created for this project's Secure MCP Tunnel and verify its scanned tools include `system_status`.
- Documented that fuzzy Plugin Directory search results or similarly named remote-control apps must never be substituted for the intended ChatGPT Remote Commander app.
- Kept the self-contained latest-Release Work Plugin installer flow from v0.4.2 and verified its public one-line Windows path end-to-end with an isolated synthetic app identifier.
- Clarified that the optional `tunnel-client` Codex Plugin is separate from this project's Plugin and is not a FINAL PASS requirement.
- Fixed relative `-TemplateSource` and `-InstallRoot` resolution in the Windows Work Plugin installer so controlled offline/private paths resolve from the caller's current PowerShell location rather than the host process directory.


## 0.4.2 — 2026-09-18

- Made the app-bound Work Plugin installers self-contained when executed directly from a Release asset or in-memory PowerShell.
- If no adjacent `plugin-template/` exists, the installers download the generic `plugin-template.zip` asset from the latest Release and clean up temporary files after installation.
- Added optional `TemplateSource` / `TEMPLATE_SOURCE` overrides for controlled offline/private deployments.
- Added public one-line Windows and Linux Work Plugin installation commands that need only the registered app technical ID.
- Release packaging now publishes both stable `plugin-template.zip` and versioned `plugin-template-v0.4.2.zip` assets.


## 0.4.1 — 2026-09-18

- Added one-command app-bound Work Plugin installers for Windows and Linux.
- The installers accept either a real app ID (`asdk_app_`, `connector_`, `templated_apps_`) or the corresponding ChatGPT technical `plugin_...` identifier and normalize it correctly.
- They create a private per-user Plugin copy, generate `.app.json`, add a personal marketplace, install/enable the Plugin through Codex, and verify the app binding.
- Added explicit current OpenAI guidance that `.app.json` uses the underlying app ID, not the `plugin_...` wrapper shown in Plugin URLs.
- Documented the optional tunnel-client Codex Plugin as non-blocking; the Remote Commander Plugin is the required project integration.


## 0.4.0 — 2026-09-18

- Added `START_HERE.md` as the single source of truth for AI-assisted installation from a GitHub link through FINAL PASS.
- Added explicit Standard versus Full/Power Mode guidance, including benefits, boundaries, plan availability, and safe secret handling.
- Added current ChatGPT custom MCP app creation steps: Developer Mode, Tunnel connection, no-auth selection, Scan Tools, creation, and real `system_status` verification.
- Added `docs/PLUGIN_SETUP.md`, `WORK_SETUP.md`, a portable Plugin template, repository marketplace, project-level Plugin enablement, app-binding helpers, workflow skill, privacy/terms documents, and ready PNG/SVG visual assets.
- Replaced outdated foreground-tunnel instructions across the 10 setup-language pages with the persistent supervisor flow and latest Release installer assets.
- Updated Windows and Linux disable scripts so stopping persistent mode also stops managed tunnel/MCP processes while preserving credentials unless explicitly removed.
- Updated Windows and Linux enrollment so Start is self-contained: when MCP is stopped, enrollment starts it automatically before restoring persistent supervision; no manual `npm start` is required.
- Bumped runtime/package version to 0.4.0.


## 0.3.4 — 2026-09-18

- Fixed Windows installer path resolution when `install.ps1` is executed from an in-memory `irm`/ScriptBlock rather than from a `.ps1` file.
- `Resolve-InstallDir` now returns the resolved path explicitly and the installer assigns it in the caller scope, avoiding PowerShell `$script:` scope differences.
- Added validation for the public one-line `irm` install/update execution path.


## 0.3.3 — 2026-09-18

- Fixed the Windows installer path collision between application source and persistent local state (`credentials` / `downloads`).
- New installs use `%LOCALAPPDATA%\\ChatGPTRemoteCommander\\app`; state remains under `%LOCALAPPDATA%\\ChatGPTRemoteCommander`.
- Existing active installations are auto-detected from the Windows logon supervisor and updated in place, preserving custom/source-repo installations.
- Legacy installs where the state root itself is a Git checkout remain supported.
- `-StartServer` now upgrades a running v0.3 MCP to the newly installed version when needed, so normal updates do not require sign-out or reboot.
- Added explicit Git ignore coverage for legacy local `credentials/` and `downloads/` directories.


## 0.3.2 — 2026-09-18

- Converted `connect-chatgpt.ps1` into a persistent-connection compatibility wrapper instead of starting a second foreground tunnel.
- Re-running the legacy connect command now delegates to the idempotent autostart enrollment flow, reuses the saved DPAPI credential, and leaves the background supervisor as the single tunnel owner.
- Prevents the common `tunnel-client run failed: -1` confusion caused by launching a duplicate tunnel for an already-managed profile.


## 0.3.1 — 2026-09-18

- Fixed Windows one-time autostart enrollment when the same tunnel profile is already running on its configured health port.
- Existing DPAPI credentials are reused on reruns, so a failed validation does not require entering the Runtime API key again.
- Enrollment now recognizes an already-ready matching tunnel and skips the conflicting `doctor` listener bind check.
- Verified persistent Windows startup registration, MCP auto-restart, and tunnel kill/restart using the DPAPI credential with no repeated Tunnel ID, port, or API-key entry.


## 0.3.0 — 2026-09-17

Cross-platform, multi-topology and zero-reentry startup release.

- Added Windows + Linux core runtime support and Linux amd64/arm64 installer paths.
- Added one account -> many computers and many accounts -> one computer deployment support.
- Added concurrent-chat stress coverage and path-scoped mutation locking.
- Added automatic tunnel health-port selection for additional accounts.
- Added Windows logon supervisor with DPAPI-protected per-profile Runtime API keys.
- Added Linux supervisor with systemd-user/crontab registration and user-only credential files.
- Added automatic MCP/tunnel restart supervision after login or transient process failure.
- Added portable direct executable execution for safe-mode project commands.
- Added Windows + Ubuntu CI matrix configuration and cross-platform security audit.
- Validated real Ubuntu/WSL Standard and Power Mode installs, including official OpenAI tunnel-client SHA-256 verification.

## 0.2.1 — 2026-09-17

- Added repeatable repository security audit (`npm run audit`) covering current tracked files and Git history.
- Added `SECURITY_AUDIT.md` with verified findings and privacy notes.
- Added click-by-click setup guides in 10 languages: English, Persian, Arabic, Turkish, Spanish, French, German, Russian, Simplified Chinese, and Japanese.
- CI now checks full Git history and runs the security audit after syntax and smoke tests.
- Added a tested one-command Windows installer with optional prerequisite installation, official tunnel-client checksum verification, Standard/Power Mode selection, local validation, and optional server startup.
- Added one-command install instructions to all 10 language guides.

## 0.2.0 — 2026-09-17

Power Mode release.

- Added explicit Power Mode with local-only `config.local.json` preference.
- Added full-filesystem file I/O, metadata, copy/move/delete, recursive search, direct PowerShell, process controls, and persistent terminal sessions.
- Public configuration remains safe-by-default with Power Mode disabled.
- Local policy can keep permanent delete disabled and blocks shutdown/restart/logoff patterns.
- Added `POWER_SMOKE_PASS` regression coverage and live v0.2 MCP E2E validation.

## 0.1.0 — 2026-09-17

Initial public release.

- Local Windows MCP server on loopback
- OpenAI Secure MCP Tunnel workflow
- `system_status`, `list_directory`, `read_text`, `write_text`, and `run_project_command`
- realpath filesystem containment
- write backup + SHA-256 precondition support
- executable allowlist and selected eval blocking
- JSONL audit logging
- legacy and modern MCP protocol support used by ChatGPT tunnel sessions
- end-to-end validation from ChatGPT UI for list/read/write/command paths
