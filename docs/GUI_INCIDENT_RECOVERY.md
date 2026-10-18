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
