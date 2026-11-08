# V1-07 Commander Worker Identity Contract

## Status and scope

This is a source-level contract, authority module, and WorkflowStore-backed durable registry implementation with regression tests. It does not enroll a production host, generate or persist a production private key, read tunnel credentials, change a tunnel profile, install a runtime, or authorize production execution by itself.

The stable Commander worker identity introduced here is distinct from the existing Project Engine run-scoped `workerId`. Integration must preserve the latter and map this persistent identity explicitly.

## Identity model

A worker registration is bound to:

- `hostId` and `profileId`, supplied by trusted bootstrap rather than an MCP/model request;
- `ownerSidHash`, the SHA-256 digest of the OS owner SID/UID observed by a native attestor;
- `deviceProvider` and `deviceIdHash`, supplied by a trusted device attestor (`tailscale` or `native-key-store`);
- `keyId`, SHA-256 of the worker Ed25519 SPKI public key;
- `grantRevision`, the positive monotonic revision of the exact V1-01 per-worker grant, included in the signed registration claims;
- `tunnelProvider`, `tunnelIdHash`, and current poll/health evidence from a trusted tunnel adapter;
- V1-01 owner context: `principalId`, `conversationId`, and `bindingId`;
- V1-01 `capabilityPolicyDigest`.

`workerId` is deterministic from the host, profile, OS-owner hash, device provider/hash, and Ed25519 key ID. It does not depend on the chat, owner-binding epoch, tunnel ID, or tunnel process instance. A regrant can therefore retain the same stable worker while creating a new signed registration under a new `bindingId`.

The tunnel ID is transport context, not device identity. The OpenAI tunnel client creates a new opaque `client_instance_id` per process for request correlation; it must not be used as a stable worker ID. Only a hash of the tunnel ID is stored. No runtime API key or raw tunnel ID is accepted by this module.

## Trust boundaries

All following functions are mandatory trusted bootstrap dependencies; none may be sourced from model output, tool arguments, a public HTTP body, or an untrusted project file:

- `resolveOwnerContext()`: must return the current native owner-attested route and V1-01 `bindingId`;
- `resolveOwnerGrant(identity)`: must resolve the owner grant from the native grant registry and bind the exact worker key, device, tunnel, owner route, and policy digest;
- `authorizeExactInvocation(route, {tool, arguments})`: V1-01 exact-invocation authority, called for registration, every worker action, and revocation;
- `resolveDeviceIdentity()`: must prove the device identity and OS owner via Tailscale or an OS-protected native key provider;
- `resolveTransportIdentity()`: must prove the exact tunnel profile, OS owner, successful control-plane poll, and fresh health/readiness;
- `resolveCapabilityPolicyDigest()`: must return the current digest from the canonical V1-01 capability policy;
- `registry`: must be a durable, machine-global, atomic registry.

The owner-grant projection includes the V1-01 `bindingId`, worker/key IDs, host/profile/principal/conversation, owner SID hash, device/tunnel hashes, policy digest, a positive monotonic `revision`, issued/expiry times, and an explicit `status` (`ACTIVE` or `REVOKED`). The authority rejects a missing/invalid revision or any status other than `ACTIVE`, and compares the full grant again after asynchronous owner authorization. The current V1-01 bridge exposes exact invocation authorization but does not yet expose this complete worker-grant projection. A native adapter is still required; this module does not invent or replace the owner authority.

## Durable registry contract

Production registry methods:

- `get(workerId)` returns the current public registration envelope or null;
- `register(envelope, { expectedPreviousBindingId, expectedPreviousState })` performs an atomic compare-and-swap for `EMPTY`, `REVOKED`, or `EXPIRED` state;
- `isRevoked(workerId, bindingId)` checks revocation for the exact owner-binding epoch;
- `revoke(workerId, bindingId, receipt, { expectedSignature })` atomically revokes the exact registration.

Implemented in src/workflow-store.mjs and src/worker-identity-store.mjs: the registry uses the existing machine-global root-leases.sqlite database, alongside root_leases, rather than creating a second database. worker_identity_events is an append-only hash-chained journal with update/delete triggers; worker_identity_registry is a checked projection. Registration and revocation use BEGIN IMMEDIATE, exact compare-and-swap, public-envelope signature/key/worker-ID verification, and post-write journal/projection readback. Journal integrity and projection consistency are checked on reads and mutations. The registry stores only the signed public envelope; the private key is never passed to or stored by WorkflowStore. The in-memory test registry remains useful only for isolated authority-unit tests. An active registration cannot be silently replaced; re-enrollment after revocation/expiry requires a different owner `bindingId`. The V1-00 owner must integrate and qualify the durable adapter.

