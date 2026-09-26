# v0.9.4 host-schema compatibility fix plan

Status: isolated branch only; no production release published.

## Verified live failure

On 2026-09-26 the Linux host `mmz-LOQ-15IRX9` reports ChatGPT Remote Commander `0.9.4`, profile `FULL_POWER`, `filesystem.full`, `shell.unrestricted`, `process.control`, GUI control and durable workflow capabilities enabled. Read-only tools work, but every direct mutation attempted through the currently cached ChatGPT connector schema fails before effect with:

`MUTATION_REQUEST_ID_REQUIRED`

The connector schema exposed in the current conversation does not include a `requestId` property for legacy mutation tools (`run_shell`, `start_terminal`, `write_text`, etc.), while the live 0.9.4 server dynamically adds optional `requestId` to its own tool catalog and then passes missing values into `MutationIdempotencyStore`, which requires a valid id. This is a host-schema/back-end compatibility regression, not a permission failure.

## Relevant code path

`src/server-v0.3.mjs` validates the old-host argument object successfully because `requestId` is optional. `executeTool()` then destructures `requestId` and calls durable mutation idempotency. If the host did not know about the new field, the store receives `undefined` and rejects the call.

The HTTP handler already has stable identities available through `x-request-id` and JSON-RPC `message.id` (`acceptedTrace()` records both). The permanent compatibility fix should therefore preserve explicit caller-supplied idempotency keys while supplying a bounded, stable, hashed transport/RPC-derived fallback only when the legacy host omitted `args.requestId`.

## Required behavior

1. Explicit `args.requestId` remains authoritative and unchanged.
2. If absent, derive a compatibility request id from validated transport request id, otherwise validated JSON-RPC id.
3. Hash the source identity into the existing mutation-id pattern/length constraints instead of passing arbitrary header text.
4. Apply the same effective request id to direct mutations and auto-deferred `copy_path` / `move_path` / `delete_path`.
5. If neither transport nor RPC identity exists, fail closed rather than inventing an unstable retry key.
6. Add regression tests for a legacy host tool call that omits `requestId`, duplicate retry of the same transport/RPC id, explicit request-id precedence, and missing-all-identities failure.
7. Run `npm run check`, `npm test`, `npm run audit`, MCP conformance and updater/schema continuity gates before promotion.

## Separate desktop-stability findings

The host also recorded GNOME Shell failures. `Lockscreen Studio 1.1.2` produced a disposed `St.Widget` lifecycle exception immediately before one session failure and has been disabled. A separate earlier `XTEST/FakeInput` crash was observed; legacy `xdotool` injection and Commander GUI takeover were temporarily fail-closed while root cause is qualified. Astra Monitor is healthy in the current session and is not designated for removal. Theme Manager does not need Lockscreen Studio for wallpaper/lock-screen image authority because it already writes the native GNOME screensaver/background keys directly.

No release/tag should be published from this branch merely to work around one host. Candidate-first qualification is required before any stable release.
