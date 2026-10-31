# Commander unified product architecture

**Decision:** accepted owner target architecture, 2026-10-28. **Implementation:** partial / not fully qualified. **Release:** no new release authorized by this design document.

This is a technical architecture specification, **not** another Project Brain, roadmap or release authority. [Project Brain](PROJECT_BRAIN.md) remains the single continuity entry point; [Release Authority](RELEASE_AUTHORITY.md) governs build, signing, admission and publication. This document supersedes the *future product topology* portions of earlier multi-product and Codex-exclusion proposals, not their verified historical test evidence or immutable releases.

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

### Hybrid AgentOS provider priorities — scoped PR #434 candidate, 2026-10-30

Commander remains the one MCP gateway, identity/authorization authority, profile manager, operation journal, project/workflow coordinator and fleet updater. Native OS integrations are optional backends within this product, **not** a second launcher, bypass for admin rights, or a separate coordination engine.

| Target | Preferred backend | Verified scope |
|---|---|---|
| Application-specific Windows action | Microsoft UFO² AppAgent / WinCOM / native application API, when separately installed and granted | Future approved upstream integration; **UFO² is not deployed** by this PR |
| General Windows desktop app | Native Windows UIAutomation InvokePattern with exact PID/HWND and owner session | Direct non-CUA No-button real-app E2E on HPC-154; PR code still in review |
| Linux desktop app | Owner AT-SPI semantic controls on X11/Wayland | Existing private-seat E2E, no new AgentOS Linux package |
| New, isolated browser | Commander-owned browser; optionally Playwright/Chrome DevTools MCP | Commander-owned E2E accepted; external MCP drivers not installed by this PR |
| Already authenticated browser | Supported native browser-consent/CDP/Playwright route | Not solved by UIA alone; never copy browser passwords/cookies |
| Unsupported nonsemantic control | Existing target-bound CUA visual fallback | Consent-bound last resort; no automatic foreground control |
| Reasoning, planning and resume | Current Chat-owned Commander Workflow; optional authenticated Codex app-server worker | Existing Workflow stays authority; Codex agent-server NOT newly installed |

Chat request → existing Commander device/user/task binding → capability and policy check → choose strongest available provider (`workspace_agentos_plan`) → exact observe (`workspace_native_ui_observe`) → authorized native action (`workspace_native_ui_invoke`) → independent application-result verification → durable receipt. An InvokePattern acknowledgment is not proof of user-goal completion. Lost acknowledgments fail closed without blind replay.

**Focus-effect qualification (2026-10-30):** Real native UIA on HPC-159 and HPC-154 verified isolated test-button action independently, but disconnected-RDP foreground observation may be unavailable. A separate active owner-console test on Emad-PC reached the No-button result and then detected a changed foreground window; it **failed** the strict noninterference acceptance gate. Earlier native output unconditionally reported `foregroundTouched=false`; this is superseded. The revised executor measures Win32 `GetForegroundWindow` before/after every semantic action and returns `PRESERVED`, `CHANGED` or `UNOBSERVABLE`. Only measured `PRESERVED` may qualify as focus-safe; `CHANGED` and `UNOBSERVABLE` retain an acknowledged action but report `ok=false` for noninterference, with no automatic re-execution. This is observation, not proof of causation when a human independently changes the foreground. For strict no-interference use a qualified isolated desktop or application-native/background API. No synthetic active-console retest is authorized until that isolation exists.

