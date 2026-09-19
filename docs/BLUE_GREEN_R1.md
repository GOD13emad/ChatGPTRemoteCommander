# Windows Blue/Green R1

This control plane keeps public tunnel ports stable while backends move between two private loopback ports. It is Windows-only and stores authority under `%LOCALAPPDATA%\ChatGPTRemoteCommander`:

- `releases/<version>-<commit12>` — immutable source made with `git archive` from the exact 40-character commit.
- `control` — stable router, supervisor, release records, logs, pinned tunnel-client copy, and `GUI_STOP`.
- `instances/<profile>` — persistent raw configuration, router pointer, slot runtime/audit/drain state.
- `evidence` — retirement evidence and hash-verified preservation of legacy untracked/ignored files.

`managed.json` deliberately separates `instances` from `tunnelProfiles`. Tunnel YAML and DPAPI credentials remain in their existing locations; their contents and Tunnel ID are never printed. The YAML and tunnel-client binary are pinned by SHA-256.

## One operator command

Run from the exact candidate Git root, supplying its current full commit and the existing legacy installation root:

```powershell
.\RUN_BLUEGREEN.ps1 -CandidateRoot (Get-Location).Path -ExpectedCommit (git rev-parse HEAD) -LegacyRoot "$env:LOCALAPPDATA\ChatGPTRemoteCommander\app"
```

For a remote/noninteractive run, add `-NonInteractive`. The launcher first makes an independent, exact detached Git checkout under `control\operations`, records its commit/tree, starts the copied runner from that checkout, and immediately returns a durable receipt path. This is `BLUE_GREEN_INSTALL_ACCEPTED`, **not PASS**: PASS requires the receipt to reach `state=succeeded` and an independent verification of the target service. The one-shot worker waits for the launcher/RPC process to exit before it starts the engine, updates heartbeat/current phase/deadline/final status, owns staging cleanup, and never depends on an installer-owned temporary path. `TimeoutSeconds` is a soft operational deadline: forward wait loops and transaction acceptance/final-PASS boundaries enforce it, while bounded safety rollback/recovery continues after the forward deadline. Even if an engine were to exit zero after the durable deadline, the worker records `ENGINE_SUCCEEDED_AFTER_DEADLINE`, returns failure, and never writes `state=succeeded`. An owned external gate that hangs inside a synchronous executable call is not force-killed; hard wall-clock enforcement for that case remains **UNPROVEN**. `-PlanOnly` and self-test remain synchronous. The interactive wrapper displays a small Persian RTL status window and refuses to close while the engine child is running.

## Gates

Before a release is eligible, the source authority must have `HEAD` equal to the requested commit and no tracked changes. The release bytes come from an exact Git archive. Check and full tests run against extracted archive bytes; the history-aware security audit runs against the exact source Git authority. Native GUI E2E runs later from the immutable release while every production profile is protected by a maintenance GUI lease and the helper is pinned to `control\GUI_STOP`. An existing or newly-created owner stop blocks the native test. A shallow repository is recorded as `UNPROVEN_SHALLOW`, never presented as a full-public-history audit.

Candidate health, runtime marker, listener PID, canonical backend identity, raw config SHA, instance/isolation policy, durable workflows, Power/GUI policy, blocked shutdown/restart/logoff rules, complete required GUI tool set, tool-count floor, workflow state, GUI coordination, terminal/mutation drain state, and doctor all fail closed. The GUI stop file is always the stable `control\GUI_STOP` path.

The supervisor validates registry authority and full managed-state paths/hashes/ports before use. Its registry command and live process must match the exact executable and tokenized `-File`, `-ManagedStatePath`, and `-IntervalSeconds` arguments. A write-through runtime marker binds PID, process start time, executable, script, managed path, interval, state, and heartbeat; bootstrap acceptance and later whole-machine health proof require a fresh `healthy` marker. A lookalike command that merely mentions the script is neither accepted nor stopped. The supervisor then ensures the exact backend, router, and tunnel—in that order. Backend release manifests use exact file-set, byte-count, and SHA-256 validation. Router health and marker identity include PID, router ID, profile, port, config SHA, and stable control directory. Tunnel readiness is accepted only when the pinned process owns the health listener.

## Bootstrap

Initial migration is explicitly labelled `legacy-bootstrap-near-zero`; it does **not** claim stateful zero downtime. The order is:

