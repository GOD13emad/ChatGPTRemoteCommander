# Remote Commander v0.10.2

Date: 2026-09-30

## Scope

Maintenance hardening on top of the accepted v0.10.1 runtime. This release does not widen Commander authority, change tunnel/routing policy, enable automatic project execution, relax GUI/browser takeover rules, or change Plugin permission boundaries.

The change set closes three reliability gaps observed during the post-v0.10.1 audit:

1. The Windows updater CURRENT fast path must reconcile retained backend registry entries before deferred drains and release cleanup.
2. The transport-correlation HTTP regression must not depend on an arbitrary short server-start scheduling window under a loaded Windows qualification run.
3. Windows Server bootstrap must not reinstall an already-present Node.js or Git prerequisite merely because an administrator or canary environment removed it from PATH.

## Windows retained-backend maintenance

The existing retained-backend reconciler already preserves a retained backend when its registered terminal PID or listener is still live and removes only entries that are independently observed dead. The CURRENT fast path previously skipped that reconciler before cleanup.

v0.10.2 calls the existing safe reconciler in the CURRENT path before deferred-drain and release-cleanup work. This does not add a new process-kill mechanism and does not rewrite durable workflow evidence.

## Windows prerequisite reuse outside PATH

The Windows Server canary intentionally removes Node.js and Git from PATH. Current GitHub-hosted Windows Server 2022 images can still have those tools installed in their standard Program Files locations. Reinstalling the same Node MSI can fail before product qualification begins.

v0.10.2 therefore:
- checks the standard Program Files Node.js and Git locations when command discovery misses them;
- reuses only a Node.js major version already accepted by the installer and requires valid Authenticode verification for the out-of-PATH fallback;
- records SHA-256 and signer evidence for reused prerequisites in the existing allowlist manifest;
- prepends the resolved Node/Git directories only to the current installer process PATH before handing off to install.ps1;
- preserves the existing verified-download/install fallback when no reusable prerequisite is found.

This does not add Defender exclusions, does not permanently widen PATH, and does not weaken the existing prerequisite version policy.

## Transport-correlation qualification determinism

The transport-correlation HTTP test previously polled health 400 times at 25 ms, effectively coupling the regression to an approximately 10-second scheduling window. During one loaded Windows full-suite candidate run, that setup timed out even though the same test immediately passed repeated isolated execution.

v0.10.2 changes only the test harness:
- startup uses a 30-second elapsed deadline;
- early child exit is reported immediately with exit code and captured stderr;
- health polling remains bounded;
- production server/runtime timeouts and transport behavior are unchanged.

Focused Windows repetition passed 10/10 after the change. Full candidate check/test/audit also passed on both audited Windows and Linux hosts before this release-preparation branch.

## Acceptance

Required before publication:
- complete Windows qualification check/test/audit;
- complete Linux qualification check/test/audit;
- hosted Windows and Ubuntu CI on the exact release candidate;
- disposable Windows Server bootstrap and clean Ubuntu server-install canaries on the exact release candidate;
- deterministic release-asset build/checksum verification;
- immutable v0.10.2 tag/release publication;
- candidate-first live Windows/Linux rollout and exact version/commit/readiness readback.

## Boundaries

- Historical durable workflow/delivery records are preserved; no bulk deletion or blind replay is introduced.
- Real reboot/power-return behavior remains a separate validation event; this release preparation performs no reboot/shutdown/logoff.
- Windows live GUI availability still depends on an attached interactive desktop session; native GUI contract/self-test and live-session availability remain separate checks.
- Linux automatic project execution remains policy-disabled/unconfigured unless separately authorized.