Primary sources: [Microsoft UFO² overview](https://github.com/microsoft/UFO/blob/main/documents/docs/ufo2/overview.md), [Microsoft AppAgent hybrid execution](https://github.com/microsoft/UFO/blob/main/documents/docs/ufo2/app_agent/overview.md), [OpenAI Codex app-server](https://learn.chatgpt.com/docs/app-server), [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp), [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp).

**PR #434 acceptance scope:** one Windows-native UIAutomation executor, an optional-capability router, three owner-aware MCP entrypoints and a qualified test contract. No production promotion or 5-host V1 acceptance. Remaining gates: hosted exact-commit CI, independent reviewer, safe managed installation/rollback, real owner-session target acceptance across Windows devices, app-native provider integration and official browser/OS approvals.

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

## 8. Current checked facts (scope-limited; not a fleet audit)

- On 2026-10-28 the connected `aliemad-Labtop` reported Core version `0.10.26`, native workflow/durable operations and owned background browser tools.
- Its observed workflow scheduler had `automaticExecution=false` / `runnerConfigured=false`; writer locking `oneWriterScope=machine`, not global; the browser/GUI session ownership requires separate verification.
- The GitHub `main` snapshot used for this change was `92620bfb350424d50316f396f8f98d049848c5a8` (not claimed equal to installed version).
- Earlier source candidates, browser/UI draft work, unsigned previews and historic QA receipts remain separate. No unified multi-device installation, per-chat authentication, source integration or new release is claimed.

**Next execution path:** implement A+B (schema/Coordinator identity and fenced locks) in isolated worktrees; implement C/D/E independently behind capability-verified adapters; finish F/G with exact-head native verification. Continue from the existing project Brain and release gates; do not restart the project or treat this architecture agreement as release acceptance.


## Linux AT-SPI native read-only gate — 2026-10-31

**SOURCE ONLY / NO PROMOTE.** Linux AgentOS routing no longer equates `XDG_RUNTIME_DIR` with a functioning AT-SPI bus: a real owning-user introspection probe is required. The new `workspace_native_atspi_observe` handles only an exact PID, caps traversal/results and provides no input, focus, credential, profile attachment or elevation capability. Python GObject Introspection + AT-SPI2 are optional, and unavailable dependencies fail closed; this is not proof of on-device E2E or cross-host deployment. References: [GNOME AT-SPI](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/) and [XDG RemoteDesktop](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html).


### Honest live browser readiness — 2026-10-31 (PR #438)

`workspace_agentos_plan(new-browser)` must probe the actual browser backend and policy of the same owning session through `browser_status`; it cannot return READY merely because a Commander source file exists. A Windows SYSTEM/Session 0 token, missing browser binary, disabled policy, existing lease/busy state or uncertain session fails closed. Existing user profiles still require platform-mediated owner authorization; no saved-cookie/profile copy. This is a read-only planning correction, not a runtime cutover or browser owner approval. The regression suite covers actual positive/negative status and service-context guards.


### Linux PID owner boundary — 2026-10-31

Before traversing the AT-SPI tree for a requested PID, the helper verifies Linux `/proc/<pid>/status` real UID matches its unprivileged owning user. It checks again before returning observed element metadata, refusing cross-user/missing/reassigned targets. Root-executed observation is refused. This enforces the one-principal desktop bridge even in shared X11 sessions; it does not grant cross-user access or bypass the target application. The private test fixture only checks the negative path against a foreign-owned PID. **SOURCE ONLY / NO PROMOTE** until live owner-session and review acceptance.


### Linux RemoteDesktop Portal v2 detection — 2026-10-31

`workspace_linux_portal_status` queries the owning session's D-Bus RemoteDesktop interface version without creating a session, requesting consent or controlling input. `available=true` means interface v2 support, not user authorization: `interactionAvailable=false`, `consentGranted=false`. After explicit portal Start approval, a future separate libei device agent may call ConnectToEIS. On aliemad-Labtop the read-only D-Bus call reported version 2. Current stage remains SOURCE ONLY / NO PROMOTE. Primary docs: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html ; https://libinput.pages.freedesktop.org/libei/ .


### Windows SYSTEM handoff: unknown status must not become idle — 2026-10-31

The pre-existing scheduled `ChatGPTRemoteCommander-UserSessionHandoff` task runs as SYSTEM. The source handoff script previously treated failed localhost status RPC as active=0 and leases=0, permitting stop of SYSTEM-owned processes without confirmed idleness. Source now requires verified nonnegative active+lease counters; unknown, missing or negative status returns known=false and defers before shutdown. Pester-free Windows AST/function tests verify mock cases without invoking the full script. **SOURCE ONLY / NO PROMOTE.** Live PC scheduled tasks still reference an executable and script ACL-writable by the owner account and another user SID; this update does not alter task ACLs or runtime services.


### Cursor observation independent of synthetic mouse input — 2026-10-31

Owner GUI delegation on Emad PC was confirmed: observe lease and read-only status succeeded, but `gui_cursor_position` returned `OWNER_GUI_RPC_REJECTED`. Authenticated local diagnosis recovered only the safe backend error code `GUI_CAPABILITY_DISABLED`; `allowMouse` is intentionally disabled in the owner observer policy. The cursor read contract previously depended on the same `allowMouse` capability as synthetic input. It now uses a derived read-only `allowCursorObservation` capability (existing screenshot/window-enumeration permissions or mouse permission), keeping mouse move/click/drag gated exclusively on `allowMouse`. The feature makes no input/focus changes. Isolated Windows controller and delegation suites **96/96 + 25/25 PASS**. **SOURCE ONLY / NO PROMOTE** until deployed owner-seat E2E and independent security review. Microsoft [UIA patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-clientsoverview) inform semantic over synthetic input control.


### SYSTEM task action ACL trust-chain read-only preflight — 2026-10-31

This source-only `tools/windows-system-task-trust-audit.ps1` audits SYSTEM Commander Scheduled Task executable and `-File` script paths, regular files, ancestors, reparse points, owners, and effective Allow ACEs. The scanner reports risk but performs no task, ACL or service mutation. A Windows fixture tests a user-writable path (must fail), a protected Windows executable (must pass), and empty task discovery; the test is wired into `npm run check`. Historical CI is not inherited by this change.

Live read-only evidence: Emad-PC-Ultimate: 4 of 4 action paths unsafe (two SYSTEM tasks, both executable and script under user-writable profile ancestry); HPC-159-17: 3 of 6 unsafe (three SYSTEM tasks, executable under protected Program Files is safe, scripts under writable profile paths unsafe, including one disabled task). HPC-154-66: no Commander SYSTEM tasks matching this name convention; not a comprehensive audit of every scheduled task. The implementation explicitly excludes an InheritOnly ACE on its parent, and treats TrustedInstaller as a trusted owner, avoiding a false alarm for Program Files. The user's access to administrative tools is not evidence that these ACL defects are fixed.

Mandatory before live cutover: immutably pin and stage code/dependencies under an admin/SYSTEM-protected installation root; verify each parent chain and signature; export exact task XML, preserve prior operational health and rollback; switch action paths only after isolated owner-seat and SYSTEM functional preflight. No destructive task re-registration or privilege change has occurred. Sources: Microsoft [Security Contexts for Tasks](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks) and [icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls). Status SOURCE-ONLY / SECURITY HOLD / NO PROMOTE.


### Definition digests and fail-closed migration readiness — 2026-10-31

Existing read-only trust auditor now hashes in-memory `Export-ScheduledTask` XML and each PowerShell script with SHA-256; only digest and parser/closure flags are emitted (no raw XML or credentials). `accepted` remains ACL-only, and `migrationReady=false` is explicit until full dependency closure, owner E2E and independent security review. This is necessary because current BootRecovery launches other source files and configured executables; copying one script does not close the trust boundary. Microsoft [Export-ScheduledTask](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/export-scheduledtask) covers definitions, not external dependencies. No installed task or ACL was altered.


### Runtime-only tunnel process identity and exact profile matching — 2026-10-31

The optional runtime-only `openai/tunnel-client v0.0.18` executable has a different filename, `tunnel-client-runtime.exe`, than the currently installed full `v0.0.15` binary `tunnel-client.exe`. The previous supervisor `Get-TunnelProcess` hard-coded the full-client basename and could not observe a runtime-only owned process, risking duplicate starts and bad ownership decisions if switched untested. The source supervisor now restricts supported process basenames to these two exact Windows names and derives the CIM process filter from the already-resolved expected executable path; it retains exact executable-path and named-profile matching. An isolated PowerShell AST/mocked CIM fixture tests both flavors, wrong profile/path rejection and unknown basename refusal without launching, stopping or authenticating tunnels. **No live task or Runtime cutover.** Actual tunnel v0.0.18 interoperability, credential handling, owner-session GUI E2E and independent security review remain open. Official [OpenAI runtime documentation](https://github.com/openai/tunnel-client).


## HYBRID_ENGINE_PROVIDER_SURVEY_20261031 — external infrastructure evaluation and candidate implementation

**State:** CANDIDATE ONLY; no production cutover, external service installation, user credential collection, operating-system escalation or stable release. This is an amendment to the existing architectural authority, not a second roadmap. Official upstream sources surveyed 2026-10-31; no claim of enumerating the entire Internet. Pricing, license and version details must be verified again before deployment.

| Commander layer | Alternatives surveyed | Recommended responsibility / acceptance |
| --- | --- | --- |
| Durable local workflow | Commander durable-workflows-r2, DBOS, Restate, Temporal, Inngest | **Keep Commander local journal** as the single authority for native action intent/receipt and reconciliation. DBOS needs PostgreSQL; double-journaling effects would create replay ambiguity. |
| Fleet DAG/queue | Hatchet, Temporal, Restate, Inngest, Windmill, DBOS, n8n | Hatchet = first **PoC candidate** for distributed scheduling/dashboard; Temporal = strong long-lived replay alternative; Restate = durable service RPC alternative. None is an approved/install-ready drop-in replacement. |
| Event bus | existing routed MCP transport, NATS JetStream | Preserve existing transport. JetStream optional for durable at-least-once interdevice messages, never exactly-once physical/GUI effects. |
| Identity/authorization | Commander owner-session SID/UID and grants, Cedar, OpenFGA, OPA, Tailscale Grants | Existing native OS boundary and Commander deny-by-default must always prevail. An external PDP may add denials, not grant OS/session rights. |
| Windows GUI | application-native APIs/UFO2, UIA patterns, CUA | Native API if owner-approved; then exact UIA; CUA for exact approved target only. SYSTEM session cannot silently impersonate user. |
| Linux GUI | AT-SPI, XDG RemoteDesktop Portal v2, CUA | Verified owner AT-SPI first; Portal Start presents actual consent; visual last resort. No global input/focus stealing. |
| Existing browser | Playwright, CDP, Commander Browser lease | Prefer owner-authorized DOM, not default-profile debug switch or cookie extraction; Chromium 136 limits default-profile remote debugging. CDP attachment has lower fidelity than Playwright protocol. |
| Isolated browser | Playwright, CDP, Commander owned Browser | Owned, isolated, background profile; no credential cloning. |
| Model runtime | Colibri, llama.cpp, Ollama, vLLM | **Colibri is a local MoE inference runtime, not workflow orchestration.** llama.cpp broad CPU/GPU choice; Ollama simpler local setup; vLLM GPU serving. Optional, only if healthy, installed, licensed and explicitly authorized. |
| Agent/plan | Commander Project Engine, Pydantic AI, LangGraph, Codex app-server | Commander remains the one executor/journal; external planners propose work, never grant host access. Do not attach two durable engines to the same effects. |
| Control Center | existing UI, Tauri v2, Electron, Windmill UI | Continue existing UI. Evaluate Tauri v2 per-window capabilities before native packaging; no second privileged UI broker without security review. |
| Telemetry | Commander receipts, OpenTelemetry, Prometheus | Local receipts remain authoritative. Optional export requires explicit opt-in, redaction and trusted endpoint; never propagate secrets through trace baggage. |
| Installer and host lifecycle | Commander managed supervisor, Windows service/Task, Linux systemd | One effective installation per physical host; trusted executable/config and complete SYSTEM/root dependency chain with rollback and native UAC/sudo authorization. |

**Implemented candidate integration.** The new src/hybrid-capability-engine.mjs is a pure, bounded, deterministic control-plane arbitration module. The existing src/agentos-provider-router.mjs invokes it only when a project-planning caller explicitly supplies hybridPlanRequested. Its result is a **plan**, not a live executor, and existing routing remains unchanged unless that flag is supplied. It cannot run a command, install an external engine, obtain privileges, attach a browser, export credentials or override Commander local execution policy.

The workflow plan requires a verified local journal and, for Fleet, an authenticated chat, the single-writer root lease, explicit fleet grant, healthy configured coordinator and verified policy. UNKNOWN/PENDING_UNKNOWN external effects require local reconciliation and may not replay. Interactive GUI/browser profile mutation cannot be dispatched through remote Fleet retries. Local model runtime requires explicit permission, installed/healthy backend and model-license approval. Optional policy engines can only add checks. Telemetry export requires redaction approval; GUI remains under native owner-session policies.

**PoC acceptance before any installation or promotion:** 2-host Windows/Linux DAG with authenticated chat isolation; one writer for one project root; deterministic duplicate-delivery/lost-ACK behavior; crash, restart and offline rejoin; no GUI replay for uncertain actions; revocation, pause/cancel, observability, resource/latency budget; roll back to Commander local-only mode; independent security review; pinned signed package and five-host acceptance. Machine SYSTEM Task trust and native owner GUI remain independent open release gates.

**Official sources**
- Hatchet https://docs.hatchet.run/self-hosting ; Temporal https://docs.temporal.io/tasks ; Restate https://restate.dev/
- DBOS https://docs.dbos.dev/architecture ; Inngest https://www.inngest.com/docs/self-hosting ; Windmill https://www.windmill.dev/docs/advanced/self_host
- NATS https://docs.nats.io/concepts/jetstream ; Tauri https://tauri.app/security/capabilities/
- Playwright https://playwright.dev/docs/api/class-browsertype ; Chrome https://developer.chrome.com/blog/remote-debugging-port
- Linux Portal https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html
- Windows UI security https://learn.microsoft.com/en-us/power-automate/desktop-flows/how-to/enable-ui-access
- OpenTelemetry https://opentelemetry.io/docs/languages/js/ ; baggage https://opentelemetry.io/docs/concepts/signals/baggage/
- Colibri https://github.com/JustVugg/colibri ; llama.cpp https://github.com/ggml-org/llama.cpp ; vLLM https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html

### Fleet bridge effect-intent protocol — 2026-10-31

**Candidate interface only (NoPromote).** The new src/hybrid-fleet-bridge.mjs is exported from the existing AgentOS provider router and its regression is included in npm run check. It is NOT connected to a live external Hatchet/Temporal/Restate instance. No second executor or effect ledger was installed.

The bridge accepts a bounded metadata-only scheduling intent (workflowId, stepId, requestId, targetDevice, provider, effectClass, epoch, deadlineMs). An injected host-trusted authorizer must verify the authenticated chat, owner-session authorization, root lease, fencing epoch, journal and provider health. Input booleans cannot establish those permissions. Only READ_ONLY and COORDINATION effects can cross this boundary; raw commands, credentials, GUI actions and browser profile mutations cannot.

The existing Commander journal must supply a durable and atomic reservation **before** any network send; only a fresh NEW reservation is sent. Duplicate requests, lost ACK, invalid ACK, failed receipt persistence or UNKNOWN outcome cannot trigger automatic replay. An accepted schedule is *not* a completed remote action. The envelope inspection validates metadata and hashes it, but does not cryptographically authenticate a remote principal or authorize execution.

Regressions cover concurrent reservations, duplicate attempts, lost ACK, malformed ACK, owner authorization/epoch, expiry and actual SQLite close/reopen preserving an UNKNOWN reservation. This is a protocol and fixture-level acceptance, not an authenticated two-host execution or full crash-injection proof. Integration of the injected journal with existing workflow-store, a real provider SDK, transport authentication, distributed root-lease fencing, independent security review and fleet E2E remain open.

Primary references: https://docs.hatchet.run/v1 ; https://docs.temporal.io/tasks ; https://docs.nats.io/concepts/jetstream ; https://docs.nats.io/learn/jetstream/delivery-and-acknowledgment .

### MMZ_SCHEMA_CONSTRAINED_LOCAL_LLAMACPP_20261031 — runnable local Planner provider (candidate)

**Status:** Candidate adapter only; no active Runner configuration changes or model execution rights granted. `tools/local-llamacpp-planner.mjs` is an opt-in **proposal-only** command provider for the existing `createCommandPlanner` interface, using a pinned loopback llama.cpp endpoint at `127.0.0.1:18080`, the already installed Qwen3-4B model alias, the owner's user-local 0600 key file, a strict four-field JSON Schema and `enable_thinking=false`. Context, output, timeout and credentials are bounded; keys and diagnostics are not logged or forwarded. It does not execute any proposed tool.

**Proof and limitation:** On MMZ Linux, a synthetic model request without strict schema returned an invalid `action=read_text`; the same model with schema responded correctly with `action=call, tool=read_text`. The new adapter passed six isolated tests in Windows Candidate and a live end-to-end invocation through Commander's actual `createCommandPlanner({kind:'command'})` on MMZ, proposing `read_text` of exactly `PROJECT_BRAIN.md` without execution. These tests do **not** prove Team Planner automatic Worker acceptance. Existing historical runs remain expired/blocked and were not replayed. To activate in a live enrolled workflow, the owner must apply the authorized runner provider configuration through the existing config lifecycle, preserving the one-writer, tool grants and rollback boundaries.

The adapter is not Colibri/Hatchet and does not confer GUI, root, or network privileges. Running a Planner is distinct from accepting its proposed side effects. Local machine model health, ModelProvider schema acceptance, project runner acceptance, protected SYSTEM route and 5-host Stable release are separate gates.