## Authorization behavior

1. The worker private key is supplied as an Ed25519 `KeyObject` from a native key store; this module never writes or exports it.
2. The public key fingerprint determines `keyId`; the stable identity tuple determines `workerId`.
3. Registration requires an active native owner context, current owner-grant projection, fresh device attestation, fresh tunnel poll/health, and current policy digest. The Ed25519-signed registration binds the exact positive `grantRevision`; a later revision mismatch fails closed and requires a new owner-binding epoch before re-enrollment.
4. Registration itself requires exact V1-01 authorization for `worker.register`.
5. Every action reloads the registration, verifies its Ed25519 signature, checks expiry and exact host/profile/chat/binding/device/tunnel/policy scope, re-resolves the owner grant, and calls V1-01 exact-invocation authorization.
6. Trust is rechecked after asynchronous authorization to fail closed on a binding, grant, device, tunnel, or policy change.
7. Revocation requires exact V1-01 authorization for `worker.revoke`, then a durable binding-specific registry write and readback.
8. A revoked or expired registration never authorizes execution.

## Current transport evidence and limitations

The five Windows hosts have 12 observed tunnel-client processes/profiles in total. Exact-PID `tunnel-client health --require-control-plane-poll --json` checks returned health/readiness 200 and a successful control-plane poll for the 12 profiles. The local `/health/control-plane` route is available on 10 profiles; it returns 404 on the two profiles running the older v0.0.14 client. That route is diagnostic health, not a device identity assertion. The supported CLI poll result remains the transport health signal for those older profiles.

Tailscale CLI identity is available on Aliemad-Labtop, Emad-PC-Ultimate, and Emad-PC-Lite. On Windows hosts without Tailscale CLI, the tunnel client provides transport identity/health only; the stable device identity must come from the native OS-protected key provider. The process-scoped tunnel `client_instance_id` is not a substitute.

The local shell did not have the runtime API key required by `tunnel-client admin tunnels get`. No runtime or admin key was read, exported, or reused. The local health endpoint does not expose a signed device-registration assertion. Therefore the live tunnel evidence does not yet constitute worker enrollment.


## Native tunnel attestor adapter — isolated source implementation

src/native-tunnel-attestor.mjs is a dependency-injected resolveTransportIdentity adapter for the V1-07 authority. It does not invoke a shell, run tunnel-client, read environment variables, or access runtime/admin API keys. The trusted host bootstrap must supply:

- resolveOwnerSidHash(): a native OS-owner hash, not a username or profile label;
- resolveOwnedTunnelProcess(): exactly one live process, with the pinned executable path/hash, exact profile argument, PID, start time and owner hash;
- probeTunnelHealth(process): an exact-PID/profile probe proving authenticated control-plane polling and both health/readiness status 200.

The adapter rejects ambiguous profile matches, PID reuse/process replacement, owner changes during the probe, executable drift, stale/future polls, missing authentication, and any unexpected health fields (including credential-shaped extras). It re-resolves the owner and process after the asynchronous health probe. The opaque clientInstanceId contributes only to a domain-separated tunnelIdHash; it is not returned and is never used as stable workerId or device identity. A process restart therefore changes transport context and requires fresh trust evaluation.

The host adapter is still a required external integration. The current Commander program allowlist refused direct invocation of the tunnel-client binary, so this source adapter has not performed a live poll or established production tunnel attestation. Do not route around the allowlist. Synthetic tests qualify the adapter contract only.



## Cross-workstream dependencies

- **V1-01:** expose the native owner context/binding and worker-grant projection, and explicitly authorize `worker.register`, worker tool invocations, and `worker.revoke`.
- **V1-00:** provide the durable registry adapter using the existing machine-global WorkflowStore root lease and prove CAS/recovery/revocation.
- **V1-06:** add stable `workerId` and `keyId` to the signed delivery receipt claims so a delivery ACK is attributable to the enrolled worker. Current receipt source does not yet bind these claims.
- **V1-08:** package, install, and rollback the integrated adapters only after source qualification.
- **Platform adapters:** implement Windows DPAPI/TPM and Linux protected-key loading without exposing private key bytes; Tailscale identity remains an optional additional device attestor.

## Source QA

Run:

