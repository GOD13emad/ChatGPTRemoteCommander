# Commander unified product architecture

**Decision:** accepted owner target architecture, 2026-10-28. **Implementation:** partial / not fully qualified. **Release:** no new release authorized by this design document.

This is a technical architecture specification, **not** another Project Brain, roadmap or release authority. [Project Brain](PROJECT_BRAIN.md) remains the single continuity entry point; [Release Authority](RELEASE_AUTHORITY.md) governs build, signing, admission and publication. This document supersedes the *future product topology* portions of earlier multi-product and Codex-exclusion proposals, not their verified historical test evidence or immutable releases.

## Chromium-first unification decision — 2026-10-30

**Owner choice:** Use the **Chromium/CDP family as the default Commander-owned browser automation engine across Windows, Linux desktop and Linux/Windows headless servers**. Existing Windows Chrome CDP remains valid. Linux discovered existing **Brave (Chromium)**; source candidate f2f08960e791af21dfb27253a29dc3e7749926b4 adds Brave browser discovery to the existing `tools/browser-control.mjs` Chromium/CDP backend and a real native headless isolated-profile test. No separately installed browser runtime, duplicate Commander service or parallel execution engine is authorized by this decision. The future standalone CEF/Chromium Browser Commander UI remains an independent R5 build and release gate, not implemented by detecting Brave.

**Compatibility / lossless migration:** A current Firefox/WebDriver user profile or existing Firefox browser session must **not** be silently merged, converted, copied, logged out, deleted or relabeled as Chromium. Keep the existing Firefox adapter available only for explicitly retained legacy enrollments while they are migrated on a per-owner/per-profile basis; all new owned browser candidates choose a Chromium-family executable. New Chromium-owned profile directories are separate from Firefox and the user’s normal Chrome/Brave profiles. No cookies/passwords/tokens are copied, imported or exported; genuine provider login may require owner-approved `REAUTH_REQUIRED` under the new browser profile. Maintain current Tunnel ID/API-key protected references, ChatGPT accounts, independent chat grants, profile ownership, live GUI seats and all durable receipts. Existing V1/native Firefox routes remain untouched until a staged, exact-before/after, two-chat authenticated cutover is independently accepted.

**Observed 2026-10-30 state:** Emad Windows PC, Emad Windows Server and Amir Windows Server all report live `chromium-cdp` browser availability with installed Google Chrome, but their existing-owner browser admission tool currently rejects creation of new sessions with `BROWSER_EXISTING_USER_SESSION_REQUIRED_USE_WORKSPACE`. That guard is not a test failure and must not be bypassed via another CLI tool. Emad Linux reports live `firefox-webdriver` in its installed V1 config, while native Brave is already installed and Chromium/CDP source QA passed in an **isolated temporary profile**; switching the live Linux runtime is **not yet qualified or deployed**. MMZ Linux device is offline and its Chromium executable and session acceptance remain **UNKNOWN**. Do not claim five-host Chromium-active or Stable. No restart of Emad Linux tunneling is permitted while one live/READY enrollment still lacks a persisted owner-scoped restart key.

**Acceptance evidence required:** (a) exact-source Chromium/CDP real start–observe–end in per-host isolated owned profile with no user desktop/profile touch; (b) per-owner verified browser login and session isolation, including explicit reauthentication receipts if needed; (c) auth-bound, lease-scoped multi-chat/browser-window E2E; (d) non-disruptive V1→V2 migration and five-host acceptance, including the currently offline device; (e) required hosted CI/NoPromote/rollback release gates. Native arbitrary-app GUI remains its separate OS-seat/consent adapter; making Browser Commander Chromium-based must not be represented as an OS GUI driver.

## 0. Accepted five-host integration and pre-v1 update policy — 2026-10-28

**Owner decision / target:** one Commander product, one installed version and upgrade authority **per host**, shared exact-source mainline across personal `GOD13emad/ChatGPTRemoteCommander` and its actual organizational fork `TandemVector-Labs/ChatGPTRemoteCommander`. The organizational repository is the same product's GitHub fork; synchronize upstream via protected branch PR, not a separate product or a forced overwrite. Source can advance before fleet cutover; neither fork can independently declare Stable.

