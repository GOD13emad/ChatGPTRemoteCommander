# Agent Capability Benchmark — 2026-09-27

## Scope

This benchmark compares ChatGPTRemoteCommander v0.9.6 with leading agentic coding/work platforms using current official/primary documentation where available. It is a capability map, **not a ranking or superiority claim**. A check means the capability is documented/observed for that product; implementation and safety boundaries differ.

Commander reference authority for this benchmark: immutable release `v0.9.6`, commit `4be0ebcd7a30b412de31e2b40f75dc3c504ec8ce`, live-qualified on the production Windows desktop and Linux laptop.

## Products reviewed

| Product | Primary execution model | Notable documented capabilities relevant here | Primary evidence |
|---|---|---|---|
| **ChatGPTRemoteCommander 0.9.6** | Owner-controlled physical Windows/Linux hosts through MCP + stable local router | Full filesystem/shell/process, durable workflows, Project Brain, native GUI/background browser, zero-downtime update, reboot/power recovery controls, lost-ack idempotency, evidence/checkpoints, completion beacon | Live system status + repository qualification; this project |
| **ChatGPT Work** | Separate cloud computer/browser | Cloud browser can read/click/type on supported public and signed-in sites; work can continue after leaving the conversation or closing the computer; pauses for input/sign-in/confirmation | https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt |
| **OpenAI Codex** | Local CLI/IDE/app plus cloud agents | Parallel agents, long-running work, skills, Automations; Codex suite spans CLI, cloud, IDE and app | https://openai.com/index/introducing-the-codex-app/ ; https://openai.com/index/unrolling-the-codex-agent-loop/ |
| **OpenAI Agents API / Computer Use** | Managed cloud agent infrastructure/API | Long-running managed agents, subagents, files/code environments, background mode; webhooks can notify external endpoints on completion; computer-use can operate browser/desktop environments | https://openai.com/index/introducing-the-agents-api/ ; https://developers.openai.com/api/docs/guides/webhooks ; https://developers.openai.com/ |
| **GitHub Copilot Agents** | GitHub cloud agent + CLI/app/SDK | Async cloud coding agent in ephemeral firewalled environment; branches/PRs; code review; CLI file/command work; SDK custom agents/MCP/hooks/sessions; app parallel sessions/automations | https://docs.github.com/en/copilot/responsible-use/agents ; https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents |
| **Claude Code** | Local terminal/SDK agent | File edits, commands, commits, session resume/continue, MCP, tool allow/deny, programmatic JSON/stream output; subagent-oriented model workflows | https://docs.anthropic.com/en/docs/claude-code/cli-usage ; https://docs.anthropic.com/en/docs/mcp |
| **Cursor Background Agents** | Cloud background agents in isolated VMs | GitHub repo clone/edit, internet access, autonomous terminal commands/testing in isolated AWS VMs | https://docs.cursor.com/background-agent |
| **Kiro** | Unified IDE/CLI/Web/Mobile agent harness | Specs, steering, event hooks, MCP, custom agents, skills/powers, subagents, checkpoints/rewind, context compaction, autonomous web sessions and PRs | https://kiro.dev/docs/ ; https://kiro.dev/docs/hooks/ ; https://kiro.dev/docs/web/ |
| **Devin** | Per-session VM + browser/IDE; automation fabric | Scheduled and event-driven automations, GitHub/Linear/Jira/Slack/CI integrations, MCP, PR delivery, parallel sessions; VM snapshots and browser automation | https://docs.devin.ai/automation-templates/linear-ticket-implementation ; https://docs.devin.ai/automation-templates/weekly-dependency-updates ; https://docs.devin.ai/onboard-devin/repo-setup |
| **Cline** | Local/remote programmable agent harness | Built-in file/shell/search/web tools, sessions/persistence/history, approval callbacks, local/hub/remote backends, scheduling/automation APIs, plugins | https://docs.cline.bot/cline-sdk/sessions |
| **OpenHands** | Local/cloud sandboxed software agent | GitHub issue/PR resolution workflow, configurable sandbox/container image, iterative review; cloud/agent-server ecosystem | https://docs.openhands.dev/openhands/usage/run-openhands/github-action |
| **Gemini CLI** | Local terminal agent | Conversation save/resume, automatic pre-mutation checkpoints using shadow Git, restore, local state; MCP ecosystem | https://google-gemini.github.io/gemini-cli/docs/cli/checkpointing.html ; https://google-gemini.github.io/gemini-cli/docs/cli/commands.html |
| **Aider** | Local terminal pair-programming agent | Tight Git integration/auto commits/undo, repo maps for context compaction, automatic lint/test workflows, scripting | https://aider.chat/docs/ ; https://aider.chat/docs/git.html ; https://aider.chat/docs/repomap.html ; https://aider.chat/docs/usage/lint-test.html |

