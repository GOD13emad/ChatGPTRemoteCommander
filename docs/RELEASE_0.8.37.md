# v0.8.37 qualification

Status: CANDIDATE, 2026-09-25.

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
| Exact v0.8.37 release Windows/Ubuntu CI | PENDING |
| Fresh/repeated pinned installers and production-isolation checks | PENDING |
| Reproducible 13-asset bundle and downloaded digests | PENDING |
| Public immutable release and Windows/Linux live promotion | PENDING |

v0.8.37 intentionally does not add broader blocker escalation, monetary accounting, external notification delivery, unrestricted mutating worker fleets, Claude execution, arbitrary scientific validation or a superiority claim. Equal-model/equal-budget comparative benchmarks remain open.
