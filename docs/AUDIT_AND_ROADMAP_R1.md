# Expanded product audit and roadmap — 2026-09-19

## Definition and acceptance
Project: ChatGPT Remote Commander, expanded from an MCP execution bridge into a
project-aware, recoverable automation system. Target acceptance is measured per
scenario: observable effect, correct project/device, recoverable history,
no duplicate ambiguous action, retained evidence, bounded resources and safe
human intervention. No claim of being universally better than Codex/Claude/Work,
of doing every possible task, or of an unsupported benchmark score is made.

Baseline source and verified live identity: v0.6.4,
402b9f4110f0c27bc7da3059f956df309048ca53, Emad-PC-Ultimate.
An isolated candidate worktree is used; deployment authority is unchanged.

## Audit coverage
Manual source review covers the full contents of these CURRENT files:
server-v0.3.mjs, tools-v0.3.mjs, power-tools-v0.3.mjs, security-v0.3.mjs,
locks.mjs, platform.mjs, schema-validator.mjs, transport-guard.mjs,
gui-contract.mjs, gui-process.mjs, gui-tools-windows.mjs,
tools/gui-native.cs, tools/gui-control.ps1, autostart-windows.ps1,
test/concurrency-smoke.mjs; also package.json and plugin SKILL.md.
All tracked text-source file hashes/line counts are separately inventoried.
Inventory/static tests are not the same as manual review. Legacy runtime branches,
every installer line, all tests and all historical commits have NOT received a
fresh line-by-line human-style review in this pass. This is not certification.

## Findings
F01 Confirmed by source; baseline probe to reproduce: expectedSha256 ignored on
missing target in both write paths. Narrow repair F1, regression required.
F02 Confirmed control-flow risk; synthetic partial-delete probe to reproduce:
move overwrite rollback can remove the last complete source copy. Narrow repair
F1 preserves recovery copies; organic fault not claimed.
F03 Confirmed design gap: terminals, GUI leases and path locks are in-memory.
Audit rotation is not project recovery. W1 adds OPT-IN durable workflow state,
not persistence of existing terminal processes or all old chat operations.
F04 Confirmed design limitation: multiple tunnel profiles share one OS/MCP
principal. No account-level project isolation is proved; memory remains disabled
in production. Separate authorization/OS isolation is required for differing trust.
F05 Confirmed source behavior: runProjectCommand audits raw args and spawned
commands inherit process environment. This is a leakage surface, NOT proof of
an actual credential leak. Redaction/secret-broker regression remains open.
F06 Confirmed source behavior: child.kill() targets the child, not a verified
complete descendant tree; pipe/descendant lifetime needs process-supervision work.
F07 Confirmed scope gap: no structured DOM/UIA adapter or durable agent scheduler
exists in baseline. Optional owned browser fixture is only acceptance groundwork.
F08 Confirmed scope gap: GUI uses fresh frames and bounded input, not low-latency
perception/control. No commercial-game or anti-cheat compatibility is proved.
F09 Confirmed test design: concurrency smoke still uses fixed temporary names
and port 47931. New workflow tests are unique/isolated, but the OLD full suite must
not run concurrently in the same checkout. Concurrent suite isolation remains open.
F10 Confirmed source behavior: supervisor readiness checks name/ok, not exact
runtime build; an alive-but-unready tunnel reports an error rather than recovering.
No restart/kill of those live processes is performed by this audit.

## Measured roadmap, no invented percentage
M0 DISCOVERY/BASELINE: identity, source inventory, primary research and scope.
M1 FILE INTEGRITY F1: repro -> two precondition fixes -> recovery-copy preservation
   -> focused fault tests -> local candidate commit.
M2 DURABLE MEMORY W1: SQLite transactions, typed notes/search, intent/receipt,
   compare-and-swap revisions, proof checkpoints, uncertain-action reconciliation,
   logical export -> cross-process crash tests -> MCP integration -> local commit.
M3 BROWSER QA: optional localhost form + farm fixture, screenshots, trace,
   stable selectors and checkpoint. Production URLs, accessibility and visual
   baselines, downloads/uploads, sessions and authenticated app tests remain OPEN.
M4 NATIVE APP/GAME ADAPTERS: UIA tree and exact element identities, resource-bounded
   visual loop, per-game/app acceptance, human stop. Not yet implemented generally.
M5 SUPERVISION/SECURITY: durable job worker, lease/fencing, cancellation, process
   trees, trusted approval channel, isolation, encrypted secret handles, budgets,
   restart/resume integration, prompt-injection and cross-account tests. OPEN.
M6 ACCEPTANCE/RELEASE/CLOSURE: target-specific independent acceptance, upgrade and
   rollback rehearsals, account E2E, signed manifests, release review, deployment
   and cumulative Brain transfer. No auto-promotion.

Current stage and actual pass/fail are in RESULT_R1.json and evidence logs; this
document is a design/control record, not a substitute for execution evidence.
Scope-relative completion counts may be reported; whole-product percentage is
UNPROVEN until requirements are weighted and accepted. Legacy product release
status must not be reused as acceptance of these expanded requirements.

## Research decisions (primary sources)
- Anthropic, effective-harnesses-for-long-running-agents: explicit feature list,
  incremental work and progress artifacts; compaction alone is insufficient.
  https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic managed agents: separate the reasoning environment from execution.
  https://www.anthropic.com/engineering/managed-agents
- OpenAI computer-use integration: screen/third-party artifacts are untrusted;
  confirmations and secret handling must be maintained at action time.
  https://developers.openai.com/api/docs/guides/tools-computer-use-integration
- Playwright: locators, trace snapshots and assertions, visual baselines and
  planner/generator/healer patterns. Do not auto-accept a healed baseline.
  https://playwright.dev/docs/trace-viewer
  https://playwright.dev/docs/test-agents
  https://playwright.dev/docs/aria-snapshots
- Microsoft Windows UIA: structured element access, with framework/session limits.
  https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview
  https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/ui-automation
- SQLite: rollback journal and synchronous EXTRA selected, considering bundled
  library versions and the 2026 WAL-reset advisory. This is not a power-loss test.
  https://www.sqlite.org/atomiccommit.html
  https://www.sqlite.org/pragma.html
  https://www.sqlite.org/wal.html
- Node SQLite binding: dependency/version-specific opt-in, no third-party DB server.
  https://nodejs.org/download/release/v22.14.0/docs/api/sqlite.html
- Supercell states that gameplay bots/scripts can violate rules and incur account
  penalties. The local farm fixture does not authorize or certify Hay Day automation.
  https://support.supercell.com/supercell-id/en/articles/fair-play-dont-be-a-cheat.html

## Deferred / exact next action
After candidate validation, review F05/F06/F09/F10 and per-account authority before
live promotion. Select one real authorized website/app/game scenario and its
expected outcomes; add adapter-specific tests and independent acceptance. Do not
silently widen filesystem scope, bypass CAPTCHA/UAC/anti-cheat, or infer permission
from a remembered note. Host capabilities are not a promise of model success.
