# Opt-in project execution engine — current policy

> **v0.9.11 policy:** Remote Commander does not provision, authenticate, or launch Codex. Legacy Codex runner configuration is migrated fail-closed. Normal project reasoning stays in the current ChatGPT conversation. A user may explicitly choose an external Work/Codex handoff in chat, but that handoff occurs outside Commander.

The engine connects a bounded planner to existing journaled Commander tools and independent acceptance checks. It can execute an explicitly enrolled project, inspect progress, stop safely, and finalize a verified artifact. It does not supply a new model or establish superiority over other agents.

## What runs

1. A caller creates a workflow with a goal, acceptance criteria and atomic steps.
2. A caller explicitly enrolls that workflow using `workflow_run_start`, supplying immutable checks and bounded action/time limits.
3. Each `workflow_run_tick` reserves a durable planner attempt and provider-call budget, obtains a JSON proposal, validates current control/revision/policy, and invokes at most one `workflow_call` or an explicitly enabled prerequisite insertion.
4. When all steps have receipts, a separate deterministic verifier checks every acceptance criterion. Its file hashes must still match finalization evidence. Model text saying "done" does not complete the workflow.
5. The existing Brain synchronization records the accepted final state.

An enabled scheduler can tick enrolled runs only when `runner.autoTick=true`. Existing workflows are never automatically enrolled. Full Power migration does not enable or auto-create a model provider. From v0.9.11 the default runner is disabled; recovery/readiness remains available without external model delegation.

## Operator configuration

Merge this fragment into the existing, approved `durableWorkflows` configuration. Every runner tool must also exist in the containing workflow `executionTools` policy. A mismatch fails startup rather than broadening authority.

```json
{
  "runner": {
    "enabled": true,
    "autoTick": false,
    "provider": {
      "kind": "command",
      "executable": "/path/to/explicitly-trusted-non-model-planner",
      "timeoutMs": 30000,
      "maxOutputBytes": 2097152
    },
    "allowedTools": ["list_directory", "read_text", "file_info", "write_text", "create_directory"],
    "maxActions": 32,
    "maxDurationMs": 300000
  }
}
```

`autoTick=false` requires explicit ticks. `autoTick=true` permits scheduler-triggered execution of enrolled runs when the existing scheduler is enabled. Invoking `workflow_scheduler_tick` explicitly can also execute an enrolled step when autoTick is enabled; that tool's annotations accurately mark it as a mutating, external action.

Commander does not use Codex authentication or model quota. An explicit `command` provider is operator-supplied local code and must not be a Codex wrapper or a script that launches Codex. Provider errors block the run with a bounded error code. The engine never silently substitutes a model/provider.

Supported providers under the current policy:

- `codex`: **FORBIDDEN in Commander**. Configuration with `kind="codex"` or a Codex executable/path is disabled/fails closed. Use the current ChatGPT chat for reasoning; an optional Work/Codex handoff requires explicit current-chat user choice and occurs outside Commander.
- `command`: an explicitly trusted operator executable with fixed argv, JSON context on stdin, and a JSON proposal on stdout. It is not automatically discovered or created. It must not launch Codex.
- `claude`: reserved but fails with `PLANNER_PROVIDER_UNAVAILABLE` pending separate qualification. No automatic model substitution is performed.

Model selection may be explicitly set as `provider.model`. Planner processes have timeout, output size and cancellation bounds. Provider calls may consume the account's normal quota. A run budget limits attempts, planner invocations, plan extensions and wall time, not currency or model tokens. Optional [proposal teams](PROJECT_ENGINE_ADAPTIVE.md) reserve all worker/coordinator calls before invoking any provider.

## Tools

When configured, four additional tools appear:

| Tool | Purpose |
|---|---|
| `workflow_run_start` | Enroll an exact workflow revision with run ID, independent checks, action/provider-call limits and duration |
| `workflow_run_status` | Inspect run state, reserved attempts, receipts, blockers and verification |
| `workflow_run_resolve` | Record an explicit answer to an exact open input request; queue the same run without refilling its budgets |
| `workflow_run_tick` | Execute at most one planner/tool action or perform independent finalization |

`workflow_control` pauses/resumes/cancels the underlying workflow. Control intent has its own persistent generation, independent of scheduler enablement. Pause/cancel stops new effects and survives late receipts. An already dispatched effect is allowed to settle; its lease is not released just because the user pauses. Unknown effects remain uncertain and must be reconciled.

Reusing the same run ID returns the existing run and does not replenish budgets. A terminal blocked run is not silently restarted. Correct the issue and explicitly create a new run ID when appropriate. Structured questions instead enter `WAITING_INPUT`; an explicit, revision-checked response can resume the same run while preserving its original deadline and consumed budgets. See [durable decisions](PROJECT_ENGINE_DECISIONS.md). External changes to the goal, steps, authority, model profile or runner policy invalidate the old run's planning assumptions. An engine's own journaled prerequisite insertion can update its plan fingerprint only through a matching durable receipt and unchanged scope.

## Independent checks

Each zero-based acceptance criterion must have exactly one check:

