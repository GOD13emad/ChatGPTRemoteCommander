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

## Live V1 runtime readiness and request outcome (same MMZ-only bridge)

Two additional V2 tools were deployed through the independent V2 mTLS
listener after a hash-guarded install with private rollback artifacts:

- `v2_v1_live_readiness` accepts only `component=gui|browser|workflow|power`.
  The implementation calls exactly the corresponding current-user V1
  *read-only* status tool and returns only strictly validated booleans
  and the permitted SQLite integrity enumeration. No raw V1 response,
  private profiles, browser tabs, workflow goals, file data, process
  lists or credentials cross into the unauthenticated V2 response.
- `v2_v1_request_status` accepts only an opaque UUID returned by
  `v2_request_owner_tool` and reports pending/expired/uncertain/returned
  state, never the original tool parameters or results. A returned V1
  RPC does not certify that a long-running effect completed.

The native owner-executor now fsyncs the containing receipt directory
after an exclusive pre-dispatch receipt write, BEFORE calling V1.
Recovery tests refuse replay when only that pre-dispatch marker exists.
The request-status tool reports `DISPATCH_STARTED_OUTCOME_UNKNOWN`
rather than falsely inferring success. The owner CLI remains the only
real invocation path for queued sensitive tools and requires the same
independent native confirmation as before.

**Verified native live endpoint:** 8 MCP tools present. All four
`v2_v1_live_readiness` components succeeded against the real MMZ V1,
without leaking raw private fields. Unsupported `run_shell`
component and unknown status UUID both fail closed. Direct V2
`run_shell` still denied. V2 tunnel /readyz returned HTTP 200;
V1 Core and V2 Coordinator remained active after deploy.

**Isolated positive QA:** A second local V2 mTLS listener on port
55593 with separate owner-private QA queue received a test proposal
for the real V1 `system_status` tool. A TEST HARNESS substituted
`requireOwnerConfirmation:true` for this NON-SENSITIVE QA call
only (not a real owner login/approval), forwarded to the actual
V1 local MCP, observed the returned receipt via V2, and verified
exactly one invocation and that replay was denied. QA success is
**not** real user approval, authenticated per-chat V2 execution or
proof of effect completion for arbitrary tools.

The V2 source pilot server `tools/v2-mmz-pilot-server.mjs` is an
installation-layout entry template: it is copied to the installed
V2 ReadOnlyMcp directory, where its local `./src` and
`./v2-readonly-tools.mjs` imports resolve. It is not directly runnable
from `tools/` in the source checkout without staging those sibling
dependencies. Regression test imports the portable pure modules;
live QA imports the exact installed server.

The next open gate remains trusted owner-session-to-tool authorization
for unattended private read/write/Shell/GUI/Workflow. Both OS privileges
and V1's native session consent still apply; NoAuth tunnel/mTLS transport
does not prove a ChatGPT user or desktop owner.

## Owner-native KDE confirmation for low-risk V2-to-V1 diagnostics

A separate optional owner-local GUI command provides a practical consent
surface on the MMZ Linux KDE desktop without requiring an open terminal:
```bash
node "$HOME/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-v1-owner-cli.mjs" approve-gui REQUEST_ID
```

The local CLI reviews the actual queued request and only permits one of
`system_status`, `gui_status`, `browser_status`,
`workflow_health` or `power_status`, each with EXACTLY `{}`
arguments. The KDE `kdialog --inputbox` shows the requested tool and
full UUID. It accepts only deliberately typed
`APPROVE <first-eight-UUID-characters>`; clicking OK without the
phrase, cancelling, a missing GUI session, or any non-zero process
result denies the request. The command uses `execFile`, never a shell.

All other tools (including unrestricted shell, file writes, process
control, GUI input, browser input and workflow execution) remain
excluded from this single-step GUI review and must use the existing
full exact-argument native terminal review or a future separately
verified owner-grant flow. A KDE dialog is same-UID user interaction,
not a cryptographic physical presence or per-ChatGPT-conversation
identity proof. V1 host permission and same-session consent remain
independent. No remote V2 MCP endpoint can invoke or auto-accept the
dialog; there is no popup triggered merely by anonymous requests.

