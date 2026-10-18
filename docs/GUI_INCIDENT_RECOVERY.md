# Native GUI incident — safe observation and future reconciliation

**Current scope:** OBSERVE-ONLY CANDIDATE. This branch does **not** provide a trusted owner-review/clearance action. No real pending incident is changed by these tools.

## What `NATIVE_OUTCOME_UNCERTAIN_RESTART_REQUIRED` means

A native mouse, keyboard or window-focus command might have taken effect, but its acknowledgment is missing or ambiguous. The old name is misleading: the durable per-user `PENDING_NATIVE_EFFECT` incident survives restart. Never retry the old action merely because no acknowledgment arrived.

## Safe behavior while pending

- `gui_status` reports `GUI_INCIDENT_REVIEW_REQUIRED`, minimal pending metadata and `inputAvailable:false`; its read-only availability is reported separately.
- An **observe-only** lease, screenshot, cursor/window inspection, renewal and lease end work subject to existing user policy and native helper readiness.
- Takeover, mouse, keyboard and focus input remain **blocked**. `GUI_STOP`, lease authorization and single-use frame checks remain in force.
- Neither an invented review JSON file, textual owner claim, PTY nor a process restart authenticates review or releases input.

On an affected host **for read-only inspection only**:

```sh
node tools/gui-incident-recover.mjs --status
node tools/gui-incident-recover.mjs --plan
```

The `--status` output includes the exact **SHA-256 of the original incident file bytes**, its size, and the privacy-minimal operation ID/type/timestamp. The inspector uses read-only file access and stable before/after file metadata checks, refuses linked/ambiguous records and never accepts a review receipt as permission. `--plan` reports blockers (owner-broker unavailable, native dispatch quiescence unverified, crash-safe review not implemented); these statements are **not** positive attestation of device safety. Repeated reads are not a guarantee against an adversary already operating under the same OS user, and the fingerprint is evidence identity, not a release token.

`--review` deliberately returns `GUI_OWNER_RECONCILIATION_NOT_IMPLEMENTED`; it cannot archive, clear, sign or replay anything. This is true even if launched locally with an interactive TTY.

## Product reconciliation design gate

See `GUI_INCIDENT_RECONCILIATION_DESIGN.md`. The real release path must be a native product-owned transition, not a raw filesystem action from ChatGPT or a same-user mutable key/receipt. It must serialize all GUI dispatchers (not just a fixture writer), preserve exact original bytes, stage a durable journal, use an independently trusted owner-presence mechanism, and fail closed after unknown process/power outcomes.

Do not manually delete or rename `gui-pending-native-input-v1.json` and do not forge `NOT_APPLIED`: an old `gui_type_text` may already have sent text. The installed Emad Windows and Linux runtimes remain unchanged until separately qualified deployment. No unsigned v0.10.25 release is authorized.

## Interrupted review guard (isolated candidate)

While the separate trusted-owner broker is unfinished, the incident store reserves three adjacent recovery artifact suffixes: `.review-prepared-v1.json`, `.review-archive-v1.json`, and `.review-terminal-v1.json` (all appended to the original pending filename). An artifact's **existence only** is treated as a blocker, not as proof that review succeeded. If a crash left an archived original but removed the pending pathname, new GUI input still remains denied; read-only screenshots can continue.

In this state the read-only CLI `--status` / `--plan` returns `recoveryRequired:true`, `releaseAuthorized:false`, `noReplay:true` and exit code **4**. This is a fail-closed detection mechanism, **not** a working archive/release operation. Neither GUI tools nor text confirmation can delete the blocker. Do not manually create, edit, move or delete any recovery or original incident artifact on an operational host. Real owner consent, trusted review broker and controlled recovery remain pending.
## Read-only interrupted-recovery evidence (development candidate)

When any adjacent `.review-prepared-v1.json`, `.review-archive-v1.json` or `.review-terminal-v1.json` exists, the new Core reports `GUI_INCIDENT_RECOVERY_REQUIRED` and continues to deny native GUI mutations. Observation-only sessions and screenshots remain allowed under existing policy. `gui-incident-recover.mjs --status` / `--plan` output an additional `recovery` object with the interrupted state and bounded exact SHA-256/byte-size evidence for the original, prepared marker, archived original and terminal marker where present.

The archived original is validated as canonical `PENDING_NATIVE_EFFECT` bytes, with stable file identity, size and link rejection. Arbitrary marker contents are **not parsed as trusted consent**. `CONFLICTING_ORIGINALS`, `ORIGINAL_ARCHIVED_REVIEW_UNVERIFIED`, `REVIEW_INTERRUPTED_OR_UNTRUSTED` and `ORIGINAL_MISSING_RECOVERY_REQUIRED` are observational labels, not permission states. Corrupt or unsafe evidence yields `inspectionError:GUI_INCIDENT_STORAGE_UNAVAILABLE`; the CLI exits nonzero and input remains blocked.

There is still no owner broker, trusted review transition, automatic unlock, manual deletion, or Replay in these tools. This inspection is *not* proof of power-loss durability or native authorization.

### Native dispatcher preflight (read-only)

`node tools/gui-incident-recover.mjs --preflight` adds a bounded **advisory** inventory of observed Commander Core and native GUI Helper processes. It reports only PID, session identifier and role, never command-line arguments or typed content. On Windows it reads Win32 process metadata; on Linux it reads `/proc`. Enumeration failure returns `scan:FAILED` and an unknown count, **not** a false zero. The command does not terminate processes, steal GUI leases, acquire the production Mutex, archive or clear any Incident.

Even when `activeCount:0`, the output remains `quiescenceProven:false` and `releaseAuthorized:false`: an observation is not an atomic native dispatch barrier, and older or unavailable clients may not participate. This is a diagnostic prerequisite for the OS-local owner broker, **not** permission to move the pending journal or deploy the candidate.

### Linux native coordination candidate

The candidate Linux Native Helper serializes mutating GUI requests through a private account-scoped `flock` in `/run/user/<uid>`. Read-only GUI observation does not acquire it. New Core refuses native input if its Linux Helper lacks the coordination version; exact `NOT_SUBMITTED` receipts prove only a **new** request was never submitted. They never reconcile historical `PENDING_NATIVE_EFFECT`.

This native coordination does not authenticate the owner or force legacy sessions to use the lock. No installed Linux Core, original J01 journal or active GUI session is changed by QA. A trusted local owner broker and mixed-version fleet quiescence remain required before any incident can be safely archived and input restored.
