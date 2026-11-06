# Independent protected-auth source review A

Scope: source-only adversarial review of the frozen first exchange increment. No build, elevation, protected-policy/key creation, GUI or service action was performed by this review. Fixture token signing and ephemeral public-key interop are not real owner enrollment or native authority.

Reviewed pins:

- `reviews/durable/local-owner-auth/protected-issuer-state/ProtectedIssuerState.cs`: `f9daf6bdc0a641f1527b07efadfd8f9f36cb3047e8e22b574a00fac60435cc82`.
- `reviews/durable/local-owner-auth/protected-oauth-exchange/ProtectedOAuthExchange.cs`: `385416908969335800837a4bc04341af623fd5a091ce9c00d3c9e6d54f893082`.
- `reviews/durable/local-owner-auth/protected-oauth-exchange/ExchangeJournal.cs`: `e79149d2cb090771a9705890ae113f32251d69300fcb79f739024aa8e40a91c8`.

## Finding A1: state reads consume the capacity needed to revoke

Confirmed source path: `GetFreshGrantState` calls `Reserve(rows,2)` and appends `STATE_PREPARED` plus `STATE_ISSUED`. `RevokeGrant` also requires two free rows before calling native `Revoke`. `ExchangeJournal.Reserve` admits only immediate count against1024; it does not reserve outstanding grants' terminal revocation slots. One normal token leaves5 rows (authorize2, client proof1, token prepare+issue2). After509 successful state refreshes there are1023 rows. A subsequent revoke is rejected before native revocation, despite the grant still being `CONSENT_CONSUMED`. Reads remain possible even after the300-second token expires, so the journal can be consumed by authenticated state requests beyond token lifetime. Signed state expiry still fails closed at the resource verifier; this is a concrete revocation/liveness availability defect, not proof of a token-signature bypass.

Fix target: retain terminal revocation capacity per outstanding grant before admitting new authorization, assertions or state refreshes. Deny nonterminal growth early; use explicitly designed bounded retention/compaction only with rollback guarantees. Do not remove the capacity guard. Meaningful regression: drive one actual fixture through successful issuance and valid refreshes near capacity; refresh admission must stop while `RevokeGrant` can still durably revoke. Include multiple open grants and reject a fresh assertion flood without consuming their terminal reservations.

## Finding A2: expiry is not refreshed at the decisive issuance boundary

Confirmed source path: exchange code deadline is checked before `TOKEN_PREPARED` durable IO, PKCE work and signing; `AuthenticateClient` checks proof expiry before signature verification+durable proof consumption and returns only clientId. No carried assertion expiry or final code-expiry check exists immediately before protected access-token signing. StoreB `ConsumeNativeReceipt` checks pending/receipt deadline before signature verification and consume writes. Wall-clock crossing during these steps can issue/consume after the validated deadline. This is source-level boundary analysis, not a reproduced real owner incident.

Fix target: carry validated proof/code expiries and recheck the current clock at final issuance; recheck native receipt/pending expiry immediately before consent consumption. If prepared work has crossed its deadline, preserve terminal/uncertain state and do not replay. Meaningful regression: a compile-flag-only deterministic clock moves forward after prepare/signature verification, and issuance/consumption denies. Avoid flaky millisecond sleeps and do not expose the clock hook in production.

## Qualified boundaries and remaining gates

The source has fixed nonrequest-derived protected paths, protected policy bytes/pinned P256 key identity, fixed admitted clients/scopes, S256, signed client assertions, one-use prepared-before-issue codes, durable replay hashes, terminal revocation checks, exact request/schema restrictions and compiled-out fixture entry points. These are source findings, not OS ACL/identity acceptance. Existing StoreB fixture QA33 and Node interop are parent/author evidence only; this review has not relabeled them production.

Protected owner enrollment, actual service/owner identity, protected executable and complete load-chain integrity, NativeAOT protected installation, safe HTTP adapter+dispatcher integration, cold durable rollback resistance and real core policy coupling remain OPEN. Managed DLL/key presence must not authorize elevation. Old first-increment hashes cannot qualify later changed bytes. Parent and auth author received findings before any deployment.
