# v0.8.37 qualification

Status: RELEASED / CURRENT on the audited Windows and Linux targets, 2026-09-25.

This is a scoped compatibility and invariant-hardening release over immutable v0.8.36. It does **not** expand project execution authority. The bounded artifact worker remains opt-in, application-level isolation rather than an OS sandbox, and cannot directly receive Commander project filesystem/shell/GUI/process/terminal/deletion/completion tools.

PR #13 adds narrowly scoped Codex CLI 0.156.1 JSONL compatibility: Commander accepts only the exact fail-closed diagnostic emitted because `code_mode_host` is intentionally disabled, only in the expected pre-turn position and exact schema. Unknown, widened, duplicated, reordered or executable-tool provider events remain fail-closed.

Independent review then found three artifact-worker invariants that are fixed and permanently regressed here:

1. A ready worker receipt remains bound to the exact delegated workflow step; plan progress cannot retarget it to a later step.
2. A coordinator may use an absolute `write_text` target only when canonical containment proves it remains inside the enrolled project root; escapes still fail before effect.
3. The documented 64 KiB artifact ceiling round-trips even when JSON escaping expands the proposal. Planner/team context and proposal envelopes remain bounded, and workflow arguments retain a hard 256 KiB ceiling with a negative regression above it.

| Gate | Status |
| --- | --- |
| Final PR-head Windows full test/check/audit | PASS — 340 core PASS / 5 platform-or-privilege SKIP / 0 FAIL; GUI 75/75 |
| Final PR-head Linux exact-diff full test/check/audit | PASS; GUI 75/75 |
| PR #13 hosted Windows/Ubuntu CI | PASS — four jobs |
| Authenticated isolated Codex CLI 0.156.1 qualification | PASS — `COMPLETED`, artifact verified, Brain created |
| Independent review after follow-up | PASS — no actionable regression |
| Exact v0.8.37 commit Windows/Ubuntu hosted CI | PASS — four jobs on `09fcc485fd7ade82f7d8be25efc4f77ebc17e640` |
| Fresh/repeated pinned installers and production-isolation checks | PASS — Windows and Linux; exact commit/version/Full Power; no-start acceptance preserved live production state |
| Reproducible 13-asset bundle and GitHub digests | PASS — two independent builds matched 13/13; draft GitHub asset digests matched local 13/13 |
| Public immutable release and Windows/Linux live promotion | PASS — v0.8.37 is Latest/immutable with 13 assets; audited routes are CURRENT with no previous generation |

Publication authority: tag `v0.8.37` peels to `09fcc485fd7ade82f7d8be25efc4f77ebc17e640`; PR #14 merged the release record to `main` at `72b728f15805807259ab587b8a3b021ef7c54ce0`. GitHub published the release as immutable Latest with 13 assets on 2026-09-25. Candidate-first promotion completed on the audited Windows and Linux targets. All active routes report 0.8.37 and no previous generation. Windows retained older backends only where persistent terminal workloads were still live; maintenance retired the routing slot without terminating those workloads. Linux retired and cleaned its previous generation.

v0.8.37 intentionally does not add broader blocker escalation, monetary accounting, external notification delivery, unrestricted mutating worker fleets, Claude execution, arbitrary scientific validation or a superiority claim. Equal-model/equal-budget comparative benchmarks remain open.
