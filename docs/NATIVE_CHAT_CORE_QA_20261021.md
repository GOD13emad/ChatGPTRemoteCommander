# 2026-10-21 — Native Browser Core managed ChatGPT tabs QA

Architectural authority: ChatGPT multichat observation/management is built into **Remote Commander Browser Core**, not Brave extensions or Native Messaging.

## Verified actual changes
- Core Chromium/CDP: `browser_chat_tabs`, `browser_chat_tab_open`, `browser_chat_tab_close` are lease-scoped tools. `allowNavigate` governs open/close, strict ChatGPT HTTPS origins are required, non-owner tab refs are denied, uncertain writes cannot be blindly retried.
- The Browser-owned helper directly subscribes to `Target.targetCreated/targetInfoChanged/targetDestroyed`; requests reconcile with `Target.getTargets`; raw chat IDs are not returned (ephemeral HMAC).
- Random 32-hex tab handles are scoped to the owned helper session, maximum **16 managed tabs**. Native Chromium instances run in isolated Commander profiles, not user browser profiles.
- Foreground relaunch is refused while multiple tabs are active, instead of silently discarding tabs.
- If a managed tab open/close outcome is ambiguous, a main-page DOM snapshot or read-only Target listing cannot prove that the tab mutation was applied or absent. Browser Core reports `sessionResetRequired` and blocks further browser mutations and foreground relaunch until the owned session ends and a fresh session is started; no blind replay of the opaque tab operation.

## Evidence
- MMZ `mmz-LOQ-15IRX9`: entire `node --test test/browser-*.test.mjs` -> **42 tests / 40 PASS / 0 FAIL / 2 SKIP**; operation `a0833454-1d52-4c2b-a636-21fcadee959c`, stdout SHA `5870984018ba47163ec7fa35a5a831781e90b151b4e3d7af59d1f1589015c3f4`.
- Real managed Chromium CDP E2E on MMZ and Brave-based Chromium E2E on Emad laptop: 12 tab opens, 1 targeted close (11 OPEN / 1 CLOSED), 16 managed tabs maximum reached, 17th rejected. No real ChatGPT account/login, no add-ons, synthetic URLs with DNS blocked. MMZ op `8bb278fd-d93e-4f47-bb79-7e5e4bc592a9`, Emad op `be833309-906c-4c41-a652-72803eaaf0ae`, both stdout SHA `0becaaa237036bcb55e0070d887ef86fe57dd429bd55bfc4be5befabeb05b3fb`.
- CEF standalone native C++ `NativeChatObserver`, `OnAddressChange` integration, and `rc_ui::kMaxNativeTabs=16` in isolated source branch. MinGW static C++ contract+strip capacity test on Emad-PC PASS, operation `1179b35a-8b40-4f54-8470-cc9d0831bc26`. This is **NOT** a full CEF product build/performance acceptance.
- Source changes tracked in isolated worktrees on MMZ and Emad; no active Commander service/profile altered. Existing GUI-uncertain incident remains unresolved.

- Supplemental 2026-10-21 PR #325 controller regression: the **pre-fix** ambiguous `chat_tab_open` + unrelated `browser_snapshot` test failed exactly as expected (`Missing expected rejection`), while the corrected open and close cases plus full Browser/12-tab/Unicode/check:qualification/test:qualification/audit sequence completed with exit 0 on MMZ. Durable operation `66fc2799-944b-42ee-ad9c-2d9caa3c264e`, stdout SHA-256 `776f304e9e073752db7366f69cf40d10c259afa602311a2ddc5efbc4f0da9439`. PR #325 exact head `d0356c86b6c6852d399a4aeabe7152ce76e7be36` subsequently passed hosted [Windows+Ubuntu CI](https://github.com/GOD13emad/ChatGPTRemoteCommander/actions/runs/39643283067), [Windows R157 NoPromote](https://github.com/GOD13emad/ChatGPTRemoteCommander/actions/runs/39643283044) and CodeQL check `119372455244`; independent peer review and merge remain OPEN.

- Optional Chromium per-tab Context prototype on a separate stacked source branch (NOT PR #325): Chrome 156 actual helper E2E opened 12 synthetic ChatGPT targets, two with `isolatedContext:true`, verified cookie A/B isolation using CDP `Storage.setCookies/getCookies`, no cookie in default browser context, 16-tab cap, one explicit context disposal and one external-target-close auto-reap with zero remaining contexts. Operation `4f26e452-cd00-45c5-93f8-b10f7e02ac88`, stdout SHA-256 `544371cc5fd3ed36c3de7db65ab9f3a6fdd29247bd1da6183da8c0de14e13165`, exit 0. Entire local Browser + Unicode + check:qualification + test:qualification + security audit suite completed with exit 0, operation `623072c8-b49f-449d-984a-95bbb9bd82c2`, stdout SHA-256 `866dd58e2b742cb3356a2f74f6f893890d09927369debaa381a2b2307c2d8284`. No authenticated accounts, persistent profile credentials, user desktop interaction or deployed change. Hosted CI/reviewer/CEF acceptance **not inherited** from PR #325.

## Production blockers
- Owner's real authenticated chats, identity/consent and durable project bindings not verified (0 real bindings).
- Multi-tab UI resource/CEF full rebuild and human visual acceptance absent; a 16-tab SOURCE cap is not evidence that the deployed CEF product performs at 16 tabs.
- Multi-tab foreground fallback currently *refused* until persistence/restore strategy is implemented. Read/write of chat conversation messages is NOT implemented by the observer.
- Independent review, CI, reversible canary and rollout remain open. **DRAFT / NO PROMOTE**.

References:
- https://chromedevtools.github.io/devtools-protocol/tot/Target/
- https://github.com/chromiumembedded/cef/blob/master/include/cef_display_handler.h
