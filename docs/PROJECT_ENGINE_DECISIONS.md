# Durable project input requests

Milestone 4B.1, included in v0.8.35. General executing workers, monetary budgets and external notification delivery are separate work.

A configured project planner can stop an atomic step with a specific question. Commander persists the request before releasing its claim and reports `WAITING_INPUT`. Waiting projects do not block the execution queue for other enrolled projects. The request is visible through `workflow_run_status` and the scheduler's blocked list; it is stored in the private project-run database, not as a credential-bearing log or external message.

## Planner proposal

Return the existing four-field proposal with `action: "block"`, `tool: ""`, a concise summary and `argumentsJson` encoding:

```json
{"request":{"question":"Which approved output wording should be used?","options":["Detailed","Concise"]}}
```

The question is required (at most 2,000 characters). Options are optional; when provided there must be 2–6 distinct strings, each at most 200 characters. No extra request fields are accepted. An empty `{}` retains the earlier terminal `BLOCKED` behavior. Uncertain effects, failed verification, policy violations and unavailable authority remain blockers; this mechanism cannot approve or replay them.

## Record an explicit answer

After obtaining the user's response, read the current workflow revision and submit `workflow_run_resolve` with `runId`, the exact open `requestId`, `expectedRevision` and `response` (at most 2,000 characters). Do not submit credentials. The secret-pattern guard is not a complete secret/PII classifier.

The operation records one response and queues the same run. If automatic scheduling is enabled, a subsequent tick can invoke the planner and execute a separately checked operation. Otherwise call `workflow_run_tick`. Resolution itself does not invoke the provider, write an artifact or change the workflow's scope or acceptance checks. It is a direct operator tool and is not available to the planner's authorized effect path.

Delivery retries with the identical request/revision/answer return the current run without refilling budgets or replacing the answer. A conflicting answer is rejected. A stale workflow revision, changed scope or provider policy, pause/cancel, uncertainty, or an exhausted deadline/action/provider budget prevents admission. A paused workflow must first be explicitly resumed through `workflow_control`.

Questions consume the already reserved planning attempt and provider calls. Waiting time counts against the original wall-clock deadline, including across restart; answering never extends that deadline. Once exhausted, use a newly reviewed enrollment only if the user authorizes a new budget. Answers are supplied as untrusted context for later proposals, not as permission to expand tool access, revise checks or claim completion. The latest ten recorded decisions enter planner context; the bounded run retains all recorded decisions in its private state.

## Qualification

Regression cases cover restart persistence, no effects while waiting, exact/conflicting duplicate delivery, concurrent resolutions, stale revision/request identity, credential rejection, pause/resume/cancel/scope/policy fences, unchanged budgets and deadline, queue fairness, and independent finalization after a valid answer. Full cross-platform release qualification is separate from focused development tests.