Test source: `test/v2-native-owner-dialog.test.mjs`, including
blank/incorrect code, denied tools, arguments, invalid UUID, and
native callback failures. Never use simulated confirmation from QA
as evidence of a real user's approval.

## KDE on-demand owner review launcher — MMZ Linux

The manually launched desktop application **Commander V2 - Owner Review**
opens the owner-native pending-request selector; it does not start a
background poller or automatically approve requests. Its installed desktop
entry is `~/.local/share/applications/commander-v2-mmz-owner-review.desktop`
and its controlled entry point is
`~/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-v1-owner-cli.mjs review-gui`.
This route uses the already-installed owner-private queue; it does not
reconfigure or restart the existing V1 and V2 MCP servers.

Only live queued requests for fixed no-argument diagnostics
(system_status, gui_status, browser_status, workflow_health, power_status)
are displayed. The selector validates the opaque UUID, then independently
requires the typed `APPROVE <UUID-prefix>` phrase in the existing KDE
per-action dialog. Selection alone never dispatches the V1 tool. NoAuth
remote requests cannot invoke the native desktop chooser, confirm it,
or obtain the raw V1 result. Expired requests are not eligible.

The user may open the KDE launcher while physically using the MMZ
desktop; remote ChatGPT timeouts need not keep a kdialog alive. However
queued requests expire after ten minutes and must be resubmitted when
expired. The launcher is not an unattended privilege bridge and
does not assert owner identity for other ChatGPT conversations.

Source and verification:
`src/v2-native-review-picker.mjs`,
`test/v2-native-review-picker.test.mjs`,
`assets/commander-v2-mmz-owner-review.desktop`, and the existing
`tools/v2-v1-owner-cli.mjs`. Test suite scope: 322 tests,
321 PASS / 0 FAIL / 1 SKIP, source runtime Node v24.22.2.
Native desktop launcher validation and module checks succeeded.
Production owner confirmation and actual V2-to-V1 local action
remain unverified until the owner responds in the GUI and a
final dispatch receipt is observed.

## V2 transient tunnel recovery and visible KDE review outcome (2026-11-01)

The existing V2 ChatGPT MCP tools temporarily failed with `Session terminated`
even though the local V2 listener passed HTTP 200 and its authenticated mTLS
`tools/list` returned 8 tools. The V2 tunnel service journal showed multiple
upstream Control Plane poll timeouts (10 in the observed short interval).
V1's three tunnel readiness endpoints all remained HTTP 200.

After confirming the dedicated V2 tunnel's persisted `LoadCredential`
configuration, **one** owner-user `systemctl --user restart
commander-v2-mmz-tunnel.service` restored the ChatGPT V2 tool invocation.
The remote `v2_readonly_status` and `v2_v1_request_status` both returned
success after the restart. No V1 service or credential was restarted,
extracted or changed. This is a confirmed transport recovery, not proof
that the external Control Plane's underlying timeout cause is eliminated.
Do not loop restarts for future unrelated errors without rechecking logs
and local vs remote health.

The existing `Commander V2 - Owner Review` application now provides
fixed, owner-local KDE message boxes when no eligible diagnostic review
exists, after a V1 RPC returns, or when outcome remains failed/uncertain.
This prevents a `Terminal=false` desktop launcher from hiding the only
human feedback in stdout. The error message explicitly avoids claiming
that an uncertain dispatch had no effect. No private command arguments,
response bodies or credentials are shown in these generic status boxes.
The selector and typed exact-UUID approval remain separate; there is no
automatic or background approval. The change touched only the user-local
CLI and selection UI module, not the live MCP server or V1.

