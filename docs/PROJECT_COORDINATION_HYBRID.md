# Hybrid Project Coordination: one project, many authenticated chats

Status: source-only RC013 design and local metadata directory, NOT deployed.
This is an implementation specification, not a second project Brain, an OAuth
issuer, a release acceptance record or a new source of project decisions.

## Accepted project evidence — 20 November 2026

- Emad Commander V1 SSoT: https://app.notion.com/p/410d5b4a86f6813c88dcd3e68ed10833
  v0.12 is the integrated base. v0.13 targets multi-chat reliable delivery;
  v0.15 targets multi-device coordination; v0.16 workflow recovery; v1.0 GA.
- V1-05 Workflow Engine: https://app.notion.com/p/410d5b4a86f681d28996f1ff36d3e94a
  Reuse existing WorkflowStore, Project Engine, deterministic acceptance,
  attempt budgets, journal and root-fencing rather than a second engine.
- V1-06 Chat-bound ACK: https://app.notion.com/p/410d5b4a86f6816483e9e7d28306dda0
  Executed, delivered and originating-chat acknowledged remain separate.
- Notion / GitHub coordination: https://app.notion.com/p/400d5b4a86f681878952f8b711bfa35f
  Emad and MMZ maintain independent Free Notion spaces linked to one shared
  GitHub collaboration index. Automated bidirectional sync is NOT accepted.
- MMZ control: https://app.notion.com/p/40d0b0934cdc811e8ee5d990dcf63e48
  A management mirror, never an authority replacing the host Brain.
- Source defect: ConversationStore binds one project per scope to one chat
  (PRIMARY KEY(scope, project_id)). WorkflowStore root leases are machine
  scoped, not globally fenced across multiple hosts.
- OAuth user identity does not give access to ChatGPT conversation history,
  project membership or current chat identity automatically.

## Routing and authority

ChatGPT account A -> separate profile A / host 1 / exclusive Tunnel A
ChatGPT account B -> separate profile B / host 2 / exclusive Tunnel B
         -> protected attested tool caller -> explicit stable projectId
         -> project-scoped metadata directory -> existing project Brain/WorkflowStore
         -> exact originating-chat delivery and durable ACK
         -> GitHub shared coordination -> Notion management mirror.

The stable projectId denotes the work independent of chat continuity.
Every route retains hostId, principalId, profileId, conversationId,
bindingId and exclusive Tunnel binding. Project membership is never
a signed Worker Grant. The authenticated ingress MUST supply the route;
project owner membership MUST be independently approved. Never infer
membership from a chat title, browser cookie, arbitrary MCP arguments,
Notion text, a model plan, or the host Tunnel alone.

When a new chat appears, explicitly choose/register the same stable
projectId, reread the canonical Brain and source hashes, reconcile the
current writer lease, and resume the smallest accepted next action.
Handoff text and Notion are untrusted status data, not instruction authority.
Never broadcast an execution receipt to all project participants.

Existing WorkflowStore has local SQLite root fencing; it is not a cross-host
global coordinator. Cross-host mutation remains DISABLED until a real
central coordinator with monotonically increasing fencing is introduced and
tested. GitHub Issues and Notion cannot serve as low-latency transactional
locks; use them as evidence and human-review surfaces.

## RC013 implementation increment (source only)

The additive ProjectCoordinationDirectory in
src/project-coordination-directory.mjs uses built-in Node SQLite.
It requires injected, authenticated caller and owner-membership callbacks.
It stores local project metadata and multiple exact chat memberships,
rejects stale/unknown/cross-project identity, and journals idempotent
OBSERVED evidence IDs. Raw API keys, ChatGPT transcripts and binding IDs
are not stored. Snapshot explicitly returns executionAllowed:false and
globallyFencedWriter:false. It never dispatches a tool, issues a Worker
Grant, or writes a Notion page.

The companion test/project-coordination-directory.test.mjs covers
two chats plus another account, replay, revocation by rotated binding,
canonical root conflict, stale identity, restart and private storage.
No live OAuth, signed Worker or ChatGPT delivery tests have been passed.

## Integration stages and acceptance

1. Connect the directory to genuinely attested ingress identity and
   explicit project-owner consent; preserve unique Tunnel/API key per account.
2. Migrate ConversationStore to a multi-chat relation keyed by project,
   account, profile, conversation and binding, preserving old records,
   UNCERTAIN outcomes, exact destination and authenticated ACK.
3. Keep one source writer per project root with a real global fenced lease
   for cross-host mutation, else allow read-only/proposal participants.
4. Expose authenticated data-only project join/status/resume, resolving
   next action from the accepted Brain, Git HEAD and actual runner state.
5. Positive and negative live tests with two accounts, multiple chats,
   separate TunneIs, revoked membership, restart, lost ACK and no replay.
6. Perform semantic, source-backed Notion mirror updates with backoff and
   quota-aware batching; GitHub issues/PRs provide shared review.
7. Preserve one native installer lineage per OS family from one source
   commit; validate cross-distro Linux DEB/RPM/portable and Windows
   clean install, upgrade, rollback, boot/login and current profile retention.

## Free and optimized tools

Use the already installed Node/SQLite, WorkflowStore, ProjectEngine,
ConversationStore/ACK, GitHub Issues/Projects/Actions, separate Notion
mirrors and optional owner-local Ollama/llama.cpp.
LangGraph SQLite persistence is optional if durable graph-state features
are later shown to improve correctness, not a competing project Brain.
Temporal self-hosting adds a service cluster; n8n Community is free for
self-hosting but carries Sustainable Use License constraints, so neither
is embedded in the initial installer by default. Do not silently invoke
billable cloud inference. A Commander's protected connection credential
does not authorize use as an external model-provider key.

RC013 metadata tests are scoped PASS only; live protected G1/J01,
signed Worker Grant, multi-chat ChatGPT delivery, global cross-host
fencing, full Linux distro matrix and actual release remain OPEN.