**Development train `0.11.0-dev.N`:** no backwards *release qualification* or requirement to promote/roll back into known-broken `0.10.x` during development. Instead run forward-only, exact-SHA candidate rollout after Core/Browser/Control tests and native Windows/Linux install/upgrade acceptance; diagnose and repair failures in the *next numbered development build*. This supersedes only pre-v1 mandatory rollback tests as blockers. It does **not** weaken crash recovery, data/schema compatibility, atomic replace, installation receipts, OS/user permission, audit, secure profile isolation, signed/hashed artifacts, safe working-copy preservation or idempotent retries. The backup/snapshot of user configuration, keys and existing install layout is *recovery-only*, not a release rollback target; keep it inaccessible to the active runtime until owner-authorized retirement. Never destructively delete the only functioning service while exact new executable cannot start.

**Stable gate `v1.0.0`:** restore strict tested rollback and disaster recovery, plus independent acceptance for all subsystems and all three environment profiles before first Stable promotion. No false PASS inherited from tests of prior SHA; a development build can be operational on five machines without being Stable.

**Single install ownership:** one manifest and service supervisor per host, with Core, Coordinator/Workflow, Browser Commander, GUI/Cua, Control Center, security/profiles and updater as governed **components**. Internal binaries, per-user profiles and native runtime dependencies may be separate files/daemons, but must not become duplicate independent *Commander installations*. Windows desktop, Linux desktop and headless Windows/Linux servers use platform adapters only where capability differs. Use staged atomic activation, exact health receipt and only then retire obsolete executable routes; classify old `releases`, `update-backups`, `browser-profiles`, `candidates`, standalone browser registrations and GUI evidence by actual dependencies before any deletion.

**Chat execution:** ChatGPT Chat owns task reasoning, sequencing, tool calls and validation; Codex Harness and CoS-style local workers are optional bounded adapters. Never dispatch to ChatGPT Work or spend Work credits for project execution. The legacy installer catalog item `work-plugin` is a historical enrollment ID for a ChatGPT app/connector, **not authorization to invoke ChatGPT Work**; migrate display text and downstream compatibility independently.

**Order of actual acceptance:** (1) exact candidate build, unified installer and source fork synchronization; (2) one healthy managed Core/Browser/GUI/Control Center on each Windows/Linux/Headless profile; (3) five-host installed receipts, user/profile/permission isolation, mixed-version migration and multi-chat coordination tests; (4) retire owned duplicates only after dependency-aware audit; (5) qualified dev release; (6) release recovery/rollback qualification and Stable `v1.0.0`. Current source and Cua side-by-side installation **does not** satisfy (2)–(6).

---

## 1. One product; three runtime environments

The target is one versioned **Remote Commander** product, installable on any compatible machine, not an installation tailored to the five pilot hosts. It has one API/capability schema, package/release manifest, identity model, project schema and upgrade contract. Packaging targets are **Windows Desktop**, **Linux Desktop** and **Headless Server** (on supported Windows or Linux OS). “Server” is an execution profile, not a third operating system.

```text
 ChatGPT Chat(s) — primary reasoning, task ownership and acceptance
      |               |                       |
 Codex Harness    CoS-like UX/Workers     Other approved tools/models
      \               |                       /
             MCP / capabilities gateway
                         |
            Commander Coordinator (logical)
         identity / RBAC / queue / leases / events
                         |
                 Commander Core
    +--------------------+---------------------+
    |                    |                     |
 Project & Workflow  Browser Commander   Desktop / GUI
 Brain / Roadmap     CEF + Playwright    Native + Cua adapter
 Git / workers       Session isolation   Background/virtual GUI
    +--------------------+---------------------+
    | filesystem / shell / process / APIs / security / update |
                         |
       Windows adapter | Linux adapter | Headless adapter
                         |
         Control Center: fleet / projects / users / status
```

