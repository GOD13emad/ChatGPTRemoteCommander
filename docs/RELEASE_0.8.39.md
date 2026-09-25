# v0.8.39 qualification

Status: CANDIDATE, 2026-09-25.

v0.8.39 is the hardened successor to the unpublished v0.8.38 browser candidate. The annotated v0.8.38 tag is intentionally not moved because it points to the pre-hardening release commit.

This release adds direct-session **background-first browser automation** that is independent of Codex. Commander uses its own Chromium profile and CDP so ordinary web navigation, DOM reads, form filling, clicking, waiting and screenshots can run without moving the user's mouse, stealing focus, typing into the user's browser, reusing the user's normal browser profile or extracting saved passwords.

When background operation reaches a genuine physical-presence boundary such as MFA, WebAuthn, CAPTCHA or a site that rejects background/headless operation, the browser reports an approval boundary. If the current user request already explicitly authorizes mouse/keyboard or human-style interaction, that authorization can be used for the task without asking twice. After approval, the same Commander-owned profile may be relaunched visibly for the minimum required GUI step and then returned headlessly with its own session state preserved.

Browser tools remain direct-session-only. They are not granted to durable/autonomous Project Engine workflows. Navigation remains HTTP(S)-only and returned URL metadata is redacted/null-safe. Cookies, local-storage contents and password values are not exposed.

Two independent review rounds found ten pre-publication defects. Every reproduced issue now has regression coverage: instance profile namespace collisions, non-HTTP snapshot metadata, ordinary application-error helper teardown, startup request races, Chromium leakage during early initialization failure, isolated-profile residue after timeout/crash, Linux descendant shutdown, visible-relaunch recovery, foreground/background result labeling, and encoded helper paths. The final process-ownership follow-up additionally uses exact `--user-data-dir` matching so unexpected helper exit terminates only browser processes belonging to the Commander-owned profile, preserves persistent profile data and never kills prefix-sibling processes.

| Gate | Status |
| --- | --- |
| Final development-head Windows full check/test/audit | PASS — 363 PASS / 5 SKIP / 0 FAIL; GUI 75/75; security audit PASS |
| Final development-head Linux exact-commit check/test/audit | PASS — 367 PASS / 1 SKIP / 0 FAIL; GUI 75/75; security audit PASS |
| Windows native Chrome background E2E | PASS — zero foreground interaction, secret URL redaction, auth-signal detection, DOM verification |
| Crash/timeout/process ownership stability | PASS — five consecutive 9/9 focused runs plus full focused browser gate |
| PR #18 hosted Windows/Ubuntu CI | PASS — four jobs |
| Independent review rounds | PASS AS FINDINGS SOURCE — ten reproduced defects converted to regressions |
| Final external model re-review of hardened head | UNAVAILABLE_EXTERNAL_QUOTA — reviewer account returned usage-limit/retry-after; not counted as PASS |
| Exact v0.8.39 hosted Windows/Ubuntu CI | PENDING |
| Fresh/repeated pinned installers and production-isolation checks | PENDING |
| Reproducible release assets and GitHub digest match | PENDING |
| Immutable publication and Windows/Linux candidate-first rollout | PENDING |

The release does not bypass organizational monitoring, authentication policy, CAPTCHA, WebAuthn, Secure Desktop/UAC, anti-cheat/protected input or other site/OS controls. Background-first means low-interference automation, not evasive automation.

Project Engine provider qualification, Claude support, unrestricted autonomous browser authority, monetary accounting and equal-model/equal-budget superiority claims remain separate scopes.