```sh
node --check src/worker-identity-authority.mjs
node --check src/worker-identity-store.mjs
node --check src/workflow-store.mjs
node --check src/native-tunnel-attestor.mjs
node --test test/worker-identity-authority.test.mjs test/worker-identity-store.test.mjs test/native-tunnel-attestor.test.mjs
```

The test registry uses only ephemeral Ed25519 keys and synthetic owner/device/tunnel assertions. Current isolated V1-07 source QA: focused authority, durable-registry and native tunnel-attestor suite **79/79 PASS**; full `npm run test:workflows` **393/393 PASS**, 0 failures/skips; `npm run check` exit 0 (one native PowerShell-only fixture skipped on Linux); `npm run audit` **SECURITY_AUDIT_PASS** over 33,172,610 Git-history bytes; `git diff --check` PASS. Coverage includes hash-chain tamper detection, separate-Node-process registration CAS, positive monotonic owner-grant revision, explicit ACTIVE status, signed registration binding to the exact `grantRevision`, fail-closed revision mismatch, current `worker.revoke` authorization on idempotent repeats, exact PID/profile tunnel health binding, executable pinning, owner/process recheck, freshness and ephemeral tunnel-instance hashing. This is source-test evidence only: no live tunnel poll, native OS key-store, accepted V1-01 owner-grant provider, Host wiring, installed runtime, or production enrollment.


## V1-01 current-source interface reconciliation (2026-11-08)

The pinned V1-01 source overlay was inspected read-only at `/home/aliemad/.cache/rc-test-tmp/v101-pinned-source-qa-20261108`. Its manifest explicitly marks the overlay non-installable and records `g1ProductionAccepted=false`, `j01NativeOwnerEnrolled=false`, `signedCurrentChatProved=false`, `realOAuthIssuerConfigured=false`, and `rolloutAuthorized=false`.

The current V1-01 APIs provide useful prerequisites, but they are **not yet a worker-grant provider**:

- `V2GrantRegistry` (`src/v2-grant-registry.mjs`, SHA-256 `fffb2c1524f4fd9553ee70736ea008791b3d892002cdb1879e62a26b26b830ff`) stores route/tool grants keyed by host, principal, profile, conversation, target and tool. `read(route, tool)` returns only status, revision, actor and updated time; `isAllowed(route, tool)` returns a boolean. It has no worker/key/device/tunnel/policy grant projection.
- `V2NativeOwnerSessionBindings` (`src/v2-native-owner-session-bindings.mjs`, SHA-256 `b945ae84d80b9c05822f7717dc1af9c50fa60c0794e8387c0a86eb4233aa7a13`) is deliberately in-memory and non-durable. `bindTrusted` returns a session handle and expiry; `resolveNativeRoute` returns only the route. It does not expose the current `bindingId` or an owner SID hash.
- `V101ProtectedRouterBridge` (`src/full-access-protected-router-bridge.mjs`, SHA-256 `736a42de2d8429bf5285efd0de2ff9d46039a2e09d37e0b99a30080c9458a129`) has a native token/chat binding internally. `verifyCaller` returns a ticketed host/profile/principal/conversation identity but omits `bindingId`; its internal ticket record holds the binding epoch. `authorizeTool` checks `grantRegistry.isAllowed(route, tool)` and calls `authorizeExactInvocation(route, {tool, arguments})`, but does not receive a worker ID or public-key identity.
- The V1-01 source manifest is explicitly a source overlay, not a production G1/J01 acceptance or installed trust provider.

Therefore V1-07 must **not** derive a worker grant from `isAllowed`, a bearer, a tunnel process ID, a profile name or a transport health response. The following exact V1-01 contract is required before native enrollment:

1. Expose a read-only native owner-context projection for the current host/profile/principal/conversation and unique `bindingId` consent epoch, with owner SID hash and expiry. It must be obtained from the trusted native owner binding, never from MCP headers/body/model arguments. Do not expose the bearer, raw session token or browser credential.
2. Add a durable, revocable per-worker grant projection keyed to the exact owner binding and worker identity. At minimum bind `workerId`, `keyId`, `hostId`, `profileId`, `principalId`, `conversationId`, `bindingId`, `ownerSidHash`, `deviceIdHash`, `tunnelIdHash`, `capabilityPolicyDigest`, revision, issued/expiry times and status. The exact revision is signed into the registration as `grantRevision`; regrant rotates `bindingId`; revocation is atomic and auditable.
3. Expose `resolveWorkerGrant(identity)` (or an equivalent trusted callback) that returns the immutable current grant and fails closed on stale, revoked, mismatched or expired fields.
4. Expose `authorizeWorkerInvocation(route, {workerId, keyId, tool, arguments})` (or compose the existing exact-invocation authorizer with the per-worker grant check) so every worker action is authorized against both the exact arguments and the same current binding epoch. Recheck after asynchronous owner-policy callbacks.
5. Keep this grant separate from the existing per-route/tool grant registry unless V1-01 explicitly extends its schema and tests. The existing in-memory owner-session binding is not a substitute for the machine-global durable worker grant.

