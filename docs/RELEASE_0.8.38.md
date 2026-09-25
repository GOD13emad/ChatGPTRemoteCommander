# v0.8.38 qualification

Status: CANDIDATE, 2026-09-25.

v0.8.38 adds a direct-session background-browser layer so web tasks can run without taking over the user's shared desktop when Chromium automation is sufficient. It is separate from the optional Project Engine and **does not require Codex**.

The default order for web interaction is:

1. use a Commander-owned headless Chromium profile through CDP;
2. continue in the background while navigation, DOM reads, form fills and clicks are sufficient;
3. if MFA, WebAuthn, CAPTCHA, saved-user-browser credential state or a site policy genuinely requires physical-presence interaction, report an explicit approval boundary;
4. after current-task authorization, temporarily relaunch the **same Commander-owned profile** visibly, use the existing GUI takeover lease only for the minimum required interaction, then return the same profile headlessly.

The user browser's normal profile and password store are not reused or unlocked. Password values, cookies and local-storage contents are not exposed through browser tools. Query strings and fragments are redacted from returned URLs. Existing user-browser saved passwords are not copied; an approved one-time login may instead establish cookies in the Commander-owned persistent profile for later background work.

Browser tools are direct-session-only in this release. They are not added to durable workflow execution, so a background Project Engine run cannot silently browse or submit external sites. Uncertain navigate/fill/click outcomes require a fresh snapshot before another mutation.

| Gate | Status |
| --- | --- |
| PR #16 final-head Windows full check/test/audit | PASS — 351 core PASS / 5 platform-or-privilege SKIP / 0 FAIL; GUI 75/75 |
| PR #16 final-head Linux exact-commit check/test/audit | PASS — 355 PASS / 1 platform SKIP / 0 FAIL; GUI 75/75 |
| Windows native headless browser E2E | PASS — Chrome 154; no foreground interaction |
| Helper EOF cleanup and same-profile relaunch continuity | PASS |
| PR #16 hosted Windows/Ubuntu CI | PASS — four jobs |
| Exact v0.8.38 release Windows/Ubuntu CI | PENDING |
| Fresh/repeated pinned installer acceptance | PENDING |
| Reproducible release assets and GitHub digests | PENDING |
| Immutable publication and Windows/Linux candidate-first rollout | PENDING |

This release does not bypass organizational monitoring, endpoint controls, authentication policy, CAPTCHA, WebAuthn, Secure Desktop/UAC, anti-cheat/protected input or other site/OS restrictions. Background-first means low-interference automation, not hidden or evasive automation.

Project Engine provider qualification, Claude support, broader autonomous browser authority, monetary accounting and equal-model/equal-budget superiority claims remain separate scopes.
