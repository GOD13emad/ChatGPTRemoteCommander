# Remote Commander: authenticated MCP Events boundary — development design, 2026-10-13

**State:** DEVELOPMENT DESIGN / NOT IMPLEMENTED / NOT USER-CHAT FINAL. **Primary blocker:** no independently authenticated end-user/workspace principal in the current loopback-tunnel MCP request context. This is a protocol and integration gate, not a durable queue integrity defect.

## Authority and outcome

- Stable production host `mmz-LOQ-15IRX9`: Core `v0.10.20` at `362375c464948be3001b307650c13fc3353ed05b` remains unchanged. Development baseline at `fac27971799538bfa9ced83234d096c70e54163c`, with R1 diagnostic change `f25f2af2d9a792d176f82a5a60fa7ae09ec8913d` on `audit/mmz-delivery-readiness-20261013`.
- Product outcome: **a subscribed, authenticated user receives an allowed completion event in the correct eligible ChatGPT Work chat** without reading, deleting or falsely acknowledging unrelated completion records. This cannot be asserted for ordinary ChatGPT chat.
- Evidence: `src/transport-guard.mjs` checks Host/Origin and loopback; its comment explicitly says it is **not user authentication**. `src/delivery-store.mjs` persists completion and exact correlation but identifies `TRUSTED_PROFILE_NOT_AUTHENTICATED_CHAT`; `completionBeacon.hostWakeAvailable=false`; `conversationContinuation.deliveryMode=queue-only`. These facts are deliberately not promoted to delivery acceptance.

## External method / boundaries

1. OpenAI MCP Events: https://developers.openai.com/plugins/build/mcp-events — supported in Work chats on web, desktop Work/Cloud, and dots; requires MCP `2026-07-28`, event discovery, `events/list`, `events/subscribe`, `events/unsubscribe`, verified signed callback, durable subscriptions, HTTPS and public-IP SSRF protections. A `2xx` webhook status confirms **receiver acceptance only**, not a ChatGPT response or user acknowledgement.
2. OpenAI plugin auth: https://developers.openai.com/plugins/build/auth — prefer existing OAuth 2.1 IdP with resource-server token validation (signature, issuer, audience/resource, expiry, scopes), discovery, auth-code/PKCE; client mTLS identifies the platform but **not the user**. This is preferable to custom auth, leaked API keys or assumptions about a device/profile.
3. MCP Tasks (2026-07-28) is client-driven polling/state; `tasks/get` alone is not a wake-up mechanism. Preserve current Tasks and durable delivery fallbacks; do not add an independent queue.

## Options and selected direction

| Option | Benefit | Deficiency | Decision |
| --- | --- | --- | --- |
| Keep queue + explicit user-triggered retrieval in current chat | Already safe and available; no extra network surface | Not spontaneous | **Keep** as fallback |
| Work MCP Events with verified OAuth principal | Supported event-triggered delivery to eligible subscribed Work chats | Needs connector OAuth, webhook egress, explicit Work subscription | **Candidate** for event-driven functionality |
| Scripted browser/clipboard/UI delivery or inferred conversation ID | Apparent speed | Wrong-chat/no-replay/security risk; no authenticated identity | **Reject** |
| New open/public webhook sender without principal binding | Quick demo | Cross-user data disclosure and SSRF risk | **Reject** |

## Minimum implementation sequence (single-blocker increments)

**G0 — principal binding (CURRENT, OPEN):** establish an authoritative, per-request user principal from fully verified OAuth tokens at the public HTTPS MCP gateway; no trust of `X-User`, correlationId, profile name or user-submitted project ID. Authorize the user to each project/operation before exposing a catalog or subscription. Explicitly define tenant/device/project ownership and revocation. No user OAuth token or callback secret in chat or Git.

**G1 — discovery and subscription (BLOCKED on G0):** advertise `events: {}` in `server/discover` only when its production auth/owner controls are live. Publish a minimal `operation.completed` event with required exact authorized `projectId` filter. Validate `whsec_` key (24–64 base64-decoded bytes), callback HTTPS URL, strictly public DNS/IP (initial resolution and connection), zero redirects, DNS-rebinding resistance, timeout, `2xx` plus constant-time echoed one-use challenge verification. Persist principal+event+filter+URL+secret+expiry in private 0600 storage; stable canonical identity; idempotent refresh and unsubscribe; no raw output payload.

**G2 — sender and receipts (BLOCKED on G1):** sign serialized bounded one-event payload with `standardwebhooks`, stable event ID, fresh timestamp and exact bytes; safe DNS-resolving HTTP client. Resend transient failures only with bounded backoff; never retry 410/413; at-least-once semantics with event ID dedupe. Receiver 2xx becomes `WEBHOOK_ACCEPTED` telemetry, **not** Commander `DELIVERED` (which requires an independently verified chat/user acknowledgement according to the accepted delivery state machine). Preserve existing queued results, result hashes, correlation, archive and ACK endpoints, and no-blind-replay.

**G3 — Work integration acceptance (EXTERNAL):** a qualifying user connects the authenticated plugin in an eligible Work chat and explicitly subscribes; inspect exact `server/discover`/`events/list`, subscribe challenge, filtered real completion, callback receipt, visible Work reply, unsubscribe and silent filtered nonmatch. Test restart, subscription expiry, secret rotation, revocation, invalid tokens and signatures, private/resolved-to-private URLs, duplicate and burst events. Never claim same-chat FINAL based on simulated callbacks or runner success.

**G4 — release (OPEN):** exact-SHA Windows/Ubuntu CI, Linux native canary, Windows native canary, candidate-first no-promotion/rollback checks, owner acceptance, independent cross-host state. Stable Core and separately released Browser remain unchanged until approved evidence supports promotion.

## Testable safety contract and immediate next action

- No principal => `events` **not advertised**; any attempted event subscription fails closed with no side effects; existing `system_status`, `tasks/get`, and queue operations retain their behavior. Source test must prevent false advertisement before G0.
- Healthy Core Doctor may PASS while `same-chat-delivery` is BLOCKED; `--require-same-chat-delivery` exits nonzero until real verifiable callback + host response proof exists. A successful `2xx` webhook alone is insufficient.
- `localhost` and private callbacks, redirect chains, secret-free URL, fabricated headers/IDs or unverified principals => reject, no storage and no outbound data.
- **Exact next safe action:** verify a supported OAuth/identity gateway and explicit Work event subscription capability for the intended account, then implement G0 in a separate authorized candidate with regression tests before exposing any Events method or triggering any outbound request.
