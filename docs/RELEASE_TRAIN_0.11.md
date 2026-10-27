# Remote Commander suite — 0.11 release train
**Opened:** 2026-10-27 · **Status:** INTEGRATION CANDIDATE / NO PUBLIC RELEASE / NO HOST PROMOTION

## Version rules
- Every code-changing integration must increment its source/pre-release identity with traceable commit, changelog and tests (`0.11.0-dev.N`, then `0.11.0-rc.N`).
- `v0.11.0`: one suite, all required products included, tagged and published as **GitHub Pre-release**, not Stable, only after required gates PASS.
- `v1.0.0`: **first Stable**, based on the same suite after all owner GUI, server headless, browser/login, cross-host, rollback, security and independent acceptance gates PASS. Never promote by changing the version string alone.
- Prior published Core `v0.10.20` and Browser `v0.8.1` are historical release artifacts, not accepted fully stable suite. Do not alter immutable tags/assets, and do not break legacy updater latest endpoints until the migration is verified.

## Current cross-product delivery roadmap — 2026-10-27

This is the active integrated suite roadmap. Historical engine-only PROJECT_ENGINE_ROADMAP.md remains valuable provenance, not this product's active release plan. Source and external-adoption evidence belong to the current checkpoint in PROJECT_BRAIN.md, not duplicated per-revision authority files.

| Gate | Pinned status at dev.3 SHA a06fe7ec | Closing evidence |
| --- | --- | --- |
| P0 Core + fleet | Five primary Core 0.10.26; five isolated dev.3 loopback health PASS; canonical Git roots diverge with live uncommitted work | Correct owner/profile routing; exact source integrity; preserve active tunnel and owner data |
| P0 Installer / rollback | Linux R170 FAIL, Windows R173 FAIL, Windows Server Canary FAIL; Linux clean canary PASS | Full isolated Windows + Linux promotion AND rollback, safe server bootstrap, no bypass or duplicate permanent roots |
| P0 Suite composition | 9 manifest components all verified=false; Windows and GTK UI QA and Browser Linux canary are scoped PASS | SHA-pinned Core, independent CEF Browser, native Control Center, GUI, Transfer, Workers, multi-user and Updater actual packages |
| P0 Native authorization | Owner GUI observe-only / incidents and Linux Portal grants still unaccepted | Authenticated same-user input, policy and revoke, independent account/profile isolation; server headless path without monitor |
| P0 Installer integration | Candidate is a localhost QA sidecar, NOT the production MCP route | Tested one active package per host; update/restart/rollback with device-specific receipts, no junctions |
| P0 Release milestone | PR #409 Draft; Stable and publish flags false | v0.11.0 prerelease only after cross-product/5-host/security/provenance acceptance; v1.0.0 first Stable only after independent signoff |
| P1 Browser and worker UX | Browser Automation and journal exist; extension integration not proven fleet-wide | Bounded Playwright locator and diagnostics, worker resume and acknowledgments with no blind resend |
| P1 Transfer and observability | Existing Mesh + selected private Syncthing evidence historically scoped to two hosts | Five-host transfer SHA/recovery + opt-in redacted trace and resource limits |
| P2 external orchestrators/graph memory | Proposal only | Compare existing execution engine against LangGraph/Temporal/OpenHands/Graphiti on same workload and budget before adoption |

**Upstream selection policy.** Core MCP: modelcontextprotocol/typescript-sdk v2; Windows GUI: FlaUI / Microsoft winappCli; Linux GUI: xdg-desktop-portal + libei/EIS; native Browser: existing CEF with optional Playwright MCP and Chrome DevTools MCP adapters; workspace and Codex UX: CoS / codex-chatgpt-web design-only until explicit consent and security review; multi-agent UI: OpenHands patterns; Mesh: tus protocol plus existing transport; identity policy: node-casbin only if required; telemetry: OpenTelemetry JS; binary provenance: Sigstore Cosign plus CodeQL/secrets. Keep one Commander engine. Pin versions/licenses, test positive/negative routes, and prevent profile/cookie sharing. Do not auto-install all external projects on five hosts.

**Evidence gate:** source inventory is not semantic review of all files; project conversation summaries are not all ChatGPT archives. Track remaining coverage without claiming 100%. No host or release was changed by this documentation audit.

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
