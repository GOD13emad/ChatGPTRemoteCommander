# UI R40 coordinated four-host release gate

**Status: BLOCKED — Draft candidate, not installed, not released.** This package is a read-only prerequisite for future signed auto-update, not an updater.

## Goal and DoD
Deliver Browser CEF **v0.8.2** + Windows Control Center **R34** + Linux GTK Control Center **R41** with consistent modern UI, Native STOP/Mutex, RTL/HiDPI, owner login/profile persistence, signed installers and four-host canary install/uninstall/rollback. Core Production stays **v0.10.20**, accepted Brain **MAIN_R29**.

The exact candidates are Browser PR #81 `624295c55610a331c1531792f1040acb02fe4797`, Windows Control Center PR #166 `885270377ca6b8fb5e7736993d2688139a54680d`, Linux Control Center PR #165 `1c8178d8ef3affdc114f84bdb6fb5aadc72a099e`. All PRs Draft and unmerged. Browser + Windows CI PASS scoped; Linux Native X11 rendering still unresolved. None are independently accepted Production.

## Current critical blockers
- MMZ Tunnel OFFLINE, prior CEF install root missing and owner-local sudo required. MMZ scope Commander+Browser only.
- Emad Windows Native GUI uncertain; Browser has an existing lease, which must not be stolen or closed.
- No trusted Windows Authenticode signing evidence or accepted Linux root:root 4755 CEF sandbox installation for this UI candidate.
- No owner-native visual acceptance for every OS, session preservation and same-ChatGPT-conversation Runner ACK.
- No signed four-host Canary install, uninstall/rollback receipts or accepted release Brain.

## How to run evidence gate
`node scripts/ui-release-gate-r40.cjs --evaluate` returns missing prerequisites. The GitHub workflow tests on Windows and Linux that the **promotion remains BLOCKED** in known unsafe state, including forged releaseTag, missing host, browser lease and MMZ sudo/root. A green **R40 fail-closed CI does not mean Release PASS**.

No `--release`, `--install` or `--promote` mode is supported; attempts fail with exit 73. This code never uses the network, shell, registry, user browser profile or production state.

## Roadmap to FINAL
DISCOVERY/DEFINITION/BASELINE accepted → DEVELOPMENT candidate PRs → VERIFICATION (CI/scoped) → NATIVE VALIDATION/OWNER ACCEPTANCE → SIGNED CANARY + ROLLBACK ON ALL FOUR HOSTS → RELEASE → CLOSURE → FINAL. Progress percentage UNPROVEN; eight product gates remain open. When real evidence closes every gate, design a separate independently audited signed updater with exact SHA, transaction/rollback and protected user session. Until then automatic deployment is disabled.

**Exact next action:** resolve Linux GTK X11 native window diagnostics, reconnect MMZ without blind restaging, complete Native Browser/Control Center interactive acceptance, obtain signer and full Canary/Rollback/ACK receipts. Preserve `MAIN_R29` Brain and update cumulative handoff on every milestone.