1. Stop the exact legacy supervisor so it cannot restart admission.
2. Stop exact tunnel profiles using pinned legacy/stable executable hashes.
3. Prove no active calls/mutations, GUI lease/uncertainty, unresolved workflow, or backend child terminal.
4. Stop marker/PID/port/profile/project-owned legacy backends and wait for listener release.
5. Preserve every untracked/ignored legacy file outside the old tree with byte count and SHA-256; preserve the complete local `.git` metadata (including refs/config/reflogs) without logging its contents; create and verify a `git bundle --all`; and archive tracked source at exact HEAD.
6. Reuse the atomically recorded bootstrap port/identity journal, initialize router pointers, run a one-shot supervisor preflight without registry promotion, and verify backend/router/tunnel ownership.
7. Promote registry authority and start the continuous supervisor only after those checks pass. Until this acceptance point, any failure ownership-stops the stable runtime, restores the exact old Run/BlueGreen registry state, removes reconciled pointer/config/managed artifacts, and verifies the legacy service/tunnels. After all managed health/tunnel checks pass, the bootstrap journal is atomically advanced from `prepared` to `stable-accepted` before any legacy deletion can begin.
8. Remove the old application only after an exact final source and `.git` file-set/hash recheck. Every file must have an OS-reported hardlink count of exactly one; inability to obtain that count fails closed. The legacy root and every descendant directory must have exactly the default data stream and must not be a reparse/link. File and directory alternate streams, external hardlink aliases, and identity-ambiguous paths are refused before deletion. A cleanup journal is written first, so power loss or partial deletion is resumed fail-closed before managed legacy references are removed. A restart that sees `stable-accepted` preserves and re-verifies the managed service, completes cleanup if needed, and never selects the pre-managed rollback path. The bootstrap journal is removed only after cleanup references are gone and a fresh full managed-service proof succeeds.

If failure occurs before stable acceptance, the exact tokenized legacy supervisor command is restored and newly created pointer/config/managed files—including a pointer created despite lost command output—are reconciled by current identity, deleted, and verified absent. An unknown PowerShell process that only mentions the legacy script is never force-stopped. If post-cutover cleanup fails, the service remains active and the error is explicitly `SERVICE_ACTIVE_CLEANUP_INCOMPLETE`; the cleanup journal makes the next non-plan run resume safe disposition before another update. Missing/malformed phase or managed state fails closed; `stable-accepted` is not inferred from a successful command return alone.

A gate failure or crash before managed acceptance may leave only hash-verified release/control/config artifacts or an owned private candidate. The durable bootstrap journal pins the original ports/config hashes/commit and is reused on rerun; current pointer/listener/marker identities are reconciled, owned stale runtime is stopped, registry/artifacts are rolled back, and the legacy service is proven before retry. Unknown listeners or third identities never qualify for recovery.

`LegacyRoot` must be an existing non-reparse directory below, but never equal to, the base directory. This prevents a recursive cleanup from ever targeting control, instances, releases, credentials, or evidence.

## Normal update and rollback

The updater starts and fully gates every inactive slot. It then drains **all** old profiles before switching any profile, CAS-switches and verifies all profiles, and only after whole-machine acceptance retires any old backend. The update journal is `prepared` before the first fence and becomes `accepted` before retirement; crash recovery freshly reconciles every pointer rather than trusting a missing command result.

On pre-acceptance failure, every pointer is freshly read: candidate identity is CAS-switched back, old identity still requires explicit router/tunnel/drain proof, and a third identity is `UNPROVEN`. Fences are removed only after the rollback attempts; then full managed backend/router/tunnel ownership and policy health is proven, inactive candidates are ownership-stopped, and only then is the transaction journal removed. A failed health proof retains the journal and returns `UPDATE_FAILED_ROLLBACK_UNPROVEN`. Recovery follows the same order. After whole-machine success, each pointer is rechecked as the candidate immediately before marker-owned old stop, evidence packaging, exact-manifest validation, and release deletion; the accepted journal is retained until a fresh whole-machine managed-service proof passes. Retirement failure is reported as service-active cleanup, never as rollback pass.

Stable control files are not overwritten in place during normal updates. If their hashes differ, the update stops with `CONTROL_REVISION_CHANGE_REFUSED`; a separate reviewed control-plane migration is required.

## Verified scope and limits

The contract suite parses all three PowerShell scripts on Windows, runs side-effect-free self-tests, and exercises a detached receipt against an isolated temporary Git checkout whose source is deleted immediately after launcher return. Static safety contracts still run on non-Windows hosts; Windows execution tests are skipped there. JSON/receipt/journal temp files are opened with write-through and `Flush(true)` before rename. Windows/PowerShell does not provide a directory-fsync proof here, so rename-directory durability across sudden power loss remains **UNPROVEN** and recovery always treats missing/malformed journals as fail-closed. Live production cutover, real tunnel reconnection, DPAPI use, native desktop availability, rollback under injected failure, and legacy removal remain **UNPROVEN until an authorized live run returns its evidence**.
