Remote Commander v0.10.17
=========================

v0.10.17 is a bounded maintenance/finalization release on top of immutable v0.10.16.

The Windows updater now preserves stdout and stderr for every qualification gate in per-run files, records their paths before execution, and records SHA-256 digests after completion. This closes a diagnostics gap observed when an unattended exact-release qualification returned exit 1 but only its lifecycle JSON survived.

Safety semantics are unchanged: qualification still runs inside the existing owned Windows Job Object; nonzero child or runner exit remains failure; timeout, cleanup, backoff, candidate-first promotion, one-writer routing and fail-closed behavior are unchanged. No automatic retry is added and no failed gate is converted into success.

Remote Commander Browser v0.8.0-rc.8 remains the separately versioned immutable Browser dependency pinned by the Windows Setup. v0.10.17 does not widen browser-profile reuse, saved-password access, foreground takeover, authentication, model or filesystem authority.

Promotion requires exact-head local Windows qualification/audit, hosted Windows+Ubuntu CI, clean Windows/Linux server canaries, Linux cross-host check/audit, immutable tag publication, release-asset verification and post-rollout live readback. The v0.10.16 tag and assets must not be moved or rewritten.
