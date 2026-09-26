# CSDC Fault-Injection Matrix R1

Status: required regression matrix. PASS requires executable evidence, not document review.

| ID | Cut/failure point | Required outcome |
|---|---|---|
| FI-01 | Disconnect before durable acceptance commit | No effect starts; retry may create the job once. |
| FI-02 | Disconnect after acceptance commit but before response ack | Same requestId returns same job; no duplicate effect. |
| FI-03 | Disconnect during a read-only deferred operation | Operation remains discoverable or becomes explicit FAILED/UNCERTAIN; no silent loss. |
| FI-04 | Disconnect immediately after mutating effect starts | Never blindly replay; require authoritative receipt or UNCERTAIN reconciliation. |
| FI-05 | Worker exits after effect but before terminal state projection | Durable receipt/outbox is adopted on restart, or outcome becomes UNCERTAIN. |
| FI-06 | Commander process dies after terminal execution receipt, before delivery event | Reconciler publishes exactly one delivery event. |
| FI-07 | Delivery event committed, response to delivery_list lost | Re-read returns same event. |
| FI-08 | delivery_claim response lost | Same attemptId returns same claim without increment/renewal side effects. |
| FI-09 | delivery_ack response lost | Same attemptId returns same DELIVERED receipt. |
| FI-10 | Competing claim with different attemptId during live lease | Second claimant fails closed. |
| FI-11 | Wrong correlationId for get/claim/ack/artifact | Fail closed with no metadata/output leakage. |
| FI-12 | Delivery retry budget exhausted | Event becomes DEAD_LETTER and health surfaces it. |
| FI-13 | Artifact changed/tampered after publication | Hash/size check fails; no unverified content returned. |
| FI-14 | Result larger than chat envelope | Chat payload stays bounded; artifact is chunk-retrievable. |
| FI-15 | Result larger than artifact policy | Fail with explicit bounded code before transport breakage. |
| FI-16 | Project enters WAITING_INPUT | Durable discoverable event is produced and execution clock policy is explicit. |
| FI-17 | Project enters BLOCKED/EXHAUSTED | Durable discoverable event; no silent scheduler stall. |
| FI-18 | Provider rate/quota failure | PAUSED_QUOTA with resumable identity; no effect replay. |
| FI-19 | Project policy changes during run | Explicit migration/block event; accepted work is not silently abandoned. |
| FI-20 | Auto-update during active detached operation | Routed service updates without killing tracked effect; result remains recoverable. |
| FI-21 | Power loss during SQLite delivery transaction | Integrity passes after boot; transaction is atomic. |
| FI-22 | Power loss while artifact file is being created | No metadata may reference an unverified partial artifact. |
| FI-23 | Power loss after artifact fsync before DB publish | Orphan artifact is harmless/collectable; no false delivery. |
| FI-24 | Power loss after DB publish before chat retrieval | Event survives and is discoverable after boot. |
| FI-25 | Tunnel response deadline expires | Late response cannot corrupt later request; accepted durable work is recoverable. |
| FI-26 | Tunnel stops polling/reconnects | Local job state is independent; recovery exposes pending delivery. |
| FI-27 | Chat context/turn ends | No project state is lost; a later chat can use correlation/job identity. |
| FI-28 | Two chats submit same requestId + same input | One effect; deterministic duplicate response. |
| FI-29 | Same requestId + changed input/correlation | REQUEST_ID_CONFLICT, no new effect. |
| FI-30 | Two accounts use different correlations | No cross-correlation claim/get/ack in trusted profile boundary. |
| FI-31 | Filesystem EBUSY/EPERM transient | Bounded safe retry or explicit blocker; no infinite retry. |
| FI-32 | Network drive temporarily unavailable | Durable pause/blocker; no destructive fallback to another path. |
| FI-33 | Child process survives parent timeout | Test must fail until entire owned process tree is accounted for. |
| FI-34 | Browser auth/MFA/CAPTCHA appears | Durable escalation event; no indefinite background hang. |
| FI-35 | 24-48h mixed-workload soak | Zero silent terminal states, zero duplicate effects, zero unrecoverable delivery loss. |

## Evidence requirements

For each executable case retain:
- correlationId/requestId/operationId/workflow run ID;
- prestate hash or receipt;
- injected cut timestamp;
- post-restart status;
- effect count where applicable;
- delivery event ID/result hash;
- exact test command and exit code.

A test that merely observes "the process did not crash" is insufficient.