Regression suite on MMZ Linux: 323 tests, 322 PASS / 0 FAIL / 1 SKIP,
operation `e93edf87-4fea-4d92-869a-7dce0edc1e0c`, exit 0.
Installed owner-local CLI and review-picker module are byte-identical to
the source after a hash-preconditioned atomic install, with prior copies
retained in the existing owner-private QA location. Production review
and V2-to-V1 invocation still require an explicit native owner action:
expired proposals are not retroactively approved.

## First observed production owner-reviewed diagnostic V2 → V1 (2026-11-01)

ChatGPT V2 submitted the exact request
`d394406e-d1b0-4c49-9302-2a49a41a8425` for the
non-mutating V1 `system_status` with empty arguments. A separate
owner-local native review execution subsequently produced all three
private, mode-0600, same-owner records under the existing V2
`v1-tool-review` root:

- `requests/<id>.json`: named tool `system_status`, empty args
- `receipts/<id>.json`: pre-dispatch marker `DISPATCHING_UNCERTAIN`
- `final/<id>.json`: durable `V1_CALL_RETURNED` receipt

The active V2 ChatGPT tool `v2_v1_request_status` reported
`V1_CALL_RETURNED`, `v1CallReturned=true` and
`verifiedEffect=false`. The V1 call-returned state was still readable
after the V2 MCP server restart; the prior request was NEVER replayed.
This closes the **single non-sensitive owner-reviewed V2-to-V1 RPC
return gate**. The records show the native owner approval path
completed; they are not cryptographic evidence of physical presence
nor proof that any general long-running effect completed.

A user-visible inconsistency was corrected: the native queue
`list()` previously showed the immutable pre-dispatch marker as
`DISPATCHING_UNCERTAIN` even when the final receipt existed. It now
uses the validated final receipt for completed or uncertain entries,
while leaving pending requests untouched for KDE review. The
`inspect()` pre-dispatch marker remains immutable for forensic
recovery. The source and deployed V2 bridge both now match SHA256
`3df548e094c2f197f1a625ad9fe5f2ee1583650d802b023851f543ac3224ac80`.
Regression tests include successful and uncertain final receipt
reconciliation, non-replay, and no direct noauth dispatch. V1 remains
untouched; V2 coordinator, MCP and tunnel remained healthy after this
scoped deploy.

DoD **not** closed: V2's unattended, privileged Shell/file/GUI/browser
and Workflow invocation from an arbitrary ChatGPT NoAuth session.
This still requires a real trusted per-caller identity and scoped
owner grant, or independently reviewed native per-action execution
under the V1 effective OS and desktop permissions.

## Advanced on-device V1 tool review — MMZ Linux (2026-11-01)

The user-local KDE application **Commander V2 - Advanced Owner Review**
was installed as a separate opt-in path for the full V1 tool catalog.
The existing diagnostic-only **Commander V2 - Owner Review** launcher
remains unchanged. This provides an owner-facing request-and-review
workflow for arbitrary V1 tool names already visible in the local V1
catalog, without claiming that the eight noauth V2 MCP tools gained
unattended Shell/filesystem/browser/GUI privileges.

From ChatGPT V2, `v2_request_owner_tool` may queue a named, bounded
JSON request, without dispatching it. On the MMZ KDE desktop the
advanced launcher:
1. Lists only pending, unexpired, valid UUID requests.
2. Shows the **complete exact tool and arguments** in a scrollable native
   `kdialog --textbox` preview backed by a mode-0600 owner-private
   temporary file in the Linux owner runtime directory (fallback to
   V2 owner-private state).
3. Requires the owner to type `EXECUTE <first-8-UUID-chars>` in a
   **separate** native input dialog. Selection, closing the preview,
   pressing OK with a blank/wrong phrase, or absence of the GUI refuses
   the call.
4. Revalidates the request, current local V1 catalog and expiration
   immediately before the original one-shot native V1 dispatcher,
   retaining V1 OS capability checks and native GUI session consent.

