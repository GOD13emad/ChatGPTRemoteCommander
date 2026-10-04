Remote Commander v0.10.14
=========================

This candidate closes multiple Linux post-cutover maintenance gaps observed across the v0.10.11–v0.10.13 history and reproduced during a live v0.10.14 candidate rollout. Historical CR-at-EOL drift prevented safe control promotion on recovery, the personal Work/Codex projection could remain stale, and—more importantly—a manual updater launched through a Commander terminal could be killed when that same old backend was retired. Successful completion also had no durable `last-update.json` receipt even though the path was defined.

Linux control promotion
-----------------------
The Linux updater now applies the same fail-closed distinction already proven on Windows:

- any staged tracked change blocks promotion;
- any substantive unstaged tracked change blocks promotion;
- CR-at-EOL-only working-tree drift is tolerated and logged as `CONTROL_EOL_DRIFT_TOLERATED`;
- the exact fetched commit is verified after forced detached checkout and logged as `CONTROL_PROMOTION_PASS`.

The post-commit ERR trap remains active through maintenance, so failures after route cutover are classified instead of disappearing between `CUTOVER_COMMIT` and durable updater completion.

Commander-owned invocation isolation
------------------------------------
When `auto-update-linux.sh` is invoked from a process tree owned by a managed Commander backend, it now detects that ancestry through a bounded `/proc` walk before taking the update lock. It re-executes the exact original arguments under `nohup setsid -f` with a one-shot `REMOTE_COMMANDER_AUTO_UPDATE_DETACHED=1` guard, logs `AUTO_UPDATE_SELF_DETACH_REQUESTED`, and lets the caller exit. Normal supervisor-launched updates and `--self-test` do not detach. Missing `setsid` fails closed.

This prevents `drain_previous_once` / old-backend retirement from terminating the updater that is still responsible for control promotion, plugin synchronization, cleanup and durable PASS recording.

Durable Linux update receipt
----------------------------
Before logging `AUTO_UPDATE_PASS` or `AUTO_UPDATE_MAINTENANCE_PASS`, the updater atomically writes a mode-0600 `last-update.json` receipt containing schema, Linux platform, pass type, exact version, exact 40-hex commit, bounded source ref and UTC completion timestamp. The write uses a same-directory temporary file plus atomic rename; invalid identity fails closed and does not replace the prior receipt.

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
Focused Linux updater/installer/schema regressions after self-detach + durable-receipt hardening: 24 pass / 0 fail / 1 platform skip.

`check:qualification`: 270 total / 264 pass / 0 fail / 6 platform skips.

`test:qualification`: 516 total / 510 pass / 0 fail / 6 platform skips.

Supplementary GUI contract 77/77, Linux GUI, filesystem safety, headless launch policy, Windows runtime contract, source integrity and schema continuity 9/9 all pass. `SECURITY_AUDIT_PASS`.

Linux-only deployment scope
---------------------------
Current owner direction limits this milestone to Linux and Linux-specialized functionality. v0.10.14 is therefore qualified and deployable as an exact-commit Linux candidate on the current Linux host, but it must not be treated as a general cross-platform release or merged/tagged as such until a separate Windows scope is explicitly resumed. Windows CI/canary results are informational and out of the current acceptance boundary.

Acceptance
----------
v0.10.13 remains the repository-wide accepted stable release. For the current Linux-only scope, v0.10.14 acceptance requires Linux qualification plus exact-commit rollout and post-cutover evidence on this host. Repository-wide merge/tag publication is deferred. Rollout acceptance specifically requires one first-pass invocation from inside Commander to log `AUTO_UPDATE_SELF_DETACH_REQUESTED`, continue independently through cutover without a second recovery invocation, promote control to the exact candidate commit, synchronize the personal Work/Codex projection and managed cache to v0.10.14 with the same preserved binding, write the durable `last-update.json` PASS receipt, and finish with `AUTO_UPDATE_PASS`.
