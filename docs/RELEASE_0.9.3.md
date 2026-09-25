# v0.9.3 qualification

Status: CANDIDATE, 2026-09-25.

v0.9.3 is the Linux-completeness milestone after the immutable published v0.9.1 release and the unpublished v0.9.2 installer-cleanup candidate. It preserves the v0.9.0/v0.9.1 Full Power Project Engine and retry/transport behavior and closes two live Linux parity gaps without weakening foreground or process-safety policy.

## Scope

- Preserve persistent terminal workloads across a validated Linux route cutover. A terminal-bearing previous backend is retained only after its routed HTTP inflight count reaches zero, recorded in a durable retained-backend registry, detached from route.previous, and protected from release cleanup. It is never killed merely to complete an update.
- Add a safe Linux Firefox WebDriver background-browser backend. Existing Chromium/Chrome remains preferred when present; otherwise an existing Firefox + geckodriver pair is used. Firefox Snap profiles live under its permitted ~/snap/firefox/common/... root.
- Keep Chromium/Chrome behavior unchanged on Windows. Windows continues using its existing Chrome background backend.
- Do not use --no-sandbox, do not install a browser globally, and do not require sudo. An attempted private Chrome-for-Testing path was rejected after CDN geoblocking and Ubuntu AppArmor sandbox restrictions made it unsuitable.
- Preserve Standard authority, explicit capability opt-outs, custom/no-start isolation, one-writer-per-project-root, durable recovery, and no-blind-retry semantics.

## Confirmed development evidence

- Linux retained-backend registry + updater contracts: 12/12 PASS on Windows development host and 12/12 PASS on the Emad Linux laptop exact branch commit.
- Linux candidate-only full updater with terminal-retention change: PASS before Browser integration.
- Firefox 156.0.1 + geckodriver 0.37.1 manual WebDriver probe: session creation, navigation, JavaScript execution and screenshot PASS.
- Product-level Linux Firefox integration test: controller status/session/navigate/snapshot/Unicode fill/click/wait/screenshot/end PASS.
- Existing Windows Browser implementation remains Chrome/CDP and focused browser/updater regressions pass.

## Failure records converted to guards

- Playwright 1.63.0 package installation succeeded, but its Chromium CDN returned HTTP 403 location blocking; the dependency was rejected from the release design.
- A privately extracted Google Chrome package could be verified but could not use its SUID sandbox without root; Ubuntu 24.04 AppArmor also blocked unprivileged user namespaces. --no-sandbox was rejected as an unsafe product default.
- Firefox Remote Agent direct raw-WebSocket probing was not adopted. The supported Firefox + geckodriver WebDriver path was proven instead.
- Ubuntu Snap Firefox rejects arbitrary /tmp/hidden profile roots; v0.9.3 supplies a Snap-permitted owned profile root when that packaging model is detected.

## Gates

| Gate | Status |
| --- | --- |
| Focused retained-backend + Browser regressions | PASS in development tree |
| Linux Firefox background-browser real E2E | PASS on Emad laptop |
| Windows full npm run check / npm test / npm run audit | PENDING |
| Linux full npm run check / npm test / npm run audit | PENDING |
| Candidate-only Linux production-state validation | PENDING after final v0.9.3 commit |
| Hosted Windows + Ubuntu CI | PENDING |
| Exact-tag fresh + repeated installer acceptance | PENDING |
| Reproducible 13-asset release bundle | PENDING |
| Immutable GitHub publication | PENDING |
| Windows + Linux candidate-first live rollout and post-cutover canaries | PENDING |

No live-state claim from Saeed's physical computer is used as release evidence. The capability-parity requirement comes from the Work-created configuration observed on the accessible Emad Windows PC.
