# Signed runner transition — read-only preflight (experimental)

**Status:** PREVIEW ONLY / NoPromote / no production authorization. Related: #374.

The existing `tools/runner-policy-continuity.mjs` remains the only upgrade-time authority. It must continue to reject a changed runner. This module does **not** modify that guard, apply policy, restart a service, switch Stable Router, mint owner approval, or replay a workflow.

## Inputs and output

```text
node tools/runner-transition-preview.mjs /absolute/current-config.json /absolute/candidate-config.json /absolute/owner-grant.json /absolute/pinned-owner-public-key.pem /absolute/trusted-router-state/default.json
```

A successful read-only signature and policy preflight prints `OWNER_TRANSITION_PREVIEW_VALIDATED_ONLY`. Failures print one generic error code and exit 3; no executable arguments or source configuration are logged.

The owner grant contains exactly `{ "payload": {...}, "signature": "..." }`. The payload must contain `schema:1`, `intent:"owner-approved-runner-transition"`, `profile:"default"`, `activeConfigSha256` (raw current config bytes), `candidateConfigSha256` (raw candidate config bytes), `candidateRunnerSha256` (SHA-256 of JSON-serialized candidate runner), `allowedChangedFields`, `issuedAtUtc`, `expiresAtUtc`, `routerGeneration`, `activeCommit` and `approvalId`. The signature is Ed25519 over a **versioned domain-separated signing envelope** from `grantSigningBytes(payload)`: UTF-8 `RC-OWNER-RUNNER-PREVIEW-SIGNATURE-V1` followed by a NUL byte and `JSON.stringify` of alphabetically sorted `[key,value]` tuples. This is a fixed-schema preview encoding, **not RFC 8785**. The payload also contains a signed 128-bit lowercase hexadecimal `approvalId` identifying a future one-time approval operation; this ID is not consumed by the read-only preflight. A pre-established **trusted owner public key** must be passed explicitly by a trusted caller; merely supplying a public-key path is **not authentication of the owner**. A future deployment integration must bind that key to a protected, immutable installation trust anchor, not accept an arbitrary key from a caller.

The read-only preview also requires a router-state file matching the active config path and hash, exact signed router generation and active 40-character source commit. As with the public key, caller-supplied router-state paths are **not an installation trust anchor**; an independently trusted fixed routing source is mandatory before production authorization.\n\nThe preview admits only an existing, explicitly enabled, manual/non-autotick command/team runner with two workers changing planner budget **2 → 3**, and optionally the **provider argument array**. All other runner properties must be byte-equivalent as JSON objects, including allowed tools, workers, executable, enabled flags and scope. A signed file expires within **15 minutes** of issuance. Current and candidate configs must be regular, single-link, bounded files. On POSIX the approval and public-key files must be owner-only.

## Safety gaps before integration into updater

1. Provide a trusted owner identity/pinned public-key management and authenticated issuance flow. Synthetic test keys **must never** become production trust anchors.
2. Define canonical serialization and signature versioning, replay prevention and a verifier policy over stable file descriptors. Current implementation compares before/after file metadata but is not a complete mitigation against time-of-check/time-of-use races.
3. Bind permission to a specific **router generation/profile**, precisely one intended transition and audited approval identifier. Handle diagnostic and final candidate validation without approving unreviewed config drift.
4. Integrate with **both** diagnostic and final paths only after signed acceptance, all standard continuity, doctor, hardware self-test, zero-downtime routing and rollback gates.
5. Qualify Linux and Windows native authority, ownership and file-mode semantics; require independent security review.
6. Never auto-start the local model, increase tool permissions, enable Work/Codex billing, or infer visibility into arbitrary ChatGPT conversations.

No steps in this document waive the existing fail-closed `RUNNER_POLICY_CHANGED` refusal; #374 stays open until a separately reviewed and deployable owner-authorized mechanism exists.

## Tests

`node --test test/runner-transition-preview.test.mjs test/runner-policy-continuity.test.mjs`

Uses ephemeral synthetic Ed25519 keys and isolated temporary fixture configurations, not user secrets or the production config. Tests include tampered signatures/hashes, expired/future timestamps, wrong keys, forbidden privilege changes, symlinks/hardlinks and a proof that the original guard still blocks the transition. This suite runs before the main `npm test` chain.
