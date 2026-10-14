# MMZ Linux — v0.10.21 Full Power tool-catalog parity and release-readiness audit

**Date:** 2026-10-14. **Status:** CATALOG PARITY PASS; PRODUCTION CUTOVER NOT ACCEPTED; PROJECT NOT FINAL.

## Authority and previous accepted state

Only Mohammad's Ubuntu 26.04.1 Linux (`mmz-LOQ-15IRX9`), NVIDIA RTX 4050 6 GB, is in scope. Existing operational Commander `0.10.20` is pinned to commit `362375c464948be3001b307650c13fc3353ed05b` at `~/.local/state/chatgpt-remote-commander/releases/v0.10.20-362375c46494`. The active router uses profile `default` generation 116 and an authoritative **recovery-policy config** SHA256 `20847620997889a58ba37d49fac50ceb28e7a8746e9ea9a4f574688e39c299e7`. The installed-checkout local config has a **different** SHA (`5ba1ffc7b271fb7b23df7d27453b039a3492da74a88f97ba93ef32d52e90e9d9`), so using that file instead of the active route config in a migration is the wrong authority.

Draft PR #204 branch `feature/provider-command-adapter-20261013` source HEAD exactly `f47415d4630f6ddb21d3be1619940f74401ca069`; GitHub and local branch matched, prior exact-commit hosted checks and Linux-native test suite had passed. Production runner `enabled=false`, `autoTick=false`; Qwen model services inactive. There is one unrelated **untracked, other-writer** `examples/provider-adapter/qualify-linux-project-snapshot-read.mjs` (9056 bytes), which was left unmodified. No automated source execution or rollback was attempted.

## Earlier Linux gate evidence

- Linux-targeted five test files: 22/22 PASS. Private log `~/.local/share/rc-local-ai/evidence/rc_mmz_linux_targeted_20261014.log` SHA256 `6155c82c65cac6321519a954a1062f340990d0bbc366a0279c36591401bc97a3`.
- True isolated `install.sh` of the **exact pinned commit** in a user-local custom path, with no service start or router registration: `INSTALL_PASS`, source check/test/audit and `SECURITY_AUDIT_PASS`. Private log SHA256 `372312bf7131a4c0adc888f8ee4f867c13c7d326c818d9cc2507e1c9c1bffefb`.
- Isolated Standard server `0.10.21` on private port 47919: health 200, Doctor 6/6 PASS (47 tools). Private smoke log SHA256 `3056c85be9dc8708fa8f3da09725055a51ec3367c1740831a6d081c3f90c109b`.
- Offline migration using the actual active route config as input to candidate `tools/capability-migrate.mjs` with an isolated output: `CAPABILITY_MIGRATION_PASS` with all 26 capabilities preserved, same disabled `shell.unrestricted` exception, Full Power and fullFilesystem true, same workflow path, no automatically configured runner. Generated preview SHA identical to active input: `20847620997889a58ba37d49fac50ceb28e7a8746e9ea9a4f574688e39c299e7`. This is policy parity, not behavioral parity.
- Successful acceptance of one- and two-step authorized read-only synthetic and hash-pinned real-source snapshots, with independent hash verification. Prior reports contain the raw transcript references. No write/shell/autonomous action was authorized. Isolated installation already cleaned, raw evidence retained.

## 2026-10-14 NEW critical-path Full Power runtime catalog verification

One bounded Linux read-only comparison: exact source commit was extracted with `git archive` into an ephemeral user-only `/tmp/rc-mmz-catalog-*` folder (no Dev checkout modifications, no packages or installs). The **active route** Full Power config was copied only into that temporary folder and rewritten for host-bound isolation: loopback port `47919`, local-only workspace, separate audit, runtime state, workflow/lease/delivery directories, unique delivery scope, separate browser profile root, no actual browser executable, temporary XDG state/config roots, autoUpdate off, runner/autoTick off. The GUI and browser **catalog switches** remained enabled to exercise the full schema registry, but no GUI/browser controls were invoked. The 11 installed Agent Extensions remained discoverable; they were not invoked. Production was accessed only using `GET /health` and read-only `tools/list`.

The candidate server returned health version `0.10.21`. Compared against the existing live v0.10.20 full-power 97-tool registry:

| Check | Exact result |
|---|---|
| Stable MCP tool names | 97 |
| Candidate MCP tool names | 97 |
| Missing tools | **0** |
| Unexpected tools | **0** |
| Differing `inputSchema` values by tool name | **0** |
| Isolated process shutdown | PASS |
| Temporary source and state removal | PASS |
| Active production PID before/after | **5208 / 5208** |
| Live Router hash before/after | **c1a31a6563e2842849acb21bf62c5e54b345d06f2652d4906ff8e74c9edfa744** |
| Production release restart count | **0** |

**Result:** `FULL_POWER_CATALOG_PARITY_PASS`. This confirms **tool names and input schemas** for this exact build and profile switches. It does **NOT** validate GUI/browser execution, output equivalence, persistent client session continuity, privileged mutation behavior, runtime performance, rollback or actual in-place version promotion. No significance tests apply.

### Authoritative private evidence pointers (EXTERNAL to repository)

- Script `~/.local/share/rc-local-ai/evidence/qualify_linux_fullpower_catalog_20261014.py` SHA256 `50256e96ff7be1d4658cd4b77849f4c6b09c4daa32c940d572be258cea9d8d88`.
- Strict comparison JSON `~/.local/share/rc-local-ai/evidence/rc_mmz_power_catalog_parity_20261014.json` SHA256 `e3ba281a74ac08c5e16b595f47dea41978b3ad20e3996fdcb85349203caa6d26`.
- Transient server-only log `~/.local/share/rc-local-ai/evidence/rc_mmz_power_catalog_parity_server_20261014.log` SHA256 `ba605d43969a5ae1c483fd6488259f1446b049d8539b5d80e7ff1c3c2bfb898c`.
- Linux cumulative private handoff `~/.local/share/rc-local-ai/evidence/RC_MMZ_REAL_SOURCE_READ_HANDOFF_20261014.md` includes earlier lifecycle, full dry-run migration, and candidate cleanup receipts; external private data are **not** in GitHub.

## Open rollback and release authority gates

- **No immutable stable tag `v0.10.21`** existed at the last exact remote `git ls-remote --tags` check. A development branch commit is not a released stable version.
- Current active Router's `previous` pointer was **null** (generation 116). Historical `v0.10.12` is present and referenced in `retained-backends.json`, but is **not** established as a currently usable rollback route. The v0.10.20 deployment must be explicitly retained and protected in any future swap, with an independently verified restoration path for active credentials/profiles/session state.
- No production upgrade or service restart authorized in this change set. Do not infer the locally passed Standard/Full Power catalog and isolated installer checks guarantee zero-downtime cutover or product FINAL.
- One pre-existing untracked script belongs to another execution; leave it untouched. Source and knowledge can be advanced only via verified one-writer coordination and exact source SHA.

**Roadmap ← CURRENT:** local Linux installer, isolated server, config preservation and 97-tool catalog/schema parity PASS. Remaining: review/publish immutable Linux release authority, independently test a reversible live promotion/rollback with preserved session and state, owner release acceptance, real high-stakes tool quality. Defer autoTick, unrestricted write tools and publication until separate acceptance. Confidence CONFIRMED for named checks, UNPROVEN for product finality. No percentage claim.
