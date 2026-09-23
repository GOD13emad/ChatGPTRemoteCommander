# Adaptive planning and proposal teams — v0.8.33

This increment lets the planner insert missing prerequisites and ask a bounded group of proposal workers for advice. The original executor still performs one journaled action at a time. A team does not receive additional filesystem, command, acceptance or completion authority.

## Opt-in configuration

Add these fields to an already configured `durableWorkflows.runner`:

```json
{
  "adaptive": { "enabled": true, "maxExtensions": 4 },
  "team": {
    "workers": [
      { "id": "builder", "role": "Propose the next bounded step using current evidence." },
      { "id": "reviewer", "role": "Check missing prerequisites, evidence and failure risks." }
    ],
    "maxParallel": 2
  },
  "maxActions": 12,
  "maxPlannerCalls": 36
}
```

Both features are optional and independent. Adaptive planning defaults off; omitting `team` retains one planner. Teams use the same operator-configured provider/model for every worker and the coordinator. There are 1–4 workers and at most four simultaneous worker calls. Nested teams are rejected. Roles are operator configuration, not instructions loaded from project files.

Workers receive a separate copy of the current context and return only proposals. The coordinator receives their bounded outputs marked as untrusted advice. Commander validates the coordinator's final proposal against the existing tool/schema/scope/revision checks. Worker disagreement or a suggestion does not count as verification. Worker failure cancels outstanding calls, waits for them to settle and prevents coordinator execution. Provider processes still have the limitations documented in [the engine guide](PROJECT_ENGINE.md); this is not an OS sandbox.

## Changing the plan

An adaptive proposal uses the same four-field response contract:

```json
{
  "action": "extend",
  "tool": "",
  "argumentsJson": "{\"steps\":[{\"id\":\"inspect_source\",\"title\":\"Read source.txt before writing the report\"}],\"reason\":\"The deliverable requires source evidence.\"}",
  "summary": "Insert the missing inspection prerequisite."
}
```

The engine chooses the current pending target step. The planner cannot select another target, replace completed work, edit acceptance checks, change the goal/root/model policy, remove dependencies or mark a step complete. New IDs must be unique. At most 20 steps may be inserted per extension and 100 total steps may exist.

By default, the first inserted step depends on the target's original prerequisites; later inserted steps form a chain. Explicit dependencies may reference the target's existing ancestors or earlier inserted steps only. The target retains its original prerequisites and additionally depends on all inserted terminal steps. Every inserted branch must therefore finish before the target can run.

The workflow store validates and commits one journal event using `expectedRevision`. Actual in-flight/uncertain operations and owner pause/cancel prevent a new extension. The extension method is internal to the configured engine; it is not an extra tool callable by the planner or added to the public MCP catalog.

## Recovery and budgets

The engine reserves a planner attempt and all worker/coordinator calls before invoking any provider. With two workers, each round reserves three calls. Reservations survive crashes, cancellation, worker failure and duplicate enrollment; unused reservations are not refunded. `maxPlannerCalls` counts planner invocations, not model tokens, provider-internal retries or money. It defaults to configured `maxActions × callsPerPlan`, with a maximum of 500. A caller may set a smaller run limit at `workflow_run_start`.

An extension also consumes a durable extension reservation before changing the workflow. Its intent records the operation ID, source revision and plan/request hashes. A workflow receipt records the resulting plan hash. If the process exits after the workflow commit, restart adopts that exact receipt only when the scope and current plan still match. It does not insert the same steps again or reset any budget. Pause/cancel still applies after adoption. An intent without a matching receipt blocks with an explicit status; it is not guessed successful or blindly repeated.

External goal/acceptance/authority changes invalidate the run. Attempt, provider-call, extension and wall-time limits produce explicit exhausted states. A blocked/exhausted run needs operator inspection and explicit new enrollment when appropriate; teams cannot grant themselves more budget.

## Qualification and remaining scope

`node examples/project-engine/adaptive.mjs` demonstrates a deterministic proposal team noticing a missing read step, extending the plan, reading fresh evidence, writing an artifact and passing independent finalization. The example verifies nine provider invocations across three planning rounds; it uses fixture models and an owned temporary project.

Regression tests exercise real process exit after plan commit, late pause, changed scope, malformed topology, duplicate receipts and insufficient team budgets. See [validation evidence](PROJECT_ENGINE_VALIDATION.md) for recorded results. The live-provider qualification from the first increment is not a live qualification of the new team/adaptive flow.

This is milestone 4A. It does not provide unrestricted plan rewriting, parallel mutating agents, different models per role, monetary accounting, automatic scientific validation, arbitrary retry/repair loops or a comparative superiority claim. Those require separate implementation and acceptance evidence.
