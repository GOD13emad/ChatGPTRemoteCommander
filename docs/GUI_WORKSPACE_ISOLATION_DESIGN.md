# Commander independent workspaces — architecture and scoped implementation

Status: **isolated QA pilot**, not operational deployment or owner approval.
Baseline: ChatGPTRemoteCommander PR #249, head \`0faa96339db1d71fdc05f6a78d1beacbc81e0767\`; isolated Windows worktree branched from the exact tested local equivalent \`a996dc8dc56a44cd409ab1df2a38ba3ac8b1d18d\`.
This is a **design decision/evidence record**, not a second Project Brain, index or roadmap authority.

## Accepted user requirement

Any number of independent Commander profiles/chats may work concurrently, subject to an explicit machine resource budget. A person may continue working on their own desktop. A supervisor may view an agent's session and, where independently authenticated, collaborate with it. Neither an unrelated physical mouse movement nor a different worker's activity may freeze every agent.

**Cannot promise:** Two independent controllers changing the very same UI element or shared file at exactly the same instant without conflicts. Isolate the workspaces, then coordinate only operations contending for the *same* workspace resource. A single Windows input desktop cannot provide multiple physical input cursors; Windows Virtual Desktops are not RDS sessions.

## Decision: route by target capabilities, not shared physical input

Routing priority (highest suitable):

