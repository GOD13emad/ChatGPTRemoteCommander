# Cumulative Handoff

## Identity and environment

- Repository: `https://github.com/GOD13emad/ChatGPTRemoteCommander`
- Baseline authority: `v0.7.3` at `70e297194614b7cfd35825ba4cd9609d41e06a0c`
- Target: Windows blue/green R1, package/plugin version `0.8.0`
- Stable tunnel-facing ports: Emad `47831` (default) and `47834` (`saeed-emad`); Saeed `47831` (default)
- Tunnel health ports remain unchanged and credentials/Tunnel IDs are reused without plaintext disclosure.

## Engineering result

The target architecture separates a stable loopback router/control plane from immutable versioned release backends. Candidate backends start on private ports with the existing raw per-profile config bytes, durable workflow store, Full Power/fullFilesystem, GUI policy, and permanent-delete guard. Cutover uses an exact backend identity and pointer-generation precondition. A dispatched POST is never retried after an uncertain transport result.

## Acceptance boundary

Repository tests, hashes, ZIP integrity, and manifests prove build integrity only. They do not prove production runtime, tunnel reachability, native desktop availability, or both-PC convergence. Those remain UNPROVEN until the external deployment evidence package records them.

## Authoritative next action

First finish control-plane acceptance, stage and audit the exact tree, create the single release commit/tag, build the closed asset set, and reconcile public prerelease digests/authority. Then run that tagged, hash-verified release through the Emad canary gates. Stop on the first failed gate. Promote the identical commit to Saeed only after every Emad profile passes local checks and real-tunnel E2E; Emad primary external E2E is currently unavailable and remains a STOP for that promotion.
