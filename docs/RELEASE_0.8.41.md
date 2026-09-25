# v0.8.41 qualification

Status: PUBLISHED IMMUTABLE RELEASE, 2026-09-25.

v0.8.41 supersedes the immutable but unpublished v0.8.40 tag. It retains the hardened background browser and durable `operation_*` command layer, then closes the confirmed Secure MCP Tunnel retry/disconnection failure classes seen on the audited Windows deployment.

Real tunnel logs repeatedly showed `command response deadline reached; dropping without posting a response`. OpenAI's tunnel-client protocol states that the response deadline bounds the full command lifecycle and that late responses are dropped. Accordingly, this release does not “solve” the issue by blindly extending deadlines. Synchronous command/browser/planner work is bounded to 30 seconds; longer or uncertain command work is directed to durable `operation_start/status/result/cancel`.

Large-success responses are also transport-bounded. Results above 128 KiB are no longer duplicated into MCP text content when the same data is already in `structuredContent`. The final serialized MCP response has an 8 MiB safe envelope below the previously observed oversized-response failure region. A result that would exceed the envelope becomes a compact `MCP_RESPONSE_TOO_LARGE` JSON-RPC error, allowing the caller to switch to bounded/paged reads instead of losing the connection.

Fresh/custom Windows installation now treats `-SkipTunnelClient` literally: if no pinned tunnel client exists, installation continues without downloading one. Existing pinned clients are still reused when available.

The release also retains v0.8.40 receipt-first Windows operation recovery, bounded stdio drain, request-id idempotency and no-blind-replay semantics.

| Gate | Status |
| --- | --- |
| Focused retry/async regression | PASS — retry transport stress 40/40 across 10 consecutive runs; combined retry+async focused gate 14/14; >30s direct work rejected before effect; 5 MiB success; 9 MiB compact oversize failure |
| Windows full `npm run check` | PASS — 156 PASS / 4 SKIP / 0 FAIL; GUI 75/75; FS/runtime/source-integrity PASS |
| Windows full `npm test` | PASS — 377 PASS / 5 SKIP / 0 FAIL; browser/concurrency/GUI/FS/runtime/source-integrity tails PASS |
| Provider timeout-tree stress | PASS — 5/5 after correcting the test probe to the existing bounded cleanup budget |
| Repository security audit | PASS — SECURITY_AUDIT_PASS after final documentation delta |
| Remote PR / Windows+Ubuntu hosted CI | PASS |
| Exact-tag fresh/repeated installers | PASS before immutable publication |
| Reproducible 13-asset release bundle | PASS — 13 assets published |
| Immutable GitHub publication | PASS |
| Candidate-first live rollout and post-rollout tunnel canaries | OPEN at the 2026-09-25 deployment audit; both accessible Emad runtimes were still v0.8.37 |

Known scope boundary: Commander can eliminate the confirmed local/tunnel causes above, but cannot guarantee that the ChatGPT UI or upstream platform will never experience an unrelated network/session interruption. Such cases require distinct evidence and are not conflated with a local MCP PASS.

Method references:
- OpenAI tunnel-client response deadline semantics: <https://github.com/openai/tunnel-client/blob/master/docs/protocol.md>
- MCP Tasks extension: <https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks>
- Node child process lifecycle: <https://nodejs.org/api/child_process.html>
