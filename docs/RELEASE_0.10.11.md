Remote Commander v0.10.11
=========================

This patch release fixes a Windows post-cutover maintenance failure discovered by the v0.10.10 healthy-host canary. The routed v0.10.10 runtime cut over and passed health/hardware checks, but control-checkout promotion stopped on `CONTROL_TRACKED_DIRTY` because two historical PowerShell blobs were CRLF while current Git attributes normalize those files for comparison.

Windows control-promotion repair
--------------------------------
`Promote-Control` remains fail-closed for staged changes and for every substantive unstaged change. When tracked dirtiness exists, the updater now permits promotion only if:

1. the index has no staged delta from `HEAD`; and
2. the complete unstaged tracked diff is identical when only end-of-line whitespace is ignored.

Only that EOL-only case logs `CONTROL_TRACKED_EOL_DRIFT_ACCEPTED` and proceeds to the already-existing exact-ref fetch, commit peel verification, detached forced checkout, supervisor recycle, and release cleanup.

Safety boundary
---------------
This is not a general dirty-worktree bypass. Content edits, deletions, renames, staged changes, or any other tracked difference still stop with `CONTROL_TRACKED_DIRTY`. Untracked files remain outside the existing promotion guard exactly as before.

Regression
----------
The updater contract includes a real temporary Git repository that deliberately commits a historical CRLF PowerShell blob via `hash-object --no-filters` / `update-index --cacheinfo`. The regression proves the historical EOL anomaly is accepted by the content classifier while a substantive unstaged edit and an independent staged edit remain blocked.

Release scope
-------------
v0.10.11 otherwise preserves v0.10.10 runtime, filesystem-enumeration, durable-delivery, GUI, browser, workflow, routing, and host-recovery boundaries. Emad-PC remains separately owner-recovery gated and the Linux laptop GNOME-session issue remains a host/session gate rather than a release-runtime claim.

Acceptance
----------
Publication requires focused updater/version-contract tests, full check/test/audit qualification, hosted Windows and Ubuntu CI, Linux and Windows Server install canaries, an exact-ref healthy Windows candidate-first rollout, post-cutover maintenance completion, and immutable release asset verification.