## Capability matrix

Legend: **Yes** = confirmed current capability; **Partial** = present but narrower/different; **External** = achievable through the surrounding ChatGPT/plugin/API environment rather than Commander itself; **No/Unproven** = no current evidence.

| Capability | Commander 0.9.6 | Work | Codex | Copilot | Claude Code | Cursor | Kiro | Devin | Cline | OpenHands | Gemini CLI | Aider |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Work on owner’s **actual physical Windows/Linux host** | **Yes** | No (cloud computer) | Yes local surfaces | CLI/app local + cloud | Yes | Foreground local + cloud background | IDE/CLI local + Web cloud | VM-centric | Yes/local + remote | Local/cloud sandbox | Yes | Yes |
| Full shell/filesystem/process control | **Yes, Full Power** | Cloud-browser scoped | Yes | Yes | Yes | Yes in background VM | Yes | Yes VM | Yes | Yes sandbox | Yes | Yes |
| Native desktop GUI control on owner host | **Yes** | Cloud browser, not owner desktop | Product-dependent | Not core | Not core computer-use | Background VM browser/computer context | IDE/Web-oriented | Browser in VM | Not core | Sandbox/browser-oriented | Not core | No |
| Background/headless browser | **Yes** | **Yes** | Yes/cloud workflows | Limited by agent environment | Via tools/MCP | Yes | Web/cloud | Yes | Web fetch/browser tools | Yes in sandbox patterns | Via tools/MCP | No native browser agent |
| Durable accepted work survives chat/process restart | **Yes** | **Yes** | Yes | Yes cloud sessions | Session resume | Yes cloud | Yes sessions/checkpoints | Yes | Yes sessions | Yes | Conversation/checkpoints | Git state, less workflow durability |
| Explicit power/reboot recovery on physical host | **Yes, OS-specific** | N/A cloud | Local process depends on host; cloud survives | Cloud sessions | Local session resume, not OS boot recovery | Cloud | Cloud/local mixed | Cloud VM | Runtime-dependent | Sandbox/cloud | Checkpoint restore, not automatic boot | Git-based recovery, not automatic boot |
| Zero-downtime self-update with inflight drain | **Yes** | Managed service | Managed/product update | Managed service | CLI update; no equivalent observed | Managed cloud | Managed product | Managed cloud | Not observed | Not observed | CLI update | CLI update |
| Lost-ack mutation idempotency/reconciliation | **Yes** | Managed/undocumented | Product-specific | Product-specific | Not documented as Commander-style durable mutation receipts | Not documented | Checkpoints/hooks | Automation/session semantics | Session persistence | Iterative Git/PR | Checkpoint restore | Git commits/undo |
| Project evidence + acceptance gates + Project Brain | **Yes** | Project/work context, different model | Skills/context | PR/review context | CLAUDE.md/session context | Rules/context | Specs/steering/checkpoints/compaction | Knowledge/playbooks | Sessions/plugins | Repo instructions/config | GEMINI.md/memory/checkpoints | Repo map/Git |
| Multi-agent / parallel agent orchestration | **Partial** (builder/reviewer + coordinator, bounded) | Work orchestration | **Strong** | Parallel sessions/cloud agents | Subagent-capable | Background agents | Subagents/parallel | Parallel sessions | Programmable agents | Multi-agent ecosystem | Extensions/tools; not a main fleet feature | No native fleet |
| GitHub issue → branch/PR workflow | Via GitHub/plugin/shell, not product-native | Plugins/apps | **Yes** | **Yes, core** | Via MCP/CLI | **Yes** | **Yes Web** | **Yes** | Via tools/plugins | **Yes** | Via tools/MCP | Git-centric but not issue automation |
| Scheduled/event/webhook automation | Local scheduler; external event fabric limited | **Yes** scheduled/triggered Work | Automations/cloud triggers evolving | Automations | Via external orchestration/hooks | Automations/background | Hooks/Crew/automations | **Strong schedules/events** | Scheduling APIs | GitHub events / server patterns | Scriptable | Scriptable |
| Native external-app marketplace/connectors | **External via ChatGPT Plugins/MCP** | **Yes** | **Yes plugins/skills** | MCP/SDK | **MCP** | MCP | **MCP/Powers** | Integrations + MCP | Plugins | Extensible | MCP/extensions | Limited |
| Autonomous completion push into the **same dead ChatGPT conversation** | **No — host external** | Work surface supports continued tasks | Product-managed | Product-managed | N/A local terminal | Product-managed | Product-managed | Notifications/integrations | Hub/runtime-dependent | Product-managed | N/A terminal | N/A terminal |
| Durable completion discoverability after chat stream loss | **Yes — completionBeacon** | Yes in Work UI | Yes | Yes | Resume/session | Yes | Yes | Yes | Yes sessions | Yes | Resume/checkpoint | Git/terminal |
| Scientific/native desktop apps such as COMSOL | **Yes on owner machine** | Not physical-host native | Local Codex can act through shell, not Commander’s native GUI recovery stack | Local CLI can shell | Shell-based | VM may not contain licensed native app | Local IDE/CLI | VM environment | Local shell | Container/sandbox | Local shell | Local shell |
| One-writer project-root locking + durable uncertain-effect reconciliation | **Yes** | Not exposed at this granularity | Product-specific | Git branch/PR isolation | Not exposed as equivalent | VM/branch isolation | Sandbox/spec flow | Session/branch isolation | Session-level | Sandbox/repo | Checkpoint-based | Git-based |

