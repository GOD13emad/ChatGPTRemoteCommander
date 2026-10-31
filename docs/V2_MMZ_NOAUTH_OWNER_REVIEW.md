# Commander V2 — MMZ Linux, no external OAuth proposal lane

Status: **SCOPED PILOT**, not V2 production acceptance. Scope: the owner-user
MMZ Linux machine only; no changes to V1, Windows, fleet or non-owner profiles.

## Decision and trust boundary

ChatGPT Custom MCP uses the existing dedicated V2 Secure MCP Tunnel in
`No authentication` connection mode, just like the V1 transport pattern.
The tunnel runtime key authenticates its connection to the OpenAI platform;
the private local HTTPS listener verifies the separate pinned tunnel-client
mTLS certificate. **Neither establishes the end user's ChatGPT account,
conversation ID or OS desktop-owner consent.** No chat-body/header value
is promoted to such an identity.

The pre-existing diagnostic tools remain read-only:
`v2_readonly_status`, `v2_system_health`, `v2_workflow_readiness`.
The new `v2_request_owner_note` is a narrow, non-executing proposal tool:
two bounded text strings, no path, command, browser, shell, workflow, GUI,
profile or privilege arguments; at most four live requests and 32 total
unarchived records. This tool **only enqueues a proposed note** in a
mode-0700 owner-private V2 directory using mode-0600 files and a generated
unguessable request ID. A request expires in ten minutes.

An owner-side CLI can review exact proposal text and require an interactive
confirmation phrase before creating one exclusive, idempotent note in the
separate V2-local notes directory. A plain TTY and same Unix UID are an
operational user review boundary, **not cryptographic proof of physical
human presence**: another process with the same OS UID may be able to invoke
the local module. Consequently this prototype MUST NOT be reused to unlock
private workflow reads, arbitrary file writes, GUI control or shell access.
Real privileged operations still require independently verified caller
identity and native owner authorization. Do not disable accepted OAuth
guards in `v2-mcp-workflow-dispatcher.mjs`.

## Runtime layout

- Source queue: `src/v2-owner-approval-queue.mjs`
- Source MCP descriptor: `src/v2-owner-proposal-tool.mjs`
- Source pilot entry: `tools/v2-mmz-pilot-server.mjs`
- Source owner CLI: `tools/v2-owner-approval-cli.mjs`
- Installed listener: `~/.local/share/CommanderV2/ReadOnlyMcp/server.mjs`
- Installed CLI: `~/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-owner-approval-cli.mjs`
- Queued proposals and owner-only notes: `~/.local/state/CommanderV2/owner-approvals/`
- Isolated rollback: `~/.local/state/CommanderV2/QA/mmz-nooauth-owner-proposal-20261101/server-pre-nooauth.mjs`

Owner console usage, for an already submitted request:
```bash
node "$HOME/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-owner-approval-cli.mjs" list
node "$HOME/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-owner-approval-cli.mjs" approve REQUEST_ID
```

The second command requires a real interactive terminal and exact on-screen
confirmation. The server itself exposes no approve/deny/write endpoint.

## Acceptance boundaries and continuation

Core V2 source tests and the new noauth queue tests passed. The installed
MCP endpoint's mTLS-authenticated `tools/list` exposed four tool names,
and live negative tests rejected malformed proposed actions, privileged
tool names, and requests with unapproved side effects. V2 tunnel /readyz,
coordinator and V1 Core were still healthy after deployment.

This does **not** prove physical owner consent, authenticated ChatGPT
per-session identity, positive ChatGPT plugin-tool refresh/invocation of the
new tool, private workflow execution, native GUI control or fleet acceptance.
For private actions the next architecture milestone is a genuinely trusted
native approval broker and scoped time-limited one-action grants, with explicit
per-operation confirmation, rollback and verified receipts. Alternatively,
use supported OAuth 2.1/PKCE with an owner identity provider. Do not expose
arbitrary operations from the noauth proposal lane.

Official platform references:
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/build/mcp-server

## V1 capability parity bridge — MMZ local pilot (2026-11-01)

The independent V2 MCP now advertises two further tools:
`v2_v1_tool_catalog` reads only V1 local MCP tool names (125 on the
verified MMZ V1 runtime); `v2_request_owner_tool` queues an EXACT
named V1 tool call with bounded JSON arguments. These are **not 125
directly executable tools on V2**. The first is diagnostic, the second
creates a private pending request without executing the tool, reading
host results, or transferring credentials. The connection is still
`No authentication` and not an attested ChatGPT account identity.

The bounded queue resides in
`~/.local/state/CommanderV2/v1-tool-review`; exact requests are
mode 0600, directories are mode 0700. Admission checks current V1
local tool inventory and limits pending counts, argument size and expiry.
Arbitrary direct requests such as `run_shell` on the V2 MCP remain
denied. Owner-side CLI reads the exact tool and arguments and requires
an interactive, exact one-time confirmation before forwarding the
action to the existing owner-user V1 MCP. V1's **own** effective OS
token, GUI/session guards, allowlists and tool-specific permissions
continue to apply; this is not a privilege escalation or bypass.

```bash
node "$HOME/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-v1-owner-cli.mjs" list
node "$HOME/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-v1-owner-cli.mjs" approve REQUEST_ID
node "$HOME/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-v1-owner-cli.mjs" status REQUEST_ID
```

The runner persists a non-retriable dispatch-attempt marker BEFORE
calling V1. A transport interruption yields UNCERTAIN instead of
blind replay; successful V1 RPC acknowledgement is NOT evidence that
a long-running action itself has finished. V1 results are never
returned or copied into the noauth V2 client response, as they could
contain private data. A terminal in the same Unix owner account is
an operational consent mechanism, not a strong physical-person or
ChatGPT per-conversation authenticator.

**Observed verification:** V2 focused integration and regressions:
311 PASS, 0 FAIL, 1 SKIP (312 total). Deployed server
SHA256 `041f7e041b35ac77966606f463ec71389ee5cf7a4d47bfc3ed2d3758269776bf`.
On the installed mTLS local listener, `tools/list` returned six
tools, the `v2_v1_tool_catalog` call resolved all 125 V1 tools,
direct `run_shell` was rejected, malformed queued action was rejected
and V2 Tunnel `/readyz` returned 200. Services for V1, V2 coordinator
and V2 tunnel remained active. No actual owner-approved V1 tool call
through this bridge was exercised in production.

**Still open:** ChatGPT client Refresh Tools, native owner approval
of a real non-sensitive request, positive result reconciliation, and
independently authenticated/matched session grants for private
workflow, shell, filesystem or GUI auto-execution. Do not treat the
catalog count as V2 capability-parity acceptance. For actual
unattended full-control production, a proper user authentication and
authorization broker is required; transport-only noauth is insufficient.