The reviewed exact parameters are never included in the noauth
`v2_v1_request_status` response. The temporary preview file is
unlinked after ordinary review completion/denial; a forced process
kill may leave a user-private temp file until owner runtime cleanup,
so the default location is an ephemeral user runtime directory when
available. The owner should not place credentials in queued arguments.
The pre-dispatch receipt prevents automatic replay of unknown
operations, and a returned V1 RPC is still **not** verified completion
of a potentially long-running effect.

Source:
`src/v2-native-advanced-review.mjs`,
`test/v2-native-advanced-review.test.mjs`,
`assets/commander-v2-mmz-advanced-review.desktop`, plus scoped
updates to the existing local CLI and picker. Validation included
four targeted advanced review tests and the complete V2 suite:
327 tests, 326 PASS / 0 FAIL / 1 SKIP.
The launcher and modules were installed with exact hash preconditions
and private rollback copies; V1 and the V2 MCP/tunnel services remain
active, V2 tunnel /readyz returned HTTP 200. **No real shell, file,
process, workflow or GUI operation was approved or executed during
this installation.**

Open DoD: a real owner-approved *sensitive* action with independently
verified result and final receipt; trusted per-ChatGPT-caller
authentication and scoped grants for unattended private tool calls;
native GUI consent for the actual owner desktop when needed. NoAuth
tunnel identity is not equivalent to ChatGPT-user identity.

## MMZ V2-to-V1 Shell request identity repair (2026-11-01)

The owner-reviewed V2 `run_shell` request `65da89bc-ea41-469d-ab31-374c202a56f5` has a durable final status `V1_TOOL_REPORTED_ERROR`; it was not replayed. A separate bounded V1 diagnostic confirmed `MUTATION_REQUEST_ID_REQUIRED` for a command without `requestId`, and success for a benign one-time command with a valid request ID. The historical V2 final receipt did not preserve V1's textual error code; its exact cause is therefore inferred from the independent diagnostic rather than proven by that receipt alone.

The native owner executor now binds a deterministic `v2-<request UUID>` to tools whose live V1 input schema declares a string `requestId`. This bound value appears in the exact local owner review before approval. After approval, the same effective arguments and source request are revalidated; drift denies execution. Caller-supplied mutation IDs are refused. This does not change the V1 service or enable unapproved calls. The previous failed operation is immutable and must not be retried.

Code: `src/v2-v1-idempotency-bindings.mjs`, `src/v2-v1-owner-executor.mjs`, and `tools/v2-v1-owner-cli.mjs`. Targeted regression: 22 PASS, zero failures. V2-only installed files were verified against source hashes with prior copies retained. New live `run_shell` success remains unverified until a different, explicitly approved request returns and its effect can be checked.

## V1 Shell completion classification without repeated owner prompts (2026-11-01)

The V2-only native owner CLI now records a narrowly typed, non-sensitive Shell completion category in **new** owner-private final receipts: `EXIT_ZERO`, `EXIT_NONZERO`, `TIMED_OUT`, `TOOL_ERROR`, or `UNKNOWN`. It obtains this category from V1's real structured `run_shell` result (`exitCode`, `timedOut`, and `signal`), without storing `stdout`, `stderr`, private paths, process metadata or token contents. The V2 public request-status tool reports only that category plus existing receipt state; `verifiedEffect` remains `false` because a zero process exit does not attest arbitrary external side effects. Existing historical receipts are preserved without rewriting or guessing their exit codes.

Installed modules are `src/v2-v1-result-classifier.mjs`, `src/v2-v1-tool-bridge.mjs`, `src/v2-v1-owner-executor.mjs` and `tools/v2-v1-owner-cli.mjs`. The deployment used exact SHA-256 precondition checks, owner-private rollback copies and a restart of only `commander-v2-mmz-readonly-mcp.service`. V1, the Coordinator and the dedicated tunnel remained active with `/readyz` HTTP 200. The installed server retains the existing 8-tool list; **no ChatGPT Refresh Tools or native owner action is required** for this change.

