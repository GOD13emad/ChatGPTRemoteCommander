# Local single-owner login: concrete protected issuer design

Status: SOURCE CANDIDATE; 15 contract unit cases passed with ephemeral fixture keys. No OAuth endpoint, token issuer, owner credential, protected signer or operating-system enrollment is active. This design replaces the unavailable third-party account with a local owner identity; it does not substitute an unsigned local file for authorization.

## Architectural amendment: use documented client authentication

The OpenAI authentication documentation supports CIMD and `private_key_jwt`. A real token request may therefore authenticate the OAuth client by a signed assertion verified against the CIMD public JWKS. It need not supply an undocumented ChatGPT-signed chat/session JWT. OpenAI/session/conversation identifiers are correlation only. mTLS remains a documented alternative or extra defense; it is not a mandatory blocker when an admitted signed client assertion is available. A TLS-terminating tunnel must not manufacture certificate headers as client identity.

The exact active connection's CIMD URL, JWKS URL and callback must be obtained from its management page and protected admission. Do not guess that its callback is the stable form. Issuer identification metadata and the `iss` authorization-response parameter must agree. The public CIMD describes client identity, not the local owner's identity or consent.

## Principals and storage

* The OAuth issuer is local to this machine but exposes a stable HTTPS issuer/resource URL through the existing approved transport. ChatGPT cannot exchange its server-side code against this user's loopback address. Changing transport or connection registration is a separate reviewed step.
* Reuse the existing SYSTEM broker boundary after reviewing its exact script, task arguments, interpreter, loadable code, DACL and enrollment. Add fixed auth actions rather than a shell endpoint. The current broker does not implement any of them.
* Keep owner credential public key/credential ID, RP ID, policy catalog, issuer signing key, revocation epoch and transaction database in protected storage inaccessible to ordinary FULL_POWER code. No browser process receives the issuer signing key. Protect authority-bearing code and database together; moving only the key is insufficient.
* Windows Hello/WebAuthn holds the owner's private credential. The application never obtains a PIN, biometric, password or OTP. A non-exportable CNG key is not automatically a user-presence key; do not replace the WebAuthn ceremony with silent CNG signing or current-user DPAPI.

## Preferred first-owner route when the enrolled owner is an administrator

Proposal: reuse a reviewed, protected, compiled consent helper launched by real Windows UAC. This avoids requiring a new Hello credential or RP bootstrap. It is not implemented by this JavaScript kernel. The existing filtered FULL_POWER token is not accepted as elevated authority.

The SYSTEM broker stores the immutable pending request and creates an expiring single-use native-consent nonce. The parent-controlled launch asks Windows to elevate the exact protected helper. The broker independently checks the connected helper using held kernel process/pipe handles: PID, native creation time, exact protected image/hash and expected arguments, session, same enrolled owner SID, actual token elevation/admin membership and integrity. A client JSON `elevated:true`, an unprotected binary with the same name, a reused PID, or a different administrator entered into a credential prompt cannot satisfy these checks. The task/script/catalog and consent helper must all be protected from the filtered owner token. The source stage does not claim these peer/token checks are implemented.

That protected helper reads the request from the broker, displays exact client/resource/profile/root/actions/scopes, and requires the owner's explicit decision in its elevated UI. UIPI reduces lower-integrity input injection; it does not prove a cryptographic physical click or defeat an already elevated administrator. The helper returns only the broker nonce and decision. The broker signs only its stored immutable request digest after consuming that nonce; there is no caller-provided statement/sign endpoint. A compromised elevated same-owner administrator is the authority root, not an adversary this scheme claims to isolate. Native qualification must verify cancellation, non-admin/different-SID rejection, counterfeited helper and no silent approval before this route can authorize anything.

For a non-administrator owner or a policy requiring hardware-backed verification, use the following separately enrolled Hello/WebAuthn route. No fallback to a checkbox is permitted. Choose one reviewed route explicitly rather than treating a missing Hello credential as a reason to bypass owner verification.

## Optional Hello/WebAuthn owner ceremony (not executed)

1. After source/package review, the parent presents one exact protected-broker enrollment request and rollback. The owner performs the required native approval. No key or grant exists before that ceremony. Enroll only the machine's actual intended owner SID, expected protected code chain and canonical HTTPS issuer/RP ID.
2. Through a dedicated local owner-session native helper using Windows WebAuthn APIs, or the admitted HTTPS browser origin, request a platform credential with user verification REQUIRED and a fresh broker-issued challenge. The protected broker, not an untrusted browser, fixes the owner, RP, expected origin, challenge, enrollment epoch and expiry.
3. Verify registration with a maintained WebAuthn implementation: challenge, exact origin, RP ID hash, algorithm/credential public key and attestation policy. Persist only public credential metadata in protected storage. Do not implement CBOR/attestation parsing ad hoc in this prototype. Synced passkeys and authenticator attestation need explicit local policy; do not assume they prove machine-bound Windows Hello.
4. A fresh authentication assertion must pass the complete WebAuthn verification algorithm, including signature, challenge, origin/RP, UP and UV; signature counters are advisory according to authenticator semantics. A browser assertion proves user verification, not that a user read a transaction summary. High-risk grants remain disabled until the protected consent display and owner approval policy have been separately reviewed. An ordinary same-user HTML/WinForms checkbox is not such a boundary.

