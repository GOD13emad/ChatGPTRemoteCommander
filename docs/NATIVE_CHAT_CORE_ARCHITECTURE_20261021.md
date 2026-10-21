# Corrected architecture: Chat monitoring is part of Remote Commander Browser Core

**Owner decision, 2026-10-21:** ChatGPT tab/conversation observation and management MUST be built into **Remote Commander Browser core** and governed by Commander Core. It must NOT require an extension installed in Brave/Chrome, an external Native Messaging Host or a companion extension bridge.

## Implementation paths
- Chromium/CDP Commander browser: process-local Target lifecycle observer in `src/browser-native-chat-observer.mjs`, wired into `tools/browser-control.mjs`; read-only lease-scoped `browser_chat_tabs` via `src/browser-tools.mjs` and `src/browser-contract.mjs`. Strict origin/URL parsing, ephemeral HMAC references, bounded state, no DOM, cookies or raw conversation IDs exposed.
- CEF Remote Commander Browser: in-process native observer `src/native_chat_observer.h`, wired to CEF `OnAddressChange`, tab creation/activation/closure and the existing companion panel. No browser add-on; existing control-center/CEF panel remains part of browser product.
- Core authorizes durable project bindings and any future action. Browser observations are NOT account authentication or permission to send ChatGPT messages. Maintain independent ownership and user-approved action boundaries.

## Optional ephemeral per-tab Chrome BrowserContext (source-only candidate)
- The optional `browser_chat_tab_open.isolatedContext=true` creates a separate `Target.createBrowserContext({disposeOnDetach:true})`, and passes its opaque `browserContextId` directly to `Target.createTarget`. Default `false` preserves the prior single-owned-profile behavior. Browser Core never returns browser-context IDs, cookies, or account credentials to callers.
- Explicit Commander-owned tab close disposes the associated context; externally closed tabs trigger bounded automatic disposal. Failed disposal is reconciled against `Target.getBrowserContexts`; a context already absent after external disposal is considered clean. Truly unresolved/failed disposal fails closed for further managed-tab mutations until owned session reset. Destruction events and read-only target reconciliation serialize in-flight disposal to avoid double-delete races. Maximum simultaneously managed tabs remains 16 and private contexts are bounded by 16.
- This is ephemeral **site storage separation**, not separate OS users, VMs, human/account authentication or persistence across Commander session end. Opening multiple real ChatGPT accounts, long-lived profile restore, CEF parity, foreground handoff and browser-crash recovery remain separate acceptance gates.

- Linux Commander-owned Chromium cleanup also recognizes Chrome's single flattened `/proc/<pid>/cmdline` process-title variant; Linux [proc_pid_cmdline(5)](https://man7.org/linux/man-pages/man5/proc_pid_cmdline.5.html) explicitly warns that processes can rewrite the argv memory exposed there. The fallback requires a known browser `/proc/<pid>/exe` identity plus an exact, **case-sensitive** `--user-data-dir=<owned-profile>` token; prefix-sibling and case-different profile paths cannot be matched. True argv matching remains unchanged. This is bounded QA host process ownership, not general process supervision or permission to touch personal browsers.

- Ambiguous browser session-end outcomes are **not** a license to start another lease. A failed `end` acknowledgment, including `closed=false`, retains the exact same lease and marker, blocks all mutations until the owned helper confirms a subsequent idempotent `end`, and only then allows a new session. Session TTL and owner-scoped orphan reaping remain separate contingency paths. This does not grant access to browser profiles outside Commander ownership.
- Multi-tab Context separation is **not** per-tab automation: generic `browser_snapshot`/`browser_navigate`/`browser_fill`/`browser_click` still target the main controller page, not `tabRef`. A separately reviewed per-tab API is required for actual managed conversations; no real-account multi-chat acceptance is claimed.

## Rejected architecture / migration
- Legacy `desktop/linux-control-center/chat-companion/` and private Emad `RC_MULTICHAT_EMAD_PILOT_R1/extension` are **QA prototypes only**, **deprecated/no-promote**, not prerequisites or architecture targets.
- Do not blindly delete owner state/installed Native Host or modify active browser sessions. Revoke legacy host registrations only after verifying exact path/ID, whether an active process depends on it, and independent rollback.
- Avoid touching MMZ's or Emad's unrelated worktrees. New independent git worktrees hold source prototypes for review. Neither is production installed.
- CEF currently caps tabs at **8** in `AppController::NewTab`; multi-chat **10+** acceptance remains OPEN until product tabs limits and safe resource model are qualified.

## Gate status
- Internal CDP source tests: 19 PASS, 0 FAIL on Emad and MMZ isolated source worktrees; no real authenticated account.
- CEF independent C++ observer test: PASS on Emad-PC with static MinGW executable. Full CEF build and UI not yet qualified.
- Real chat binding, authenticated operator identity, full CEF integration build and canary/release: OPEN.
- PR #316 remains DRAFT/NoPromote and must be reconciled with this architecture before review/merge.

**No promotion, no Core deployment, no GUI incident unlock, no delivery replay.**