**Invariant A:** one common core and canonical capability contract; platform-specific adapters implement only genuinely OS/session-dependent behavior. **Invariant B:** no competing Project Engine, auth registry, Brain, queue, lock owner, or release authority per accessory. **Invariant C:** the same install can support multiple authenticated users/profiles subject to separation and policy; no reuse of another user’s browser credentials or OS session.

## 2. Execution and quota routing

**Primary owner:** the initiating ChatGPT Chat retains reasoning, task decisions, tool dispatch, verification and user-facing delivery. Any number of cooperating ChatGPT chats can receive independent scoped tasks. Results are returned to the owning chat/project. A chat context limit or disconnect cannot silently authorize new autonomous model work: only approved, durable, bounded local operations persist, and delivery may wait for a supported host pickup.

**Allowed candidates:** Codex native task harness/CLI, ChatGPT-Web-backed Codex models, CoS-style local workers, MCP tools, other models, browser/GUI automation, and normal test/build programs. The useful parts of upstream projects may be integrated as adapters; **do not introduce a second main orchestrator**. Never impose a blanket “Codex prohibited” decision.

**Hard owner requirement:** do not invoke or hand work to **ChatGPT Work**; do not consume Work credits as an execution mechanism. Route execution through the active chat and explicitly chosen tools. This is a routing policy, *not* a billing guarantee: account-side message, model, API, Codex or third-party limits remain applicable, and unofficial ChatGPT Web bridges cannot certify OpenAI quota accounting. Surface selected route and quota assumptions before any paid provider invocation; absence of Work use must be established from actual invocation records, not inferred from a product label. Never bypass account or service limits.