## Commander strengths confirmed by evidence

1. **Physical-host breadth.** Commander directly controls the owner-authorized Windows/Linux machines, including native GUI, background browser, shell, filesystem and processes. This is materially different from cloud-only repo agents.
2. **Failure-aware durability.** Accepted work has durable operations/workflows, Project Brain, checkpoints, mutation request IDs, uncertain-effect reconciliation and bounded artifacts.
3. **Power/lifecycle recovery.** Windows BootRecovery/Handoff and Linux systemd+linger address actual reboot/power/network recovery rather than only a restarted coding session.
4. **Zero-downtime versioned routing.** Candidate qualification, schema continuity, per-profile stable routers, inflight drain and retained workload guards preserve live work across updates.
5. **Evidence-first acceptance.** Commander separates successful tool receipts from validation/acceptance and records technical evidence rather than treating “agent said done” as proof.
6. **Chat-stream loss containment.** v0.9.6 keeps direct synchronous turns short, moves long work to durable execution and exposes a bounded completion beacon through the existing `system_status` contract.

## Gaps where another product currently has a broader native surface

These are **not defects to copy blindly**; each has a different execution/trust model.

### 1. Elastic isolated cloud workspaces / agent fleet
Codex/Agents API, Cursor, Copilot, Kiro Web, Devin and OpenHands provide managed cloud/sandbox execution. Commander is intentionally physical-host-first.

**Decision:** do not recreate a cloud provider inside Commander. The minimum-sufficient design is to keep Commander as the trusted host/control plane and integrate cloud agents as optional providers/plugins when a task benefits from isolation or parallel capacity.

### 2. Native host wake/push after a dead ChatGPT conversation
OpenAI API webhooks can notify an HTTP endpoint when a background response completes, and managed Work surfaces can continue in the cloud. The current ChatGPT MCP host does not negotiate an equivalent wake/subscription path for Commander.

