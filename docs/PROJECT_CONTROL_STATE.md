# Current project state

Updated: 2026-09-25. Scope: public product/release status, not a live machine inventory.

## Release baseline

- [v0.9.1](RELEASE_0.9.1.md) is the latest immutable **published GitHub Release** at this checkpoint, with 13 assets. v0.9.0 is also an immutable published release.
- [v0.9.3](RELEASE_0.9.3.md) is the current Linux-completeness release target. It carries the v0.9.2 installer cleanup fix and adds terminal-preserving Linux cutover plus a safe Firefox WebDriver background-browser backend without widening foreground authority.
- v0.8.38, v0.8.39 and v0.8.40 remain historical unpublished tags and are intentionally not moved.
- Later live audit on 2026-09-25 confirmed Emad PC on v0.9.1 with Full Power Project Engine automatic execution and all 27 current capabilities granted. Emad laptop successfully validated v0.9.1 Full Power candidates, but promotion was safely deferred because the old routed backend owned persistent terminal sessions. v0.9.3 closes that Linux retention gap without killing those terminals.
- The Windows Full Power configuration created through Saeed's ChatGPT Work account on the accessible Emad PC supplied the parity requirements for Project Engine runner + automatic execution. No live state from Saeed's own physical computer is used as release authority. Linux Project Engine candidate parity is now proven; the remaining release work is exact v0.9.3 qualification/publication/rollout.

## CURRENT / open release gates

CURRENT: v0.9.3 Linux-completeness qualification.

Focused Linux retention and Firefox background-browser E2E gates are PASS. Remaining gates are full Windows/Linux check-test-audit on the exact v0.9.3 commit, hosted PR CI, exact-tag installer/update acceptance, reproducible release assets, immutable GitHub publication, candidate-first rollout, and post-rollout route/tunnel/tool canaries.

## Remaining roadmap

Broader blocker escalation, monetary accounting, additional providers/integrations and equal-model/equal-budget project benchmarks remain open. The complete ambition of a universally superior project agent is **UNPROVEN**. A configured provider and explicit project enrollment are required for model-driven execution. Installation, service health, account authentication and task acceptance are separate checks. The release does not establish an OS sandbox or new autonomous browser authority.

## Where to continue

- Installation: [START_HERE](../START_HERE.md) and [Work/Codex setup](../WORK_SETUP.md).
- Behavior: [project engine](PROJECT_ENGINE.md), [adaptive planning](PROJECT_ENGINE_ADAPTIVE.md), [project questions](PROJECT_ENGINE_DECISIONS.md), [background browser](BACKGROUND_BROWSER.md).
- Validation: [v0.9.3 candidate](RELEASE_0.9.3.md), [v0.9.1 published baseline](RELEASE_0.9.1.md), [v0.9.2 historical candidate](RELEASE_0.9.2.md), [v0.9.0 published](RELEASE_0.9.0.md), [v0.8.42 historical published baseline](RELEASE_0.8.42.md), [v0.8.40 historical candidate](RELEASE_0.8.40.md), [v0.8.39 historical candidate](RELEASE_0.8.39.md), [qualification history](PROJECT_ENGINE_VALIDATION.md), [GUI acceptance](GUI_ACCEPTANCE.md).
- Knowledge: [engineering decisions and evidence](PROJECT_KNOWLEDGE_EVIDENCE.md).

Historical checkpoints are preserved in the [archived project state](history/PROJECT_CONTROL_STATE_20260924.md). Their former “current”, “final” and “next action” labels are historical. Account bindings, machine paths, process inventories and operational receipts belong in private deployment handoffs rather than this public status page.


## CURRENT CHANGE SET — v0.9.9 bounded delivery reconciliation