**Distinguish the two upstream integrations:**
- [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) — Codex app/CLI **harness** with ChatGPT Web model transport and MCP tool bridge. Its own README describes separate Web usage and no Work/Codex quota for that route; unverified for this Commander installation. Mode must remain explicit (native Codex vs Web model).
- [totec448-spec/chat-on-steroids](https://github.com/totec448-spec/chat-on-steroids) — ChatGPT-owned local MCP execution, workspace, workers, Goal/Loop, and Compact & Resume. Transfer selected patterns/compatible modules, not a parallel state/auth/execution engine.
- [openai/tunnel-client](https://github.com/openai/tunnel-client) — supported outbound transport candidate under approved plugin credentials and scopes.

The bridge/extension projects automate unofficial ChatGPT browser interactions in some modes; account/session security, provider terms, UI drift, and current host authorization must be reviewed. Do not auto-capture cookies, reuse another profile, silently invoke ChatGPT Work, bypass refusals or install unrestricted connectors.

## 3. Subsystems and component boundaries

| Subsystem | Single responsibility | Boundary / integration |
|---|---|---|
| Commander Core | files, shell, process, network/API tools, durable operations, MCP endpoints | schema-validated tools + OS adapter; not per-chat duplicated processes |
| Coordinator | authenticated users, projects, device enrollment, distributed leases/locks, durable queues, event stream | required for cross-device coordination; local fallback only with explicit reduced guarantees |
| Workflow / Project Engine | DAG, checkpoints, resume, evidence, independent verification, idempotency | existing WorkflowStore; no blind retry of UNCERTAIN effects |
| Project Brain | accepted DoD, roadmap, decisions, proofs and next step | one canonical role authority; history preserved, semantic upsert |
| AI/Worker Engine | bounded, typed task proposals, specialist programs, sandbox/worktrees | Chat-owned execution; no unconsented extra provider |
| Browser Commander | owned browser profiles, tabs, downloads, navigation, accessibility/DOM, sessions | Chromium/CEF UI default; Playwright Chromium/Firefox/WebKit automation; cross-engine compatibility is tested, not assumed |
| GUI Engine | windows, accessibility, screenshots, typed input and focus | evaluate [trycua/cua](https://github.com/trycua/cua); native Windows/Linux adapters; explicit interactive consent when required |
| Control Center | fleet/users/profile/RBAC/permissions/project view/health/updates | consumes Coordinator API; not a second backend |
| Identity / Security | authentication, per-user/tenant ACL, secret isolation, audit, revocation | correlation IDs are **not** authentication; same OS user ≠ same ChatGPT user |
| Updater / Deployment | signed/reproducible OS bundles, staged in-place upgrades, migration, rollback | one product manifest; immutable exact versions + SHA; no unsafe automatic stable promotion |

**Browser:** CEF is the owned native Chromium container where its native build is qualified; Playwright is an automation driver and cross-browser test layer, not a claim that a CEF binary provides Firefox/WebKit rendering. Preserve distinct profiles, never import user cookies. Headless browsers are first-class on Server without a monitor.

**GUI:** native interactive GUI must not be treated as universally available: Windows Session 0 cannot act as a substitute for the logged-in owner desktop; Linux Wayland/X11 and services differ; headless GUI needs a separately authorized private desktop, display or VM. Read-only observation and input are different permissions.

## 4. Multi-user, multi-chat, parallel projects

Actors have authenticated identities and roles (Owner, Admin, Developer, Operator, Viewer) with explicit per-device, per-project, per-tool and per-action grants. OS logon profiles, Commander identities, ChatGPT accounts and browser profiles are distinct mapped entities. Enrollment/revocation/audit must work on each supported install; the existence of a tunnel alone is not proof of chat identity.

Model entities: `Tenant/User/Role`, `Device/HostProfile/Capability`, `Project/RepoRoot/BrainRef`, `ChatBinding`, `Task/Worker/Lease`, `Operation/Receipt/Result`, `BrowserProfile/Session`, `Release/ModuleVersion`. IDs are stable and scoped; avoid sensitive content in logs.

**Concurrent execution:** read-only tasks can overlap; independent writers use isolated Git worktrees. **Exactly one globally coordinated writer for each canonical project root or conflicting resource** at commit/integration time. The central Coordinator uses a lease/fencing token and revision preconditions; a per-machine mutex alone does not satisfy this. Lost ACK => UNKNOWN/UNCERTAIN, reconcile before effect replay. Writer lease expiry cannot let an old writer publish. Do not allow multiple workers to mutate the same real GUI input desktop simultaneously.

Durable continuation persists status/evidence in Commander, but does not claim ChatGPT can wake itself or do new reasoning after a turn without an actual supported host mechanism. A task's acceptance and result delivery are separate.

## 5. Cross-platform acceptance matrix (target, not observed PASS)

| Capability | Windows Desktop | Linux Desktop | Headless Server |
|---|---|---|---|
| MCP, shell/files, workflow, Git | required | required | required |
| Multiple users, projects, queued workers | required | required | required |
| Owned headless browser + isolated profiles | required | required | required |
| Native interactive GUI | OS session | X11/Wayland session | optional isolated session; never assume attached monitor |
| Background/virtual GUI | qualified native adapter | qualified native adapter | optional VM/private display adapter |
| In-place update + rollback | required | required | required |
| Control Center management API | required | required | required |

Every absent capability must be returned as **UNSUPPORTED with a reason**, not silently simulated. Initial installation may use platform-specific packages, but all use the same canonical product manifest. Cross-platform behavior is proven by same-contract tests and live opt-in canaries, not by code-path similarity.

## 6. External repositories and upgrade policy

**Code authority:** [GOD13emad/ChatGPTRemoteCommander](https://github.com/GOD13emad/ChatGPTRemoteCommander). Existing Browser and Control Center repositories remain source components with independent provenance until a measured consolidation; do not destroy history or imply they are already part of one working installer.

**Candidate integrations:** `miuuyy/codex-chatgpt-web` (Codex-Web bridge), `totec448-spec/chat-on-steroids` (ChatGPT-led workflow UX), `trycua/cua` (GUI), `microsoft/playwright` (browser automation), `chromiumembedded/cef` (browser UI), `openai/tunnel-client` (MCP connection); evaluate `temporalio/temporal` only when distributed orchestration requires it. These are **not a declaration of installed dependencies**.

Use the **latest security-supported and compatible upstream release/commit**, pinned with hash/SBOM/license and regression tests. Source review, security isolation and supply-chain acceptance precede vendoring. A newer upstream HEAD is not automatically production-ready. Do not ship experimental changes as Stable because they were cloned.

## 7. Delivery milestones and exact DoD

### Architecture / design gate (this document)

- [x] Owner target clarified: one product, three environments, maximum shared core, browser breadth, multi-user/chat/task, in-place upgrades.
- [x] Chat is primary; Codex is permitted; zero ChatGPT Work invocation is routing policy.
- [x] One authority per role; no second coordinator/workflow/database/release authority introduced by accessory code.
- [x] Explicit gaps and pass criteria defined; existing historical receipts preserved.

### Runtime/release gates (NOT accepted by a design document)

- [ ] **A.** Unified install manifest, capability discovery and platform adapter matrix; Windows/Linux/Server installer/upgrade/rollback qualification.
- [ ] **B.** Authenticated Coordinator, per-user isolation, revocation and **cross-device fenced** writer locks; lost-ACK tests.
- [ ] **C.** Codex-Web and CoS-mode integration, route selection, policy tests preventing Work dispatch, cross-chat durable handoff; confirm Chat-owned tool round-trip.
- [ ] **D.** Browser owned Chromium/CEF build, Playwright Chromium/Firefox/WebKit target-site matrix, safe profile/session isolation.
- [ ] **E.** Cua/native GUI assessment on Windows/Linux; headless Server limitations tested with a real isolated display when required.
- [ ] **F.** Task fan-out, Git worktree isolation, ordered merge, durable project Brain/checkpoint and conflict/recovery tests.
- [ ] **G.** Signed/authorized version-specific release, hosted Windows/Linux CI, headless-server canary, multi-user real install, in-place migration/rollback, fleet verification; no promotion from partial/source-only PASS.

**Acceptance:** production `FINAL` requires exact artifact/version, actual installation/capability checks on each supported profile, real multi-chat multi-user tests, provenance-linked evidence, zero unexpected Work tool invocation under the verified route, and release-authority admission. No documentation-only task can close a runtime gate.

## 9. FINAL TARGET DESIGN: V2 architecture and non-destructive connectivity (accepted 2026-10-30)

**Decision is final for planning; actual software and release are NOT FINAL.** One versioned Commander per host, one canonical Core/MCP router, Coordinator/RBAC/grant and cross-host fenced lease authority, Project Brain/WorkflowStore/runner, governed Browser/GUI/AI Workers, one Control Center and one release/updater manifest. Use platform-specific Windows Desktop, Linux Desktop and headless server adapters, not competing installations or duplicated schedulers. ChatGPT Chat is the reasoning/decision owner; Codex and other models are optional explicit adapters, with no implicit ChatGPT Work routing.

### 9.1 One Tunnel + Runtime API Key: preserve compatibility

- Every currently enrolled ChatGPT-to-host tunnel, Tunnel ID, Runtime API Key **reference**, account/workspace association, profile ID, existing endpoint and autostart policy is a must-preserve asset. Do not force consolidation, renaming, rotation, re-enrollment, key export or removal. Existing one-tunnel-per-chat-to-system is supported across V1/current installation → V2.
- The **optimized target** is normally one persistent outbound tunnel per host **or separated trust domain**, shared by multiple chats/accounts only after independent real OAuth authorization, signed access token/JWKS issuer/audience/scopes, trusted platform/native owner-session binding, and per-conversation, per-user, per-tool grants and revocation are proven end-to-end. Multiple tunnels remain valid for separate organizations, isolation/security domains and account policy. Transport API Key and a string named openai/session do **not** authenticate an individual user, chat, or OS seat.
- Prefer keeping the currently functioning outbound tunnel; isolated V2 HTTPS/mTLS is a candidate only. No mandatory inbound port, provider quota-bypass or unnecessary key rotation. Secrets, DPAPI blobs, OAuth tokens, private keys, cookies and user browser passwords stay in existing protected per-owner storage, not exported to GitHub/ChatGPT/Notion or transferred between OS users. OAuth re-login when required is recorded as REAUTH_REQUIRED with explicit user consent, not falsely counted as PRESERVED.

### 9.2 Lossless migration contract

Before a cutover, keep an owner-private **nonsecret** manifest mapping host ID, OS SID/UID and desktop seat, Commander profile ID, ChatGPT account/workspace, existing tunnel enrollment ID, credential-store reference/owner/scope, supervisor/endpoint, Browser-owned profile reference, project root, Brain/Workflow schema and durable receipts. A single default profile shown by system_status does not prove all enrollments were discovered.

1. **Inventory:** on each reachable host, read-only enumerate all profiles, tunnel enrollments, service owners and OS users/permissions; record baseline IDs/counts, active health, capability matrix and dependencies. Offline host = PENDING, not PASS.
2. **Protect:** preserve original protected credential/configuration scope and recoverability. Validate Windows DPAPI user-versus-machine ownership and Linux UID/ACL before any identity change; no key plaintext extraction or secret copying to new contexts.
3. **Dry run:** stage exact-source V2 candidate isolated from the live route, run versioned/repeatable schema transforms on protected recovery copies, preserve profile/tunnel IDs and project/receipt/browser-owned profile state; verify pre/post identity mapping/counts and credential usability.
4. **Live canary:** require genuine ChatGPT user OAuth/consent, actual native chat+seat authentication, 2 independent real chats, grant/revoke, exact window/tool access and workflow/root contention; separately prove one-tunnel-per-enrollment compatibility and optional shared-tunnel mode.
5. **Cutover:** update supervised route atomically only after the **actual installed** candidate health, MCP tool discovery and authenticated tool operation pass for each existing enrollment. Keep last healthy route and private recovery state; never blindly retry an UNKNOWN/UNCERTAIN GUI/file effect.
6. **Retire/recover:** stop duplicate old routes only after no dependent profile/tool remains. For a failure, preserve old connectivity, repair next dev build, and qualify full recovery/rollback for Stable. No blanket cleanup or forced replacement of protected profiles.

**Per-host migration acceptance ledger:** exact pre/post profile and tunnel identities/counts; key usability without revealing secret; account/seat/supervisor permissions; authorization and revocation; installed version/hash; Browser-owned profile references; file/workflow/Brain/receipt integrity; GUI consent and noninterference; restart and recovery. A missing item is OPEN, not inferred from source tests.

### 9.3 UI/GUI, upstream integrations and capability target

- **Universal GUI:** select any supported existing application window by trusted OS session, PID and native handle, not a fixed list of browsers/programs. Prefer accessibility then bounded screenshot/pixel interaction with observe/act/verify, window-target lease, foreground safety, per-action authorization and stop control. Windows Session 0 cannot impersonate an interactive user. Wayland/X11 and headless virtual/private sessions require their own consent and compatibility tests; protected OS surfaces may be UNSUPPORTED.
- **Browser Commander:** independently owned CEF/Chromium UI, and qualified Playwright/CDP/WebDriver adapters for Chromium, Firefox and WebKit; tabs, download, multi-profile/session isolation, background automation, approved foreground/native-profile attach; no extraction or cloning of browser passwords/cookies.
- **chat-on-steroids (totec448-spec/chat-on-steroids):** target equivalent Workspace GUI, task/project boards, concurrent Workers, Goal/Loop, Compact & Resume and progress UX. Vetted reusable components/patterns only after license/compatibility tests; not a competing coordinator, Brain or Runner. Full UI copy/feature parity is NOT YET implemented.
- **codex-chatgpt-web (miuuyy/codex-chatgpt-web):** opt-in Codex harness, context management and MCP bridge, with explicit provider/route and permission controls, not silent Work usage, copied credentials or assumed quota exemption.
- **Control Center:** live device fleet, users/accounts/profiles/seat, permissions and revoke, GUI windows and Browser sessions, task queues/Worker status, project evidence, faults, versions, health and migrations. User-facing dashboard truth must match backend receipts.
- **Multi-chat/multi-device:** one chat → many hosts, multiple authenticated chats → one host, multiple users → many hosts. Run independent read-only and isolated work in parallel; one authorized writer per canonical resource with distributed fenced leases and no overlapping physical GUI input.

## 10. Active product-level V2 implementation roadmap (ordered gates)

This is the **single current Commander V2 product roadmap**. Historical PROJECT_ENGINE_ROADMAP remains subsystem history. Technical acceptance and release status belong to PROJECT_BRAIN and RELEASE_AUTHORITY respectively; design approval never changes operational status.

| Gate | Deliverable / dependency | Definition of PASS | Verified status at decision |
|---|---|---|---|
| R0 | Reconcile 5 hosts, installed versions, OS users, ALL profiles, tunnel enrollment and protected key references; protect working routes | Exact read-only inventory, owner-scoped identities, evidence and offline list | PARTIAL; four reachable, MMZ unavailable, complete profile census OPEN |
| R1 | One core/component/installer manifest and capability matrix across Windows/Linux/Headless | Exact-source clean staged start; no rival installs or service loss | OPEN |
| R2 | OAuth + trusted owner identity + multi-chat RBAC and scoped grant/revoke | Real provider/client and 2 real ChatGPT chats with isolation and revocation | PARTIAL source; operational G1/G2 OPEN |
| R3 | Global Coordinator / fenced locks / durable recovery | Two chats/hosts sharing a real resource; lease expiry, lost ACK, restart and conflict safety | PARTIAL source: trusted global-resource mapping and fenced WorkflowStore adapter, Linux/Windows QA; live authenticated cross-host service, inventory and actuator-side atomic fence OPEN |
| R4 | Universal native GUI / owner-bound window Worker | 2 unrelated apps per interactive OS, real observe/act/verify, consent and safe fallback; headless policy tested | PARTIAL: private Linux GTK AX read on seats A/B live PASS; native act/verify, consent, Windows and all-app E2E OPEN |
| R5 | Browser UI/CEF, cross-engine automation and profile isolation | Qualified CEF build, Chromium/Firefox/WebKit compatibility, real multi-tab/download/session tests | OPEN |
| R6 | CoS Workspace/Workers/Compact-Resume, optional Codex context | UI feature checklist, licensed modules, bounded worker/merges/recovery and correct provider routing | OPEN |
| R7 | Unified Control Center fleet/user/project/permission management | Live reconciled dashboard; immediate grant/revoke and monitoring E2E | OPEN |
| R8 | Lossless V1/current-install → V2 migration | All existing profile, Tunnel ID, credential-reference, account, project and receipt mappings preserved and tested | OPEN |
| R9 | Exact version qualified on all 5 hosts; Stable release | Independent Windows/Linux/Headless CI/security, installer, native GUI, 2-user/2-chat, canary and recovery/rollback receipts | NOT FINAL |

**Critical dependency chain:** R0 → R1/R2 → independent R3–R6 where safe → R7 → R8 → R9. Work on independent code/UI tests while operator OAuth or a powered-off host blocks live acceptance; never treat those gates as PASS. Source PR #426 at prior head a9632af09234b61bf639a42f55318e007b7a28f7 passed 171/171 isolated Windows V2 tests and hosted CI/Windows NoPromote, **not** live V2 or V1→V2 profile migration. Four currently reachable Commander devices reported 0.11.0-dev.18 and TRUSTED_PROFILE_NOT_AUTHENTICATED_CHAT; MMZ laptop's tunnel was unavailable. V2 major release remains Draft and not Stable.

## 8. Current checked facts (scope-limited; not a fleet audit)

- On 2026-10-28 the connected `aliemad-Labtop` reported Core version `0.10.26`, native workflow/durable operations and owned background browser tools.
- Its observed workflow scheduler had `automaticExecution=false` / `runnerConfigured=false`; writer locking `oneWriterScope=machine`, not global; the browser/GUI session ownership requires separate verification.
- The GitHub `main` snapshot used for this change was `92620bfb350424d50316f396f8f98d049848c5a8` (not claimed equal to installed version).
- Earlier source candidates, browser/UI draft work, unsigned previews and historic QA receipts remain separate. No unified multi-device installation, per-chat authentication, source integration or new release is claimed.

**Next execution path:** implement A+B (schema/Coordinator identity and fenced locks) in isolated worktrees; implement C/D/E independently behind capability-verified adapters; finish F/G with exact-head native verification. Continue from the existing project Brain and release gates; do not restart the project or treat this architecture agreement as release acceptance.
