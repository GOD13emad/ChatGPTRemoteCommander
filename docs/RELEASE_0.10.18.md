Remote Commander v0.10.18
=========================

v0.10.18 is a bounded Linux rollout-readiness hotfix on top of immutable v0.10.17.

The Linux updater retains `/readyz=ready` as its direct tunnel readiness fast path. If `/readyz` is non-ready, the updater requires both `/healthz=live` and a positive `commands_poll_last_successful_timestamp_seconds` metric whose age is within the bounded `REMOTE_COMMANDER_TUNNEL_STALE_SECONDS` window (90 seconds by default). Missing, zero, stale metrics and non-live health remain failures. The gate remains before `CUTOVER_COMMITTED=1`.

The change closes a reproduced false-negative on `saeed-emad-laptop`: its local `/readyz` OAuth-discovery subcheck reported connection refused while the same tunnel was actively forwarding Remote Commander calls and exposed a zero-second-old successful control-plane poll. Candidate v0.10.17 doctor, hardware selftest, qualification and schema-continuity had already passed; the route was preserved because the old gate failed before cutover.

Remote Commander Browser v0.8.0 remains the same immutable stable dependency. No browser login/profile behavior, credential authority, filesystem/model authority, tunnel credential/process ownership, automatic retry or safety/admission policy is widened.

Promotion requires exact-head Windows qualification/audit, exact-head Linux focused/live plus full qualification/audit, hosted CI/Release Sync/Server Canary, immutable tag publication, release-asset verification, and candidate-first live rollout/readback.