Validation: full V2 regression `node --test test/v2-*.test.mjs`: 334 total, **333 PASS, 0 FAIL, 1 SKIP**, durable operation `7ecbdc49-94d9-48df-90f2-d1d8f3633262`. A separate real V1 local MCP invocation of the harmless `true` command returned process exit 0; the installed source classifier returned `EXIT_ZERO` (`V2_SHELL_COMPLETION_REAL_V1_PROBE_PASS`). Live V2 request-status reads of historical Shell calls report `UNKNOWN` for successful returned RPCs that lacked exit metadata and `TOOL_ERROR` for V1 reported tool errors. An expired unexecuted file-read request is still `EXPIRED` with no command execution. No sensitive new operation was approved or run through the V2 noauth endpoint.

The still-open product gate is **per-caller authenticated/authorized execution** of private V1-equivalent Shell, file, GUI, browser and Workflow operations. The noauth transport alone is not a user identity; it cannot safely be converted to unattended private actions by treating an old review receipt as a persistent grant. Existing owner-issued V1 permissions remain available directly through the connected V1 plugin, with no additional V2 approval prompts.

## Owner-user local gateway to the full existing V1 tool catalog (2026-11-01)

**User objective:** Commander V2 on MMZ Linux should support the same effective current-user commands as V1 without repetitive ten-minute native-review prompts. The first verified step is a V2-owned, **LOCAL ONLY** native gateway that invokes the existing V1 loopback MCP under the same Linux UID. It neither configures V1 nor exposes full-control tools from the V2 *NoAuth ChatGPT MCP* endpoint.

Installed owner-local files:
- `~/.local/share/CommanderV2/ReadOnlyMcp/src/v2-v1-local-owner-gateway.mjs`
- `~/.local/share/CommanderV2/ReadOnlyMcp/tools/v2-v1-local-owner-cli.mjs`

From the authenticated local `mmz` user session, the CLI supports `node <installed-cli-path> list` and `node <installed-cli-path> call TOOL - < bounded-json-on-stdin`. It obtains live V1 tool schemas from loopback, injects a stable fresh mutation ID for tools requiring `requestId`, and lets V1 enforce its existing effective OS permissions and GUI/browser session consent. It does not change V1's security policy, install a new listener, use credentials from V1, or automatically approve any GUI takeover. A logged-in local user can obtain full V1 tool results; these results are not forwarded to the anonymous V2 ChatGPT plugin.

**Real native end-to-end evidence on MMZ Linux:** existing local V1 exposes **125** tools, and the V2 local gateway enumerated exactly 125. `run_shell` on benign `true` returned `exitCode=0`, `timedOut=false`, `signal=null`, and `isError=false`. `read_text` returned a bounded excerpt from the existing V2 project documentation with `isError=false`; no document mutation. `gui_status` reported `available=true`, `consentRequired=true`, and `consentedSessionActive=false`; `browser_status` returned `available=true`, `enabled=true`; `workflow_health` returned `ok=true`, `databaseIntegrity=ok`; and `power_status` returned no tool error. This is **native local gateway parity**, not proof of direct ChatGPT-V2 tool execution nor live GUI input.

New files: `src/v2-v1-local-owner-gateway.mjs`, `tools/v2-v1-local-owner-cli.mjs`, `test/v2-v1-local-owner-gateway.test.mjs`. Focused local gateway unit tests: five PASS. Complete V2 source suite: **339 tests total / 338 PASS / 0 FAIL / 1 SKIP**, durable execution `fe504aae-b65c-4d85-8690-fb7a6aeea8a7`, exit 0. The combined test+`git diff --check` wrapper in operation `582c0794-1882-4002-b54d-a483e446e867` exited 2 solely because the pre-existing, owner-modified `docs/PROJECT_BRAIN.md` contains legacy whitespace; the independent full test rerun completed with exit 0 and the changed source paths passed isolated diff checks. Do not edit or normalize unrelated owner Brain changes to silence an unrelated whitespace warning.