- Objective: stop repeated historical-operation rediscovery/state churn while preserving durable lost-ack and restart recovery.
- Baseline authority: v0.9.8 / `7e48fe1b23192064091f4c39a50c723d077f5a07`; Windows and Linux live runtime parity confirmed before mutation.
- Root cause: every periodic reconciliation cycle rediscovered every historical operation directory.
- Change: discover historical operations once at manager startup; thereafter reconcile only the tracked set. New operations are already added at start; failed/unresolved delivery stays tracked.
- Regression: focused async/HTTP/correlation suite PASS 14/14; second historical reconciliation requires checked=0 and unchanged state mtime.
- Stream incident: ChatGPT host/UI stream termination remains OPEN as a separate boundary. v0.9.9 reduces avoidable Commander I/O pressure but does not claim to control host-side thinking/stream expiry.
- Current gate: exact candidate full Windows check/test/audit, commit/push/tag/release, candidate-first promotion, then Windows/Linux live parity and post-promotion no-churn verification.
- FINAL status: UNPROVEN until those gates complete.


## CURRENT CHANGE SET — v0.9.10 receipt-backed corrupt-projection recovery

- Objective: eliminate the remaining repeated reconciliation of 22 unreadable historical operation projections without deleting evidence or replaying effects.
- Baseline authority: v0.9.9 / `a0f577b4943f6ae93c34a5795df3fc131d814dd4`, published immutable and live on Windows/Linux before this mutation.
- Confirmed production evidence: 22/22 state projections all-zero; 22/22 exact final receipts; 22/22 exact request mappings and correlations.
- Change: exact evidence-backed reconstruction with content-addressed corrupt-byte backup; mismatch remains fail-closed.
- Validation: focused suite PASS 16/16; real-data copy recovery 22/22 with tracked=0 and no invalid cases.
- Current gate: full cross-platform candidate qualification → commit/tag/release → candidate-first rollout → live tracked=0 verification.
- FINAL status: UNPROVEN until those gates complete.


## CURRENT CHANGE SET — v0.9.11 ChatGPT-first / No-Codex Commander invariant

- Objective: prevent Remote Commander from consuming Codex/model-provider quota unless the user explicitly leaves Commander for an external Work/Codex handoff.
- Trigger: live R28 executor audit proved a Commander-launched private Codex CLI was using ChatGPT Plus Codex/agentic allowance.
- Root cause: Full Power auto-provisioned `provider=codex` and general script execution did not prohibit indirect Codex launch.
- Locked policy: **Commander never launches Codex.** If Work/Codex is recommended, current chat must ask the user to choose **Move to Work/Codex** or **Continue in this chat with Remote Commander**; default is continue-chat; external handoff only.
- Implementation: Codex provisioning removed; legacy runner disabled; direct/shell/terminal/package-manager/script-mediated Codex guarded; child model credentials stripped; Plugin/MCP instructions updated; legacy Commander-private provider cleanup added.
- Focused regression: no-Codex/planner/runner **33/33 PASS**; installer check PASS; onboarding PASS; updater contract **13/13 PASS**.
- Current gate: full Windows check/test/audit → Linux exact-tree check/test/audit → commit/push/hosted CI → immutable v0.9.11 publication → candidate-first Windows/Linux rollout → live no-Codex/config/route verification.
- FINAL status: UNPROVEN until those release/rollout gates complete.


## CURRENT CHANGE SET — v0.9.13 durable task + same-conversation automation

- Previous accepted state: v0.9.12 / ChatGPT-first, no Commander-side Codex execution.
- Objective: long work returns immediately, survives stream/client interruption, and resumes reasoning in the same ChatGPT conversation when a durable event requires it.
- Architecture: MCP Tasks capability mapping + legacy operationId fallback; bounded event-driven status follow; private SQLite conversation outbox; exact existing-tab UIA delivery; workflow NEEDS_CHAT atomic pause/evidence/Brain sync.
- Failure prevention: stable event-key dedupe, no blind retry after uncertain UI send, restart receipt reconciliation, fixed anti-injection handoff envelope, no new-tab/clipboard/mouse/Codex fallback.
- Focused validation: MCP Tasks contract PASS; conversation suite PASS; feature Windows full and exact-tree Linux full PASS; feature hosted Windows/Ubuntu CI PASS before integration.
- Integration gate: full Windows → exact-tree Linux → hosted CI → immutable publication → candidate-first rollout → live canaries.
- FINAL status: UNPROVEN until integration release/rollout gates complete.
