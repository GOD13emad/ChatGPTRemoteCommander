# Remote Commander suite — 0.11 release train
**Opened:** 2026-10-27 · **Status:** INTEGRATION CANDIDATE / NO PUBLIC RELEASE / NO HOST PROMOTION

## Version rules
- Every code-changing integration must increment its source/pre-release identity with traceable commit, changelog and tests (`0.11.0-dev.N`, then `0.11.0-rc.N`).
- `v0.11.0`: one suite, all required products included, tagged and published as **GitHub Pre-release**, not Stable, only after required gates PASS.
- `v1.0.0`: **first Stable**, based on the same suite after all owner GUI, server headless, browser/login, cross-host, rollback, security and independent acceptance gates PASS. Never promote by changing the version string alone.
- Prior published Core `v0.10.20` and Browser `v0.8.1` are historical release artifacts, not accepted fully stable suite. Do not alter immutable tags/assets, and do not break legacy updater latest endpoints until the migration is verified.

## Authoritative scope
Core, Browser Commander (including independent CEF UI), Control Center / user permissions, headless Windows servers, Linux desktops, GUI same-user private seats, Transfer Mesh, Project/Workflow Engine, local AI & scheduled Workers, profile/login ownership, deployment & updater. Browser has a separate source repo and release line; its independently versioned build must be pinned by SHA in the eventual suite release manifest. No unverified external components can silently count as integrated.

## Mandatory gates
1. Exact source SHA, protected CI, native tests, source-integrity and security review.
2. Verified multi-product build/package manifests, signing/provenance and supported Windows + Linux installers.
3. Five real-host installation, tool/API/Router/Browser/GUI/TransferMesh/Workflow + Control Center E2E, with real same-user session and headless server acceptance.
4. Native user consent, DPAPI/login isolation, persistent per-user grant/revoke and appropriately elevated OS access.
5. Reversible release promotion/rollback and retirement of old process/installer launch paths; no legacy Junction aliases.
6. Project Brain / release log reflects actual PASS or open gates; no auto-open of GUI, cookie sharing or blind retries.
7. Before any retroactive GitHub prerelease reclassification of historical public releases, verify each legacy updater will not break when `releases/latest/download` changes/disappears.

This initial `0.11.0-dev.1` change only aligns the source version train and policy. Every unaccepted gate remains false in `docs/release-train-0.11.json`; no claim of operational `0.11` or `1.0`.


## 0.11.0-dev.2 — candidate-only bootstrap correction (2026-10-27)

Core, Plugin, Codex Plugin, Windows UI numeric assembly identity and suite manifest advanced together from dev.1 to dev.2. Server bootstrap admits prerelease only with exact matching development manifest whose release/publish/autoupdate/promote flags are all false. Historical 0.10.25 rollback QA now skips this development version. R170/R173 rollback, public packaging, native acceptance and fleet promotion remain open; this is not an install approval.


## 0.11.0-dev.3 — candidate identity qualification (2026-10-27)

Retain historical 0.10.26 release policy regression while accepting the exact all-false 0.11 development manifest for cross-platform source identity. Does not relax native rollback/installed suite acceptance or authorize release.
