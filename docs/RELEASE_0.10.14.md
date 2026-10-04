Remote Commander v0.10.14
=========================

This candidate closes a Linux post-cutover maintenance gap observed across the v0.10.11, v0.10.12 and v0.10.13 rollouts. The routed runtime successfully advanced, but the control checkout remained on v0.10.9 because two historical PowerShell files appeared dirty only from CR-at-EOL normalization. As a consequence, the maintenance tail did not record durable completion and the personal Remote Commander Work/Codex plugin source also remained stale until manually reconciled.

Linux control promotion
-----------------------
The Linux updater now applies the same fail-closed distinction already proven on Windows:

- any staged tracked change blocks promotion;
- any substantive unstaged tracked change blocks promotion;
- CR-at-EOL-only working-tree drift is tolerated and logged as `CONTROL_EOL_DRIFT_TOLERATED`;
- the exact fetched commit is verified after forced detached checkout and logged as `CONTROL_PROMOTION_PASS`.

The post-commit ERR trap remains active through maintenance, so failures after route cutover are classified instead of disappearing between `CUTOVER_COMMIT` and durable updater completion.

Work plugin projection sync
---------------------------
When the personal Remote Commander Work/Codex plugin is already installed, the updater now synchronizes its source projection from the exact staged release `plugin-template` in both the same-version maintenance-recovery path and the normal post-cutover path.

The operation is intentionally narrow:

- absence of the personal projection is a safe no-op;
- the existing `.app.json` must be a regular file with a valid app-id shape;
- the staged portable and native manifests must both match the candidate version;
- the private app binding is never logged and is preserved byte-for-byte;
- a prestate copy is retained under the commit-specific updater backup root;
- a fresh candidate copy is prepared off-path, personalized exactly as the Work installer does, and atomically swapped into place;
- swap or post-verification failure rolls back to the prior projection;
- portable/native versions, app references, personal display metadata and the app-binding SHA-256 are verified before `WORK_PLUGIN_SOURCE_SYNC_PASS`.

Qualification
-------------
Focused updater contract: 17 pass / 0 fail / 1 Windows-only skip.

`check:qualification`: 269 total / 263 pass / 0 fail / 6 platform skips.

`test:qualification`: 515 total / 509 pass / 0 fail / 6 platform skips.

Supplementary GUI contract 77/77, Linux GUI, filesystem safety, headless launch policy, Windows runtime contract, source integrity and schema continuity 9/9 all pass. `SECURITY_AUDIT_PASS`.

Linux-only deployment scope
---------------------------
Current owner direction limits this milestone to Linux and Linux-specialized functionality. v0.10.14 is therefore qualified and deployable as an exact-commit Linux candidate on the current Linux host, but it must not be treated as a general cross-platform release or merged/tagged as such until a separate Windows scope is explicitly resumed. Windows CI/canary results are informational and out of the current acceptance boundary.

Acceptance
----------
v0.10.13 remains the repository-wide accepted stable release. For the current Linux-only scope, v0.10.14 acceptance requires Linux qualification plus exact-commit rollout and post-cutover evidence on this host. Repository-wide merge/tag publication is deferred. Rollout acceptance specifically requires the control checkout to reach the release merge commit, durable updater completion evidence to reappear, and the personal Work/Codex plugin source plus managed Codex cache to report v0.10.14 with the same preserved app binding.
