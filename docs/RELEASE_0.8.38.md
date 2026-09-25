# v0.8.38 qualification

Status: SUPERSEDED UNPUBLISHED CANDIDATE, 2026-09-25.

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
| Independent review of initial candidate | FINDINGS CLOSED — six profile/snapshot/process/lifecycle defects converted to regressions |
| First review-fix Windows/Linux gates | PASS — Windows 355 PASS / 5 SKIP / 0 FAIL; Linux 359 PASS / 1 SKIP / 0 FAIL; GUI 75/75; security audit |
| Independent re-review of first hardening | FINDINGS CLOSED IN FOLLOW-UP — four process-tree/relaunch/mode/path defects converted to regressions |
| Second hardening focused gate | PASS — 21/21 browser/process regressions plus five consecutive 9/9 crash/ownership stability runs; exact profile matching, descendant termination, persistent-profile preservation, Unicode/space path execution, headless relaunch recovery and native Chrome headless E2E |
| Exact hardened successor Windows/Ubuntu CI | PENDING |
| Fresh/repeated pinned installer acceptance | PENDING |
| Reproducible release assets and GitHub digests | PENDING |
| Immutable publication and Windows/Linux candidate-first rollout | PENDING |

The initial independently reviewed candidate exposed six browser lifecycle defects before publication: non-injective instance profile paths, nullable non-HTTP snapshot URLs, helper teardown on ordinary application errors, startup request ownership races, Chromium leakage during pre-attachment initialization failure, and isolated-profile residue after forced helper termination. The hardening follow-up fixes each case and adds direct regressions in `test/browser-safety.test.mjs`, `test/browser-process.test.mjs`, `test/browser-helper-init-failure-run.mjs`, and `test/browser-native-run.mjs`. Publication remains blocked until the hardened head passes Linux exact-commit qualification, hosted CI, and independent re-review. A second independent re-review then found four additional failure paths before publication: Linux forced shutdown did not guarantee Chromium-descendant termination, failed foreground relaunch could strand a visible browser, foreground operations could be mislabeled as background, and helper test runners mishandled URL-encoded checkout paths. The follow-up uses an owned POSIX process group with verified descendant termination, fail-safe relaunch rollback/headless recovery, mode-derived result metadata, and `fileURLToPath` plus Unicode/space-path regression coverage. Because annotated tag `v0.8.38` already points to the earlier pre-hardening release commit, it is intentionally not moved or published; the hardened release must use a new version/tag. The final follow-up additionally centralizes exact `--user-data-dir` ownership matching so unexpected helper exit can terminate only the browser processes belonging to that Commander-owned profile, preserving persistent profile data and avoiding prefix-sibling process termination.

This release does not bypass organizational monitoring, endpoint controls, authentication policy, CAPTCHA, WebAuthn, Secure Desktop/UAC, anti-cheat/protected input or other site/OS restrictions. Background-first means low-interference automation, not hidden or evasive automation.

Project Engine provider qualification, Claude support, broader autonomous browser authority, monetary accounting and equal-model/equal-budget superiority claims remain separate scopes.