**Remaining final ChatGPT V2 gate:** authenticated remote calls. The current V2 tunnel securely authenticates its transport client by mTLS, but that is not cryptographic identity of the ChatGPT principal. To deliver remote direct full-power tools without per-call owner prompts, wire the existing V2 OAuth/JWT/owner-session/grant registry resource-server candidate to a trusted issuer and an owner-approved persistent grant, preserving V1 user-level privileges and native same-session GUI consent. No issuer/login and no owner-chat attestation are yet configured on the V2 installation; the NoAuth 8-tool remote surface must not be mislabeled as full-control. OpenAI's custom MCP guidance permits noauth and OAuth, but private user operations require a deliberate authentication and authorization boundary. This is a one-time connection / owner grant concern, NOT a request for repeated manual command approval.

## Authenticated ChatGPT V2 -> complete V1 tool gateway candidate (2026-11-01)

**Current ChatGPT app settings verified:** the private `Commander V2 MMZ` plugin already has the app-specific permission **Allow all actions**. App permissions alone cannot authenticate the actual ChatGPT caller at the remote V2 resource server. The current 8-tool NoAuth V2 connector and its owner-private mTLS transport remain unchanged.

New source candidate (not attached to an active network listener):
- `src/v2-oauth-v1-parity.mjs` joins a verified OAuth bearer (`issuer`, `audience`, expiry, required scopes, subject), an independently signed ChatGPT-conversation/native-seat assertion, V2's existing scoped durable grant registry, machine-global resource lease and durable mutation receipt to the already verified owner-local V2->V1 gateway. The V1 tool's own OS and GUI consent rules still apply. The V1 mutation ID is deterministic for one separately attested operation; callers cannot self-assign another conversation or owner route.
- `src/v2-oauth-v1-mcp-dispatcher.mjs` offers the single **OAuth-protected** MCP surface `v2_v1_protected_call` with a `commander.full` scope. Missing/invalid tokens receive an OAuth challenge. A denied native session or absent/revoked permission returns a fixed denial without misleading re-login prompts or leaking tool arguments. This is NOT registered in the current NoAuth MCP `tools/list`.
- `test/v2-oauth-v1-parity.test.mjs` and `test/v2-oauth-v1-mcp-dispatcher.test.mjs` include synthetic signed native-session claims, positive scoped-grant execution, durable one-call semantics, revoked-grant denial, malformed token/route rejection and exact action binding. **The test owner authorization and test OAuth issuer are synthetic**, never deployed identities.

Verified complete V2 source test suite: **346 total, 345 PASS / 0 FAIL / 1 SKIP**, durable operation `b4962cbf-b6fc-482f-ad23-5a3b4c011075`, exit 0. No new real V1 privileged action was executed to test this OAuth candidate, and no popup was requested from the user.

**Deployment gate OPEN:** the MMZ installation has no configured real OAuth issuer/JWKS and no platform-attested, owner-authorized per-conversation binding. The live installed V2 MCP currently has no candidate OAuth dependency tree. Therefore this code is committed as an isolated, tested source candidate only; deliberately do not install it as a half-wired runtime module or advertise a protected action to the NoAuth ChatGPT plugin. Once a real provider is selected/configured, use the existing V2 OAuth provider preflight, signed JWT verifier and owner-native session/grant components, then stage the protected ingress with its own HTTPS/resource metadata and full test gates before switching any production tool list. This is a **one-time OAuth connection and scoped owner grant**, not repetitive approval of every command. The protected parity gateway wraps the existing durable mutation receipt store: the first fully authenticated action may return private V1 data transiently, but durable receipts persist only a bounded outcome with privateOutputStored=false and optional Shell completion category; cached/repeated requests never rerun the tool or reveal the original private output. The tests verify a private stdout marker is absent from the SQLite receipt bytes. Owner-private filesystem ACLs, retention, per-user identity proof and real provider-issued grants remain production acceptance gates.

References: OpenAI Plugins Authentication (`https://developers.openai.com/plugins/build/auth`) and Add custom MCP server (`https://developers.openai.com/api/docs/guides/custom-mcp-server`). ChatGPT does not accept arbitrary user-supplied bearer headers as a replacement for its OAuth connection flow.
