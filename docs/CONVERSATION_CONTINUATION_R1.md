# Native Same-Conversation Continuation — Architecture R1

Date: 2026-09-28
Status: IMPLEMENTATION CANDIDATE / NOT RELEASED

## Objective

Allow a ChatGPT conversation to hand a long-running job to Remote Commander, return a normal chat response immediately, and later continue the **same already-open ChatGPT conversation** when a durable machine event requires reasoning.

This is not a general model runner. Remote Commander remains ChatGPT-first and does not launch Codex.

## Source PoC finding

The project PoC proved that an already-open ChatGPT tab can be targeted semantically through Windows UI Automation using SelectionItemPattern, ValuePattern and InvokePattern without opening a new tab or using clipboard/mouse input. The permanent Python/ctypes bridge was not accepted as production architecture because its long-running supervisor path later showed an access-violation failure. Production therefore uses a short-lived isolated PowerShell/.NET UIA helper launched only for a bounded send/status attempt.

## External benchmark evidence

1. Microsoft Durable Task/Durable Functions: long-running orchestration checkpoints state, waits for external events, and resumes when the event arrives. External events can be delivered at least once, so event IDs/deduplication are recommended.
   - https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-orchestrations
   - https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events
2. AWS Step Functions: callback tasks pause a workflow until a task token is returned; long jobs and human/external callbacks are first-class patterns.
   - https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html
3. Temporal: task/operation handlers should be idempotent because durable services may issue retries; workflow IDs/history provide deduplication/effectively-once behavior.
   - https://docs.temporal.io/tasks
4. Microsoft UI Automation: desktop-wide UIA calls should run on a separate COM MTA thread; control-specific actions use control patterns. ValuePattern.SetValue writes editable controls, SelectionItemPattern.Select changes selected items, and InvokePattern.Invoke activates a single unambiguous action.
   - https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading
   - https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue
   - https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.selectionitempattern.select
   - https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.invokepattern.invoke

## Architecture decision

### Durable authority

- Authoritative continuation state is private local SQLite under Commander state, not project files and not chat memory.
- Project Brain remains the project-level durable knowledge/control artifact; conversation SQLite is transport/control state only.
- Every external event has a stable `eventKey`; duplicate inserts with the same key and same payload are idempotent, while conflicting reuse fails closed.
- Handoff send states: QUEUED -> CLAIMED -> SENT, with DEFERRED for known-safe retryable pre-send conditions and UNCERTAIN for post-invoke ambiguity.
- UNCERTAIN is never automatically retried. It requires explicit resolution: confirm_sent, retry, or cancel.

### Event-driven execution

- New async operations can include bounded `continuation` metadata.
- Normal completion path is event-driven from the detached worker exit; no chat-side polling is required.
- After Commander restart, a one-time discovery identifies nonterminal continuation operations. Only unresolved restart-recovery items use bounded reconciliation; this is a recovery guard, not the primary execution path.
- Workflow `NEEDS_CHAT` atomically records the project state/evidence, pauses the workflow, syncs Project Brain, and queues one idempotent conversation handoff.

### Same-conversation delivery

- Binding is explicit: project ID + canonical project root + browser + exact current tab title.
- No ChatGPT URL is opened. No new tab is created.
- No cookies, saved passwords, session tokens, browser profile secrets, or clipboard contents are read.
- Windows delivery uses a short-lived hidden `pwsh.exe -MTA` helper with UI Automation.
- The helper requires exactly one matching tab, exactly one matching composer, an empty composer, no visible busy/Stop state, sufficient user-idle time, and an enabled unique Send button.
- The helper restores the previously selected tab when possible.
- If invoke occurred but acknowledgement cannot be proven, result is UNCERTAIN, never blind retry.

### Prompt-injection boundary

Project-generated phase/summary/reason/evidence strings are untrusted status data. The actual chat message uses a fixed Commander-owned envelope instructing ChatGPT to re-read machine truth and evidence before acting. Project text cannot redefine authority, request secrets, or grant model/provider permission.

## Failure model

- Chat tab missing/minimized/user active/chat busy/composer nonempty => DEFERRED with bounded backoff.
- Duplicate target/tab/composer/send button => DEFERRED/fail closed.
- UIA helper start/timeout/after-invoke exception => UNCERTAIN where send outcome may be ambiguous.
- Process or power interruption => SQLite journal + operation receipts + event-key deduplication permit restart recovery without replaying the machine effect.
- Unbind cancels queued/deferred handoffs; an actively claimed handoff cannot be silently cancelled.
- Linux stores/queues durable continuation state but does not inject desktop UI; delivery waits for a Windows chat host.

## Minimum-sufficient controls

Deliberately not added:
- no browser-extension dependency;
- no OCR;
- no mouse/keyboard takeover;
- no fixed 20-second polling loop;
- no duplicate project-state database;
- no automatic retry after uncertain send;
- no Codex/API model execution;
- no new-tab fallback.

These controls are sufficient for the observed failure modes while avoiding parallel state authorities and unnecessary complexity.

## Validation gates

1. Store deduplication/conflict/uncertain-resolution tests.
2. Async terminal event, idempotency, restart reconciliation, unbound fail-closed tests.
3. Workflow NEEDS_CHAT + Brain + resume/cancel/restart tests.
4. HTTP/MCP schema and transport tests.
5. UIA contract/static tests; then live candidate test against a deliberately bound existing ChatGPT tab.
6. Full Windows check/test/audit.
7. Exact-tree Linux check/test/audit.
8. Hosted Windows/Ubuntu CI.
9. Candidate-first rollout with route/schema continuity and post-promotion status.