**Status:** `BLOCKED_EXTERNAL`. v0.9.6 closes the safe fallback: durable store + metadata-only `completionBeacon` visible through existing `system_status`. Do not fake autonomous chat wake.

### 3. Broad event/webhook automation fabric
Devin/Kiro/Work expose rich schedule/event trigger surfaces.

**Decision:** Commander’s durable scheduler is sufficient for local/recovery workflows. External event triggers should be supplied through authenticated Plugins/MCP/webhook adapters rather than an unauthenticated generic listener in Full Power.

### 4. Large parallel agent fleets
Codex, Claude-oriented subagents, Kiro and cloud platforms can run larger parallel fleets.

**Current Commander:** bounded builder/reviewer + coordinator, `maxParallel=2`, one mutation authority per project root.

**Decision:** retain one-writer mutation authority. Parallelism may increase for read-only/review workers only after provider budget/evidence isolation tests; do not trade correctness for agent count.

### 5. Long-context compaction / retrieval
Kiro explicitly documents compaction; Aider uses a token-budgeted repo map; Codex long-horizon models/products use managed context strategies.

**Open Commander work:** CSDC-020 context retrieval/compaction and CSDC-021 workflow rollover/archive. This is a legitimate next product phase after release soak, not a release blocker for v0.9.6.

### 6. Product-native issue/PR UX
Copilot, Codex cloud, Kiro Web, Devin and OpenHands have direct issue→PR experiences.

**Decision:** use the connected GitHub surface/plugin plus Commander’s physical-host evidence and local testing instead of duplicating GitHub’s collaboration UI. Add a thin durable “issue/PR workflow recipe” only if repeated projects show a real gap.

### 7. Domain-specific acceptance validators
Commander deliberately does not equate generic tests/text checks with scientific/commercial correctness.

**Open work:** CSDC-032 acceptance-strength profiles. For COMSOL/ANSYS/scientific work, validator packs should be project/domain skills backed by numerical/experimental acceptance evidence.

## Stream-error conclusion

There are two distinct layers:

1. **External ChatGPT/UI stream/session layer.** Errors such as `Resume stream unavailable` and `Stream cache expired` can occur outside Commander. Commander cannot repair or wake the dead UI stream.
2. **Commander completion layer.** This layer is now designed so a lost UI stream does not own the work. Long work is durable/background, mutations are retry-safe, outputs are bounded, and v0.9.6 exposes pending completion metadata on the next compatible `system_status` call even when the host cached an older tool catalog.

Therefore the correct success criterion is **not “the ChatGPT UI can never show a stream error.”** It is:
- no accepted Commander work is lost;
- no mutation is blindly duplicated after a lost acknowledgement;
- the next surviving turn can discover the durable completion/blocker;
- each execution turn emits a visible closeout before it ends;
- external host wake remains explicitly external until negotiated.

## Residual acceptance gates after v0.9.6

The software release can be immutable/current while these environmental/time gates remain open:

- next genuine mains outage/return must validate the corrected Windows BootRecovery path without login-dependent fallback;
- real Linux reboot/power-return should validate `linger=yes` + service/tunnel recovery;
- cumulative 24–48 h soak must complete without Commander-caused transport deadline drops or unrecoverable completion records;
- CSDC-033/034 fault-injection and multi-chat/account concurrency should continue to accumulate evidence;
- CSDC-005 native host wake remains external unless ChatGPT exposes/negotiates an appropriate task/subscription capability.

## Method decision

The benchmark does **not** justify cloning every competitor feature. The minimum-sufficient architecture is:
- keep Commander as the durable, evidence-driven physical-host execution/recovery layer;
- use ChatGPT Plugins/MCP for SaaS/app integrations;
- use Codex/other qualified providers for planner/reviewer intelligence;
- use managed cloud agents when isolation/elastic parallelism is actually needed;
- preserve one-writer and acceptance evidence as the authority boundary.

This avoids turning Commander into a second GitHub, cloud provider, browser platform, and plugin marketplace while retaining the capabilities that are uniquely valuable on the owner’s real machines.
