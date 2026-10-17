# Core Incident Reconciliation — constrained design decision

**Status:** design candidate / NOT DEPLOYED. The legacy Emad Windows and Emad Linux `PENDING_NATIVE_EFFECT` records stay untouched. The originally attempted action is never replayed.

## Acceptance contract

1. **Identity and exact effect:** choose one existing incident by opaque ID, UTC time, tool and SHA-256 of the original *bytes*. An owner account's description is a witnessed observation; it must not overwrite native result `UNKNOWN` or become a native `NOT_APPLIED` acknowledgment.
2. **Owner proof:** the review endpoint is private to a product-owned OS-local broker, outside any remotely invocable Commander MCP tool, shell or shared-user file API. A terminal `isTTY`, plaintext phrase, mutable same-user public-key file, K093 generic Hello success, or K095 diagnostic signature is insufficient. A future Windows Hello/KeyCredential flow requires protected key enrollment and product-issued one-time challenge, independently validated freshness/nonce, and incident-specific consent. Additional OS principal isolation is required if the threat model includes a hostile process with the same Windows user rights.
3. **One writer for the desktop:** reuse the existing Windows native `Local\\ChatGPTRemoteCommander.GuiInput` named mutex, but it currently guards only native helper dispatch. A product coordinator must make all profiles cooperate from *pre-dispatch state check through native outcome persistence*, and the reviewer acquire the same exclusive authority before any archival. On Linux add a semantically equivalent OS-session/desktop lock. Migration must prevent stale binaries from acting outside the new protocol. No guessing that a file lock in a disconnected fixture makes active native dispatch quiescent.
4. **Durable, crash-safe transitions:** `PENDING_NATIVE_EFFECT` -> `REVIEW_PREPARED` -> `REVIEWED_WITH_UNKNOWN_NATIVE_OUTCOME`; corrupt or interrupted state -> `RECOVERY_REQUIRED`. Write private bounded receipt and fsync before moving original; retain exact original bytes, integrity hash and trusted broker context; use exclusive archive names, same-volume rename and readback. Do **not** call the sequence globally atomic on Windows just because one rename is atomic. Test crashes before/after each durable step; never interpret a missing pending file alone as permission.
5. **Controller readback:** a fresh controller must check pending/transition journal plus native worker quiescence under the same authority. Release input only for a terminal, authenticated reviewed state and no in-flight input. Manual rollback never replays the original command and never removes an unverified record.
6. **Scoped tests:** cross-process race (two chat profiles; helper in-flight during review), power-cut/crash windows, forged proof and same-user file edits, stale SHA, corrupt/symlink/hardlink, candidate updater NoPromote, actual owner-local UI under target session, live post-deploy observation while preserving existing other-chat leases.

## Existing assets and decision

- Keep K088 native incident preservation and diagnostics. K089/K094 fixture cases contribute negative tests and crash scenarios; they do not themselves establish native desktop coordination.
- Do not enroll another K095 diagnostic key or merge its experimental RSA attestation into the product. A valid signature under an independently untrusted public key proves no owner identity.
- Preserve PR #249's read-only observation behavior after security hardening; remove its direct `store.review()` and insecure `--review` path before any merge. A future reviewed transition requires a separate, acceptance-gated native broker + coordinator.
- Keep existing PRs, live GUI incident, profile processes and installed version untouched during this evaluation. This design is not production acceptance.

## Threat-model limit

A remote Full Power shell running as the same OS account can edit user-writable files and invoke same-user processes. JS-only UI gating is **not** an OS security boundary. Do not advertise cryptographic or hardware-backed owner authorization until a distinct OS trust boundary is independently verified. The named mutex is a coordination primitive, not an identity proof.