**Ownership:** V1-01 owns the owner-context/grant/authorization API and its schema; V1-00 owns the durable WorkflowStore integration and machine-global lease; V1-07 owns native device/tunnel adapters and consumes the accepted API; V1-06 owns signed receipt/ACK binding to the resulting `workerId` and `keyId`. V1-07 remains source-only until those providers and the real G1/J01 prerequisites are accepted.


## 2026-11-08 isolated V1-07 resumed qualification

- Isolated branch: `feature/v1-07-worker-identity-20261108`, worktree `/home/aliemad/.cache/rc-v107-worker-identity-20261108`, base HEAD `fd589927d01d0d53de15a3c9ccb9663f10e7e4f4`.
- `node --check` on `src/worker-identity-authority.mjs`, `src/worker-identity-store.mjs`, `src/workflow-store.mjs`, and both worker-identity test modules: PASS. `git diff --check`: PASS.
- Owner-grant hardening: the V1-01 projection must return positive monotonic `revision` and `status='ACTIVE'`; the Ed25519-signed worker registration now includes `grantRevision`; every authorize/revoke and idempotent registration compares it with the current owner grant; the exact revision is also passed into V1-01's native invocation context. Targeted authority+durable-registry tests: **40/40 PASS**, 0 fail/skip (operation `4e024714-f2c1-49dc-bd4b-899fa64b09ba`, stdout SHA-256 `5d1253defad20f1eb1623c5714f0c4ba9e2f66ca4b5496847dafa3b61b070362`). Tests cover invalid/missing revision, revision drift after enrollment, revision change during async authorization, and current authorization for idempotent revoke.
- Full `npm run test:workflows`: **354/354 PASS**, 0 fail/skip (operation `7c1feca6-03cf-41fd-bcf5-924b665284e4`, 11.45 s, stdout SHA-256 `bb47947be7482fb377c16e5f2c3e0191badca5ad01ea3d6dc253e62d4c14d26e`). This is the full workflow suite, not the full package `npm test` or installed-runtime acceptance.
- `npm run audit`: **SECURITY_AUDIT_PASS** over 33,099,154 history bytes (operation `0f1f7b83-56c0-4362-a760-8a12a429abce`, stdout SHA-256 `3b0b114c0762c62d08e83ae49f300f0a2089cc3db65a1ee7f771e8c5d961f812`). The all-ref history scanner uses full-block PEM validation and the six-positive/three-negative current-tree controls.
- Current primary hashes: authority `6b4e90dd69bcfd5ea9ceaa015e4b50a72b84b75c50a6b851d48670f8c128ce76`; WorkflowStore `91084bd2f6ff6b0e08a6f371994df4af7f2408e1b2756b06d5d4e8573e300d39`; authority test `ade92a9bae665a2ad825f07460e8b65136aaa87c11ad61e8dd8bf1abaecb92c1`; registry test `b110591da83646a39dbb83316b11cab734148e287101750a678d62807ff799b4`; contract `281efb3e361d1943366557be2a8b058b3732a6064611c751082433d15e24b0d2`.
- This is isolated source qualification only. No production key/enrollment, native provider wiring, commit, merge, install, service or route change was performed.
- Separate V1-05 integration worktree: `node --test test/worker-identity-authority.test.mjs test/worker-identity-store.test.mjs test/workflow-store.test.mjs`: **66/66 PASS** (24 + 7 + 35).
- Separate V1-02/0.12 NoPromote worktree: focused access/payload/Windows Job receipt tests **18/18 PASS**, read-only test run only. That worktree remains untouched because the primary Commander 1 chat owns the 0.12 Stable-first path.
- No commit, merge, push, install, service change, production key enrollment, tunnel credential access or promotion occurred.
- Remaining blocker: V1-01 does not yet expose the required native owner-context/binding epoch and durable worker-grant projection. Native device-key and tunnel attestors also remain provider dependencies. V1-07 is therefore source-qualified only; production enrollment and worker execution remain blocked.