1. **API/CLI/file backend:** use the application's supported API or a background CLI. No graphical focus, isolated auth/context and explicit filesystem write coordination.
2. **Browser Worker:** one independent headless Chromium/Firefox process and disposable browser profile per concurrent \`browser_session_begin(mode:"isolated")\`. CDP DOM and screenshots operate inside that process without taking over the host's desktop. A different task retains its own helper and lease.
3. **Native Desktop Worker:** a genuinely independent display/session, not an invisible cursor overlay on the user's main desktop. Linux: an X11 virtual server (Xpra desktop on Xvfb/Xdummy) or distinct authenticated GNOME RDP Remote Login session where supported. Windows: separate VM for durable arbitrary-GUI jobs or licensed Windows Server RDS/VDI sessions. UI Automation patterns may be used for reliable semantic actions on eligible controls but are not universal input isolation.
4. **Human console:** a legacy compatibility path only, requiring user-scoped explicit current-task takeover. Never advertise it as a noninterfering concurrent worker.

\`\`\`mermaid
flowchart TD
    Chat[Chat / Commander profile] --> Router[Workspace-aware dispatcher]
    Router --> API[Native API or CLI worker]
    Router --> Browser[Private headless Browser Worker]
    Router --> Desktop[Private OS Desktop Worker]
    Browser --> Capture[Workspace-specific state and image stream]
    Desktop --> Capture
    Capture --> Observer[Supervisor: view-only by default]
    Observer --> Handoff{Authenticated control handoff?}
    Handoff -->|yes| Action[Same-workspace input arbitration]
    Handoff -->|no| Read[Read-only observation]
    Action --> Reconcile[Agent re-observes changed target state]
\`\`\`

**Identity contract (future native desktop):**
\`workspaceId\`, host ID, \`ownerProfile\`, OS session/display ID, backend, controller capability, read-only observer capability, expiry, process identity, resolved target, durable state. Raw browser cookies, OS credentials and desktop pixel contents must not appear in registry status or audit logs. A screenshot token is not an authorization to mutate. Never trust client-supplied \`DISPLAY\`, Windows SessionID or process ID as a grant.

## What is implemented now: isolated Browser Worker pool

Modified \`src/browser-tools.mjs\` reuses the existing Browser Controller and browser-control helper, creating a separate helper + headless browser process per **explicit isolated** browser session. A bounded process pool (currently three active sessions per Commander Core; capacity is fail-fast, not a global queue) routes existing tool calls by opaque lease and validates the source Commander instance/profile before acting.

- The existing \`mode:"persistent"\` single-controller behavior is preserved.
- Isolation is at the browser **process + profile directory** level (stronger process separation and higher resource cost than a Playwright in-process BrowserContext). No existing user browser profile or password store is reused. **This is functional isolation, not a hostile-same-OS-user security boundary:** private processes launched under the same OS account can still potentially access each other's local resources. For mutually untrusted accounts use separate OS principals/VMs and appropriate filesystem/network isolation.
- Browser \`status\` reports only a count for the current profile and the shared capacity. It does not disclose another profile's sessions.
- The private worker rejects \`browser_foreground_begin\` even if legacy configuration allows foreground fallback. A future supervisor/control UI must attach explicitly to the private target.
- Live permission revocation from the current config is checked before subsequent operations.
- TTL cleanup, explicit end and Core close terminate owned helper/processes. Wrong-profile or expired lease fails closed. Each worker has independent in-flight request state and may be cancelled without terminating other workers.
- Network policy, URL/selector validation, CDP timeouts and error reconciliation continue through the original Browser Controller.
- Workload concurrency is **resource-limited**, not unbounded. The pilot's three worker slots are not a measured fleet-wide capacity guarantee.

**Tested evidence:**
- Two concurrent real Chromium headless workers each filled/clicked their own localhost fixture and returned independent screenshots with no host foreground request.
- Two concurrent \`executeBrowserTool\` leases in the **same Core/profile** independently navigated, filled and clicked; text stayed private to its corresponding worker.
- Worker teardown was corrected after an initial test process stayed alive due to an unclosed legacy status helper. Re-run fully exited with zero leaks observed in the test process.
- Unit regressions cover same-profile isolation, distinct-profile lease ownership, limit rejection, TTL expiry, foreground denial, legacy compatibility and permission revocation.
- These results are **Browser backend acceptance in isolated QA**, not a native Desktop Worker or supervisor acceptance.

## Lifecycle race and capacity safeguards (isolated QA continuation)

Worker lifecycle is **per workspace**, not one global browser mutex. The isolated pool now reserves capacity before asynchronous startup; a Core close waits for pending starts to resolve and ensures an already-in-progress startup cannot publish a new lease after shutdown. A close/end request while that same workspace has an accepted action is rejected with \`BROWSER_BUSY\`, rather than killing the active helper. A Core-wide shutdown waits for each active workspace action to finish its bounded operation before closing that workspace's browser child, concurrently across unrelated workers.

An expired lease with an in-flight accepted action remains isolated and is reaped only after that action returns. Worker closing is idempotent; a cleanup failure yields \`BROWSER_POOL_CLEANUP_FAILED\` instead of falsely reporting clean shutdown. New disposable negative tests cover pending-start close, busy session end, Core close while active, TTL expiry during an active request, and a simulated failing native child teardown. All focused units pass in isolation. These guarantees do **not** imply that a network operation is reversible after it was accepted.

**Timing evidence:** three sequential real Chromium executions (23 tests each) passed with no failures. An earlier default multi-file concurrent harness run recorded 22/23 PASS with one \`BROWSER_NATIVE_FAILED\` on the first of two real-browser scenarios while the second passed. Root cause of that intermittent browser helper error has **not** been proven; do not classify unrestricted four-browser saturation as accepted, relax OS protection, or claim it is solved merely by serial test scheduling. Keep real-browser stress, memory limits and cleanup under watch before rollout.

## Workspace-scoped observer frame relay (internal QA)

A read-only observer capability has been added directly to the existing isolated Browser Worker pool. It is **not** a new service, URL, public MCP tool or authenticated supervisor product. By default \`authorizeObserverGrant\` returns **false**; only an independently trusted management integration may authorize issuing an observer grant, and the internal authorizer receives a non-bearer SHA-256 workspace reference rather than the owner's mutation lease.

- The workspace owner must hold the exact active lease and permit screenshots; an approved grant is scoped to one target viewer principal (from trusted runtime context), one worker and 10–180 seconds.
- Each worker permits at most four observers; the entire pool permits at most sixteen. Grants have independent cryptographic tokens, are revocable, expire with the worker lease, and are invalidated upon worker cleanup or Core shutdown.
- Observers cannot invoke any browser operation, take Focus, type, click or move the host cursor. They read only **one previously captured, bounded image** already returned from that private Browser Worker to the owner. Reading costs no helper call and cannot block an active agent operation.
- Frames are only retained if a currently authorized observer grant is active. The cache holds one image (up to 1 MiB, no DOM/cookies/credentials), is cleared on final revocation or workspace disposal, and is flagged **stale** while an action is executing, after a mutation, or when the frame age exceeds 30 seconds. A viewer cannot demand an extra screenshot or falsely claim a continuously streaming/live image.
- Current viewer policy (\`allowScreenshot\`) is checked on every read; revocation of the viewer's permission immediately rejects subsequent frame reads. Frames already disclosed cannot be recalled.
- The viewer principal must be bound by the host's authenticated supervisor/monitoring service, not supplied as an arbitrary claim by an untrusted chat. This authentication integration and a real streaming supervisor UI are **open gates**.

**Evidence:** unit tests reject unauthorized grants, wrong-profile access, expired credentials, forged authorizer exceptions, excessive observers and input/tool access. A real private Chromium page was captured by its agent, returned through the viewer relay, then marked stale after owner mutation; the viewer received the bytes without any GUI input or extra CDP call. These are scoped QA results and **not** permission for remote human control.

## One-workspace human control handoff (internal QA, default denied)

The same private Browser Worker pool now accepts an **internally authorized** temporary control handoff. No new listening server, MCP tool or public control endpoint exists. The \`authorizeControlHandoff\` callback is DENY by default; a future protected monitoring UI must authenticate the actual operator and verify owner consent for the *specific workspace* before enabling it. Text from a chatbot cannot turn this on.

1. Grant an operator-specific cryptographic token for **one** private browser worker, only when that worker is idle and its owner has permission for input. A second human controller cannot acquire the same workspace concurrently. Other workers have completely separate child processes and input queues.
2. The owner AI may still view its page, but its Click/Fill/Navigate operations **on the handed-off workspace only** are rejected with \`BROWSER_WORKSPACE_CONTROL_HELD\`. All unrelated AI workspaces remain operational.
3. The operator's allowed actions in the QA adapter are bounded DOM \`browser_click\`, \`browser_fill\`, \`browser_snapshot\`, and \`browser_screenshot\`, through the **same private headless helper**. Physical mouse/keyboard and the user's WinSta0 desktop are never touched. There is no coordinate-based human pointer streaming yet.
4. The operator token expires after 10–120 seconds, is bound to its principal and worker, and can be explicitly revoked by the workspace owner. In-flight work must complete before release; an unexpected backend failure is not blindly replayed.
5. After handoff ends or expires, owner mutations on that workspace return \`BROWSER_WORKSPACE_REOBSERVATION_REQUIRED\` until a **fresh successful DOM snapshot** is taken. A snapshot while the handoff is active cannot clear that requirement.

**Scoped evidence:** negative tests cover failed authorization, operator identity mismatch, live permission revocation, handoff expiry, forbidden action types, other-worker progress, owner mutation denial and post-handoff re-observation. A real Chromium test with two independent headless processes showed the human operator's scoped Fill/Click changed only one worker, the other worker continued, and the owner resumed only after re-reading its DOM. No session or main-screen GUI was changed. This is an internal tested contract, **not an operational supervisor with mouse/keyboard attachment**.

## What is NOT implemented

1. **Independent Windows GUI workspaces:** Windows 11 Pro has one currently active WinSta0 input desktop per interactive window station. Multiple Windows Virtual Desktops do not create separate input device streams. A VM/isolated RDS session must be provisioned with correct OS, license, account and resource authority. Existing Windows global/local mutex code in PR #249 is a compatibility safety guard, not this architecture.
2. **Independent Linux native GUI workspaces:** the Emad Laptop runs GNOME 50.1 / Wayland and had ~2.3 GiB available RAM at assessment. No Xpra or Xvfb was installed. The Ubuntu archive had no Xpra candidate; a portable Xvfb executable and dependencies were checked via user-local QA, **but** direct Linux GUI/input shell execution is blocked by Commander host policy. This restriction was respected; virtual pointer/keyboard acceptance is **not PASS**. Any native GUI pilot must run via explicitly authorized GUI APIs or a vetted workspace-control plugin.
3. **Observer UI / collaborator input:** there is no authenticated read-only stream token, workspace-scoped human-control handoff or per-target revision conflict detector yet. Showing a screenshot is not the same as letting a supervisor control a private worker.
4. **Trusted owner Incident broker:** neither the previous one-time elevated recovery scripts nor the existing same-user artifact markers satisfy this security boundary. PR #249 remains Draft pending independent MMZ review.

## Supervisor interaction policy

- **VIEW**: authenticated observer receives only selected workspace frames/DOM state, never browser session cookies, terminal credentials or native input lease. Many observers may watch concurrently. For an Xpra desktop backend, use its native **readonly** session privilege (no pointer or keyboard events) and authenticated encrypted access; avoid unrestricted shadow of the user's real console.
- **CONTROL**: authenticated, limited-time, explicit *workspace-specific* handoff grants a human input channel. The worker may continue API/background tasks and other workspaces stay active. In the same target, action-level ownership or optimistic revision checks must prevent two writers applying stale observations to the same control.
- **RESUME**: the agent re-reads the affected DOM/window state after a human action before choosing its next action. If effects are uncertain, the local target action becomes \`RECONCILIATION_REQUIRED\`; never blind-replay. A watcher disconnect must not kill a worker's private desktop.
- **AUDIT**: record workspace identity, actor role, logical action ID, scope, revision and outcome. No passwords, typed secrets or raw screenshots in ordinary operational logs.

## Environment / cost decision

| Platform | Current evidence | Smallest viable independent backend | Limit |
|---|---|---|---|
| Saeid Windows 11 Pro | Ryzen 9950X3D, ~47 GiB RAM, Chrome installed | Private headless CDP Browser Workers **tested** | VM isolation for arbitrary GUI requires OS provisioning |
| Emad-PC Windows 11 Pro | i9-13900KF, ~128 GiB RAM, hypervisor present | Browser Workers; consider Hyper-V VM pool after authorized hardware/OS validation | No multiple interactive cursors on one WinSta0 |
| Emad Laptop Ubuntu 26.04 | GNOME 50.1 Wayland, 14 GiB total, ~2.3 GiB RAM available at check | Lightweight X11/Xpra or headless remote login after memory/permission validation | Not accepted; no authorized private GUI-input backend yet |
| Windows Server / managed VM host | RDSH/VDI capability depends on installed roles and licensing | One guest/session per worker | RDS CALs and authenticated session management required |

Do not bypass Windows session/licensing restrictions or disable host GUI security to provide multi-seat appearance.

## Acceptance gates and migration

1. **Browser candidate (scoped):** syntax; legacy Browser regression; isolated pool unit+stress; two actual browsers in same Core; cleanup/TTL/permissions; negative cross-owner tests; zero host foreground effect in real tests. Then full check/test/security audit on exact tree and hosted CI before promotion.
2. **Native per-platform proof:** create two isolated real desktop backends and show distinct logical display/input devices (including supervisor read-only inspection) *without accessing the human console*. Run app-specific tests for target software. No pass from read-only package detection.
3. **Viewer and controller:** proof of observer-only capability, revocable time-bound handoff and re-observation after external changes; unrelated workers must continue. Validate after worker crash/disconnect.
4. **Workspace-specific incidents:** bind durable uncertain native operations to worker ID + target OS session/display and protect state. Process restart must neither replay nor globally freeze other workers. A trusted OS-local owner broker is a separate security gate, not an implicit byproduct of this routing.
5. **Controlled rollout:** retain legacy physical-desktop mode opt-in, canary on one non-operational worker, check resource/cpu/memory and rollback, independent MMZ review before production/merge. Do not change the installed \`0.10.24\` GUI while the migration remains in QA.

## Authoritative design inputs

- Microsoft Window Station / Desktops: https://learn.microsoft.com/en-us/windows/desktop/winstation/desktops
- Microsoft RDS sessions: https://learn.microsoft.com/en-us/windows/win32/termserv/about-terminal-services
- Microsoft RDS CALs: https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/rds-client-access-license
- Microsoft UI Automation patterns: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview
- Chromium Playwright BrowserContext: https://playwright.dev/docs/api/class-browsercontext
- Playwright independent page focus: https://playwright.dev/docs/pages
- Xpra desktop mode: https://xpra-org.github.io/xpra/Usage/Desktop.html
- Xpra readonly/session-sharing and authentication cautions: https://xpra-org.github.io/xpra/Usage/Security.html
- Xpra seamless/shadow: https://xpra-org.github.io/xpra/Usage/Seamless.html
- GNOME system RDP remote login: https://github.com/GNOME/gnome-remote-desktop/blob/main/docs/configuration.md