```json
[
  {"criterion":0,"type":"text_includes","path":"report.txt","text":"Required result"},
  {"criterion":1,"type":"json_pointer_equals","path":"metrics.json","pointer":"/failed","value":0}
]
```

`file_sha256` additionally supports exact expected bytes via a SHA-256 value. Every path is project-relative. Checks reject traversal, aliases, hardlinks and nonregular/oversized evidence; reads are revalidated. Results store hashes and statuses, not file content. At most 20 distinct evidence files are accepted by the workflow finalizer. These checks prove only the stated predicates. A document containing a sentence is not thereby scientifically or commercially correct; define appropriate acceptance criteria.

Checks are immutable for the enrolled run. The planner sees them but cannot edit them. Ordinary `workflow_finalize` remains a caller-attested operation for compatibility; the project engine re-verifies its own checks even if another caller has already marked the workflow complete.

## Observation and recovery

Steps currently represent one atomic tool operation each. Read/list steps record typed path references. Before later planning, the engine re-observes those references through the same scoped read-only host policy. It does not persist raw file outputs. This supports inspect-then-edit across process restart without treating an old transcript as current state. Observations are bounded to 20 references and 64 KiB; oversized input stops with an explicit context limit instead of silent truncation.

Run budgets and attempt reservations live in a private `project-runs.sqlite` beside the existing workflow store. Planner claims are exclusive within that database; a live process's claim is not stolen on a timer. Effect receipts remain in the existing workflow journal. Recovered uncertain effects are never automatically repeated. Isolation is not machine-wide across separate profiles/databases or arbitrary shell processes.

Allowed autonomous actions intentionally exclude GUI takeover, unrestricted shell, process termination, deletion and terminal control in this increment. `run_project_command` can be enabled only with an explicit runner `commands` list of exact program/argv pairs, in addition to the host allowlist. Commands are not OS-sandboxed by the project path boundary.

## Isolated qualification

`npm run test:project-engine` runs deterministic regression fixtures. `node examples/project-engine/run.mjs` demonstrates a full fixture planner → journaled file write → independent check → Brain/finalization cycle in an owned temporary directory.

`--codex` live-provider qualification is historical and must not be used under v0.9.11 policy. Use deterministic fixtures or an explicitly trusted non-Codex command provider for development tests.

The roadmap in `PROJECT_ENGINE_ROADMAP.md` tracks broader providers/integrations and comparative benchmarks. Milestone 4A adds [bounded prerequisite insertion and parallel proposal workers](PROJECT_ENGINE_ADAPTIVE.md). Unrestricted plan rewriting, parallel mutating project workers, automatic scientific validation, monetary accounting and general terminal reattachment remain outside the v0.8.37 scope. Milestone 4B.2 adds only the bounded artifact-worker boundary described below.


## Bounded artifact workers (4B.2)

v0.8.36 introduced the **opt-in artifact worker** boundary. v0.8.37 keeps it disabled unless explicitly configured inside an already enabled project runner and hardens import invariants found by independent review: a ready receipt remains bound to its delegated workflow step; absolute coordinator targets are accepted only when canonical containment keeps them inside the project root; and the documented 64 KiB artifact ceiling now fits through bounded proposal/context/journal envelopes without relaxing the 256 KiB workflow argument ceiling.

Enable it only inside an already explicit project runner:

\`\`\`json
{
  "runner": {
    "enabled": true,
    "worker": {
      "enabled": true,
      "maxArtifactBytes": 32768
    }
  }
}
\`\`\`

A coordinator may propose \`action="delegate"\` for the current atomic step. Delegation does not dispatch a project tool. Commander reserves the provider-call budget first, creates a private per-run/per-worker directory under local project-engine state, and invokes the configured base provider with a restricted artifact contract. The worker receives no Commander filesystem, shell, GUI, process, terminal, deletion, completion or authority tool catalog. It may return only one UTF-8 text artifact through the proposal contract or block.

The worker workspace is an **application-level authority boundary, not an OS sandbox**. A trusted `command` provider executable still runs with the operating-system user's privileges. Codex is forbidden as a provider under v0.9.11. Do not treat worker isolation as protection from a malicious provider binary.

Before an artifact can affect the project, Commander verifies that its workspace path is a regular single-link file, reopens it by stable file identity, enforces the size/UTF-8/secret guards, and binds a SHA-256 receipt. The coordinator can import only the exact receipt bytes through the normal journaled \`write_text\` path. The project target is then independently reread and matched to the worker receipt before the receipt is closed. Symlink/hardlink aliases, content changes and mismatched imports fail closed.

Worker reservations and provider calls consume the existing durable planner-call budget. A crash after reservation is not blindly retried. If a process exits after the journaled project import but before the worker receipt is closed, restart adopts that exact import only when the workflow step and receipt identify the same `write_text` operation/input hash and the target bytes still match the recorded SHA-256; otherwise the run blocks for inspection. Pause/cancel/deadline checks remain authoritative while a worker provider call is active.

This increment is intentionally narrow: one private text artifact at a time, one executing coordinator, no worker-to-worker delegation, no direct project mutation by a worker, no parallel mutating workers, no monetary budget, no external notification delivery and no superiority claim.

## Primary references

- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/headless