Loss/recovery: no unattended reset, no fallback password, no auto-reenrollment. A protected owner recovery ceremony increments enrollment/revocation epoch and invalidates grants, codes and refresh families. Preserve running jobs; revocation blocks new calls, never repeats or terminates existing operations.

## Connect and authorize

1. Publish RFC 9728 protected-resource metadata and RFC 8414 issuer metadata at the stable HTTPS endpoint. Advertise authorization-code/S256 and the methods actually implemented. The future server should choose CIMD + `private_key_jwt`; no DCR endpoint is advertised by this candidate.
2. Fetch only the admitted exact HTTPS CIMD/JWKS locations with SSRF/private-address/redirect/size/time guards and a reviewed rotation policy. Never fetch a URL from JWT `jku`, `x5u` or an MCP parameter. Pin issuer, client ID, allowed redirect URI and metadata origin through protected admission. Remote key rotation is not a silent client-policy change.
3. The request binds exact client, redirect, resource and an owner-approved grant policy. The broker resolves that policy to scope, profile, root-policy identity and action allowlist. No raw filesystem root, executable or arbitrary scope is accepted from the browser. Generate random pending identity/nonce and a short-lived digest; durable protected storage must commit the pending transaction before presenting consent.
4. Show the exact requesting client/redirect domain, profile/root and action/scopes in the trusted local consent flow. Use the explicitly enrolled real-UAC protected helper route, or the optional Hello/WebAuthn route over a challenge bound to that immutable transaction. The protected broker signs a short-lived consent envelope only after the selected owner verification and reviewed consent decision. It never offers `sign(arbitraryCallerBody)` or an `approved:true` input.
5. The source kernel validates that envelope cryptographically, consumes its request/receipt once, and mints a short-lived S256-bound code. Future HTTP integration redirects only to the exact admitted callback with `code`, original `state` and issuer identifier; use no-store and no-referrer protections. An invalid initial redirect is rejected locally, not redirected.

## Exchange, use and revoke

* Token endpoint: form parameters must be parsed with duplicate-key rejection and strict body limits. Authenticate `private_key_jwt` against the admitted client's public JWKS, with exact `iss=sub=client_id`, exact token endpoint `aud`, bounded `iat/exp`, algorithm allowlist and atomic `jti` replay protection. CIMD identity alone does not prove that a request possesses that client's private key.
* Atomically consume code, check exact client/redirect/resource and S256 verifier, verify current owner epoch/grant revocation, then ask a fixed protected signer to issue access claims. This candidate stops here with `tokenIssued:false`; it does not issue a JWT or bearer token. Production consume/sign/crash semantics require a durable protected transaction store and bounded reconciliation, never a public retry that reauthorizes a consumed code.
* Access claims bind issuer, resource audience, owner subject, client ID, enrollment epoch, grant ID, profile, root policy, scopes and actions, plus short lifetime and token ID. The resource server verifies signature/issuer/audience/time and current revocation/policy on every call; token passthrough is forbidden. Scope never bypasses existing operation/no-replay/GUI guards.
* Refresh is not implemented. Before advertising it, add protected refresh-family storage, atomic rotation and reuse detection that revokes the family, while preserving existing work. No long-lived unsigned session cookie substitutes for it.
* A protected owner-authenticated revoke action invalidates the grant/epoch immediately for new calls; a signed revocation envelope is unit-tested here. It does not Cancel/Stop/Retry jobs. mTLS optional, client private-key assertion, access token signature and owner consent solve different identities.

## What is implemented now, and the next unavoidable gate

`oauth-transaction-kernel.mjs` implements strict transaction validation, actual fixture-tested asymmetric receipt/client-assertion verification, scope/root/profile/action binding, S256, single-use state and revocation. There is no injected accept callback and no default positive path. Its in-memory maps are deliberately not production storage. Passing arbitrary public-key configuration to a new same-user instance does not enroll a real owner or make that instance authoritative.

Next blocker: review and implement fixed protected broker owner enrollment + selected native owner ceremony + transactional signer/store adapters. For the preferred administrator route this means real UAC and protected helper peer/token verification, not mandatory Hello enrollment. Then parent may open a concrete native approval UI for the owner. The selected actual owner ceremony and active ChatGPT client registration require owner action and cannot honestly be completed by fixture tests. No third-party provider account is required by this design. No OS service, key, credentials, installed Commander or running work was changed.

## Primary sources read for this design

* [OpenAI authentication: CIMD, S256, private_key_jwt, issuer identification and mTLS](https://developers.openai.com/plugins/build/auth)
* [RFC 7636: S256 PKCE](https://www.rfc-editor.org/info/rfc7636/)
* [RFC 8707: resource audience binding](https://www.rfc-editor.org/info/rfc8707/)
* [RFC 9700: OAuth security practice](https://www.rfc-editor.org/info/rfc9700/)
* [Microsoft native WebAuthn APIs and Windows Hello](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/webauthn-apis)
* [W3C WebAuthn registration/assertion verification](https://www.w3.org/TR/webauthn-3/)
* [Microsoft UAC token/consent behavior](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works)
* [Microsoft token elevation type](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_elevation_type)
* [Microsoft SendInput integrity/UIPI restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

These sources establish protocol choices; they are not evidence of this machine's enrollment, real OpenAI assertions, user-presence acceptance or production authorization.
