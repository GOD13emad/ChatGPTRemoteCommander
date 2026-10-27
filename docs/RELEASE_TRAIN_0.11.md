# Remote Commander suite — 0.11 release train
**Opened:** 2026-10-27 · **Status:** INTEGRATION CANDIDATE / NO PUBLIC RELEASE / NO HOST PROMOTION

## Version rules
- Every code-changing integration must increment its source/pre-release identity with traceable commit, changelog and tests (`0.11.0-dev.N`, then `0.11.0-rc.N`).
- `v0.11.0`: one suite, all required products included, tagged and published as **GitHub Pre-release**, not Stable, only after required gates PASS.
- `v1.0.0`: **first Stable**, based on the same suite after all owner GUI, server headless, browser/login, cross-host, rollback, security and independent acceptance gates PASS. Never promote by changing the version string alone.
- Prior published Core `v0.10.20` and Browser `v0.8.1` are historical release artifacts, not accepted fully stable suite. Do not alter immutable tags/assets, and do not break legacy updater latest endpoints until the migration is verified.

## 0.11.0-dev.4 — opt-in offline local model provider and multi-user GUI architecture (NOT INSTALLED)

- Code increment: `tools/local-ollama-planner.mjs` implements a strict localhost Ollama JSON-proposal provider for the existing `kind=command` Runner; it returns **proposals only**, never executes tools. Bounded input/output/time, explicit model env `RC_LOCAL_AI_MODEL`, caller-supplied tool subset and fail-closed errors. Explicit opt-in sample: `provider.kind=command`, `provider.executable=/absolute/path/to/node`, `provider.args=[/absolute/path/to/tools/local-ollama-planner.mjs]`; `runner.enabled` and `autoTick` remain false until the owner separately configures accepted scopes. No Codex delegation.
- Multi-account target: one unprivileged same-OS-user worker per enrolled identity. The SYSTEM/service coordinator may schedule but must not read user DPAPI/profile or impersonate without legitimate token. Every worker binds SID/UID, session, device, short-lived grant, allowed operation+target, revision, audit and revoke. **Admin/root is not globally granted:** elevated operations require a separately OS-authorized broker with a narrow action allowlist, UAC/sudo/polkit consent and independent revocation tests.
- Cua Driver becomes preferred interactive GUI adapter **after** signed binary, same-user pipe, background noninterference, consent and revoke E2E. Agent-S4 supplies optional interface-planning research, UFO2/UFO3 app API/coordination ideas, UI-TARS visual fallback, OpenAdapt recorded replay and Xpra Linux independent X11 seats. These are optional adapters, not simultaneously privileged resident daemons.
- [REA](https://github.com/morluto/rea) (MIT) is lawful binary/app analysis and evidence collection **on authorized apps**, not GUI runtime. [colibri](https://github.com/JustVugg/colibri) (Apache-2.0) is disk-streamed MoE local inference; needs model/RAM/disk benchmark and is **not** the workflow orchestrator. Existing local Ollama/llama.cpp should be qualified first.
- Proof status: implementation and narrow unit tests only; not OS user-worker deployment, local-model semantic correctness, full CI, fleet promotion or Stable.

## 0.11.0-dev.6 — CI qualification command-size corrective gate (2026-10-27, NOT FINAL)

Dev.5 formally tested exact-manifest NoPromote version admission in both R170/R173 and separated dev Windows Server Canary evidence from stable allowlist requirements. Hosted R170 source version preflight passed; real promotion did not. CI and both Canaries failed the separate `R157_PHASE_WINDOWS_CMD_LENGTH` protection after inline Node test additions. Dev.6 restores the original bounded check/test scripts and moves new policy-negative tests to a dedicated CI step. Acceptance remains blocked until exact dev.6 CI, R170/R173/R157, Server Canary and actual 5/5 host integration show their own PASS receipts. The release-train manifest stays all false.

## Current cross-product delivery roadmap — 2026-10-27 (integrated architecture decided; acceptance NOT FINAL)

**Decision event `RC011-UPSTREAM-ARCH-20261027`.** The existing [PROJECT_BRAIN](PROJECT_BRAIN.md#rc011-upstream-arch-20261027--component-specific-last-release-decisions) holds the one evidence-backed upstream release inventory (as of 2026-10-27), alternatives, licenses and detailed host deltas. This Roadmap is the **single active suite-wide sequence**, superseding this section's earlier dev.3-only gate snapshot. No new authoritative Brain, Index, package-lock or mutable `latest` installed-version claim is created here.

### Frozen product boundaries and activation contract

- **Always required:** Core Node MCP server/Router/Tunnel; one stable per-host install and one correct chat/profile route; Control Center; device/user capability inventory, sessions and per-user grant/revoke; single Workflow/Project Engine (journal, scheduler, evidence/checkpoints, no blind retry); Transfer Mesh; native install/rollback and immutable source/asset provenance.
- **Platform-selected:** Windows owner-interactive same-user worker with Cua Driver (and validated UIA fallback), Linux Wayland portal/libei or separately isolated Xpra/X11 seat; Browser Commander CEF/Chromium built separately then pinned in the suite; headless Windows/Linux server without monitor/login dependence. The Core never impersonates user accounts from SYSTEM Session 0 merely because `FULL_POWER` is configured.
- **Optional opt-in capability adapters:** Playwright MCP, Chrome DevTools MCP, Agent-S4, UFO3 API/coordination patterns, UI-TARS visual, OpenAdapt replay, local Ollama/llama.cpp/colibri model providers, REA diagnostics, CoS workspace patterns and Codex Web capability design. They receive only explicit audited tool and data boundaries, no independent universal credentials, no parallel Runner or unapproved model/task enrollment.
- **Interface contract:** per-user `deviceId + identity SID/UID + session + profile + capability + target + lease revision` and `OBSERVE → AUTHORIZE → ACT → VERIFY → RECOVER`. Any uncertain effect blocks retries until externally reconciled. Owner may stop/revoke Worker; server and Browser use distinct authority profiles. OS elevation requires a separate authorized, revocable narrow broker (UAC/sudo/polkit), not automatic admin/root for everyone.
- **Upgrade discipline:** for every adopted external component discover its current component-specific stable release, compare pre-release/nightly, verify ABI/API/OS compatibility and license, pin exact tag **and commit/hash** and produce a reproducible lock/receipt; only then package. When newer upstream arrives, run delta qualification on the selected adapter before replacing that pin. Rollback retention is bounded evidence, not a second active install, and no junctions are created.

### Ordered delivery / acceptance matrix

| Gate | Current evidence (dev.4 exact source 08eb601) | Definitive DoD / sequence |
| --- | --- | --- |
| **P0-A Source/authority & version** | PR #409 Draft; source `0.11.0-dev.4`; all nine manifest component approvals `false` | Exact Core+Browser SHA, independent package and provenance, branch protection; all changes versioned only when modifying code; no public release until all nine verified |
| **P0-B CI installer blocker** | At exact source `34e39d4c`, hosted Ubuntu CI and clean Ubuntu Server Canary PASS; R170/R173 **source admission PASS** but actual promotion **FAIL** (`PROMOTE_CODE=3` / `R185_PROMOTE_NOT_ACCEPTED`); R157 **FAIL test gate**. Windows CI/Server Canary were IN_PROGRESS at last read. | Read bounded R170/R173/R157 promotion artifacts, fix updater prerelease SemVer without enabling release authorization, rerun exact-source Windows/Linux genuine promotion + rollback, complete Windows canary; only then close P0-B. |
| **P0-C Suite packaging** | Core Candidate loopback 5/5 prior health; Windows & Linux Control Center preview QA scoped; independent Browser latest preview `v0.8.3-rc.3` not suite-integrated | Build one compatible Core+CEF+Control Center+GUI+Mesh+Workflow+Workers+Updater bundle per Windows/Linux profile, verified hashes, matched Browser commit/assets; availability and version readback by each platform |
| **P0-D Same-user Multi-User Worker** | Owner Windows SYSTEM Session 0; Aa.Emad Cua Session 1 observed; no cross-user worker E2E. Linux accounts/sessions differ | Account enroll/discover, OS identity binding, no DPAPI/profile leakage, per-tool ACL grant/expiry/revoke, negative cross-user tests, Control Center visibility, owner consent; accepted on actual hosts |
| **P0-E Native GUI + headless** | Cua Windows owner process found, pipe not accepted; Linux Xpra absent; Wayland Portal grant issues; Windows server non-elevated token on Amir | Cua isolated latest **eligible** Driver candidate background nonfocus/action/verify E2E in owner session; fallback UIA/Portal/Xpra only if matched; monitorless servers remain GUI-independent; stop/revoke safety and uncertain effect tests |
| **P0-F Local AI scheduling** | Ollama Linux Emad `qwen3:4b-instruct` live `block` proposal PASS in read-only scope; adapter unit 7/7 PASS; no autonomous enrollment | Local model quality/rate/resource tests, exact Runner allowed tools and event budget, explicit workflow enrollment, autoTick scheduler timed tests, pause/restart/resume/revoke and independent evidence. No self-grant/shell/secret prompt |
| **P0-G Five host controlled primary rollout** | 5/5 production Core `0.10.26`; 5/5 isolated source `0.11.0-dev.3`, not routed production | In-place guarded installation with correct accounts and routes on **all five hosts**, version and E2E readback for every required component, checksum and full workflow/Browser/GUI/Transfer/ControlCenter tests; verified reversible rollback, preserve dirty trees/owner data, no junction |
| **P0-H Release** | `v0.11.0` and `v1.0.0` NOT AUTHORIZED; old releases historical | Publish `v0.11.0` GitHub prerelease only after required P0 acceptance; `v1.0.0` Stable after soak/recovery, security and independent owner review, with installer and updater migration evidence |
| **P1 structured Browser / replay / visibility** | CEF independent source; Playwright/DevTools/OpenAdapt considered, not deployed in 0.11 | Independently pinned adapters, owned-profile privacy, positive/negative E2E, no cookie transfer, operational telemetry and bounded artifact logs |
| **P1 transferable models + GPU** | Emad Linux Ollama real; MMZ NVIDIA 6GB API unavailable; Windows Emad RTX3080 10GB; servers VMware SVGA; colibri candidate only | Same prompts/accuracy/latency/RAM/disk/privacy/cost across Ollama, llama.cpp and colibri on each qualified machine; measured fallback/timeout; no uncontrolled model downloads |
| **P2 later multi-agent scaling** | OpenHands/LangGraph/Temporal/Graphiti and unrestricted upstream integrations NOT required | Compare measurable workload advantage before migration; no second scheduler, graph or state authority without test-proven benefit |

**Critical next executable decision:** P0-B now moves beyond source-admission into **actual updater SemVer and native rollback**. Collect scoped R170/R173 promotion/rollback artifacts and R157 inner test failures; correct only the prerelease comparison/result serializer and gate dispatch proven faulty, preserving exact SHA/NoPromote and historical Stable path. Qualify with negative tests, rerun Linux/Windows R170/R173/R157 and clean Server Canary. Then build P0-C and validate P0-D/E/F with each OS owner. Never perform a primary five-host cutover while native rollback is failing. Independent hardware/model benchmark work remains safe without touching dirty source or installed services.

### Per-host optimized adapter / inference assignment — measured 2026-10-27

| Host | Measured RAM / free disk / GPU | Inference and desktop policy |
| --- | --- | --- |
| Emad Windows | 127.8 GiB RAM; 582.6 GiB free system disk; RTX3080 10 GiB | First candidate for larger local AI/colibri benchmarks, not automatic model downloads; owner-seat Cua Driver bounded manifest, separate browser/desktop runtimes |
| Emad Linux | 14.5 GiB RAM, 7.9 GiB available; 214.9 GiB free home; AMD Barcelo | Existing Ollama `qwen3:4b-instruct` proposal-only baseline; avoid heavy resident MoE and foreground GUI assumptions |
| MMZ Linux | 15.3 GiB RAM, 9.3 GiB available; 135.9 GiB free home; RTX4050 6 GiB | Evaluate small quantized model after local consent and installation; native Wayland Portal; Ollama currently unreachable |
| Amirreza Server | 65 GiB RAM; 85.2 GiB free system disk; VMware SVGA 3D | Headless Core/Transfer/Workflow, CPU-only inference optional; no elevated token and no GUI dependency |
| Emad Server | 65 GiB RAM; 264.3 GiB free disk; VMware SVGA 3D | Headless Core and already-running Ollama service; model availability/benchmark not yet verified |

These readings are ephemeral capacity observations, not acceptance of local AI performance or an authorization to allocate every available byte. Cua [bounded permission](https://cua.ai/docs/cua-driver/guides/permissions) requires a time-limited capability manifest; do not combine origin-restricted browser and general desktop-control scope in one runtime.

### Upstream version and source verification

See the current [PROJECT_BRAIN source selection table](PROJECT_BRAIN.md#rc011-upstream-arch-20261027--component-specific-last-release-decisions): Cua Driver v0.38.0 (release API marks prerelease; 0.38.1-nightly excluded from rollout), Agent-S4 source SHA (not 2025 v0.3.2), UFO3 v3.0.10, UI-TARS v0.3.1, OpenAdapt flow v2.4.0/desktop v0.24.0, Xpra v6.5.5, REA v6.8.0, colibri v2.0.0, Ollama v0.40.11, MCP SDK v2.4.0, Playwright MCP v0.0.83, Chrome DevTools MCP v1.12.0, CoS v2.1.46, Codex Web v6.1.14, Cosign v3.1.4, and distinct Browser stable v0.8.1 / RC v0.8.3-rc.3. These are research candidate identities only, **not installed pins**. Keep exact version/tag/SHA of each accepted component separate from development head, and refresh the live upstream check before actual adoption.

**Coverage limit:** 680 tracked Core Candidate file bytes were read/hashed and 107 independent Browser paths enumerated; full account-wide chat transcripts, untracked files on five systems and semantic audit of every revision are not exposed/accepted. Current BRAIN_COVERAGE stays INCOMPLETE. Notion remains NOTION_SYNC_PENDING after explicit quota failure; no duplicate records created.


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
