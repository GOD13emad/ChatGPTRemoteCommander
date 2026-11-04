# Commander Capability Gap Intake

This is a missing-feature / permission-gap workflow, not a second Brain, task runner, admin broker or release authority. The implementation lives in src/capability-gap-registry.mjs; the connected V2 MCP server exposes four tools only after the matching code is actually installed and advertised to a ChatGPT client. The fallback source CLI is tools/capability-gap-cli.mjs.

The sole durable gap ledger is the owner-profile-private SQLite file capability-gaps.sqlite beside the existing DeliveryStore, derived from the exact active REMOTE_COMMANDER_CONFIG and its scope. Different chats and projects using the same owner profile share one registry; an unrelated owner profile does not.

The V2 MCP server additionally **auto-captures a short allowlist of observed native failure codes** (for example PORTAL_PERMISSION_NOT_GRANTED, PROFILE_ATTACH_NOT_READY, BLOCKED_PROVIDER_CONFIG_MISSING and WORKSPACE_TARGET_GUI_UNAVAILABLE). It stores only the fixed code, calling tool, owner reporting host and fixed repair/test template; it never persists raw tool arguments, credentials or arbitrary error messages. Unknown errors and missing features discovered outside a tool call still need an explicit capability_gap_report. Auto-capture is diagnostics only and cannot change a tool result, open UAC or grant consent.

## Steps for every conversation or project

1. Inspect the real available tools and try an authorized, supported user-local / portable / native alternative. A missing optional tool must not block unrelated work.
2. If still blocked, call capability_gap_report once with a stable functional capabilityKey (for example browser.profile.native-attach), projectKey, category, consentGate, short title, requiredBehavior, observedLimitation, exact errorCode, optional candidateSolution, and an executable acceptanceTest. Never put cookies, passwords, tokens, private keys, raw transcripts or unrelated personal data into it.
3. Before reporting overlapping evidence, consult capability_gap_list and capability_gap_get. Repeated identical observations are NO-OP. Distinct project or host sightings are added under the same functional key. Do not combine different authorization scopes merely because text looks similar.
4. Use capability_gap_triage with expectedRevision to record an action and state. OPEN, TRIAGED, IMPLEMENTING, BLOCKED and READY_FOR_QA are workflow states only. They cannot be mistaken for VERIFIED, native consent, Administrator/Root authority, sign-off or production deployment.
5. Repair the root cause through a supported implementation, run the real host-scoped acceptance test, update the existing project Brain and its Notion evidence, and continue independent work. Do not silently repeat operations with unknown outcomes.

## Native permission model

Classify each request as NONE, NATIVE_USER, NATIVE_ADMIN, BROWSER_OWNER, OAUTH_OWNER, PORTAL_OWNER, or EXTERNAL_PROVIDER. Prefer existing owner-session routes. If privileged access is indispensable, use native UAC/sudo or a narrowly scoped and auditable existing broker. A one-time approval survives until reboot only when the actual OS and broker policy explicitly supports that lifetime. Recording a gap does not grant privileges, exfiltrate saved browser credentials, circumvent MFA or create cross-account consent.

## Interfaces

MCP: capability_gap_report, capability_gap_list, capability_gap_get, capability_gap_triage; mutations require stable requestId and use the existing Commander mutation idempotency ledger. system_status.capabilityGaps reports profile-local counts.

CLI fallback from V2 source tree (owner-authorized Commander shell, no installation or elevation):
  node tools/capability-gap-cli.mjs status --config /path/to/owner-profile/config.json
  node tools/capability-gap-cli.mjs list --config /path/to/owner-profile/config.json
  node tools/capability-gap-cli.mjs report --config /path/to/owner-profile/config.json --input /path/to/private/issue.json
  node tools/capability-gap-cli.mjs get --config /path/to/owner-profile/config.json --input /path/to/private/key.json

issue.json uses the same bounded report fields as MCP. key.json contains a single capabilityKey. Keep temporary input files private and exclude secrets.

## Release boundary

This module is implemented and tested in the V2 candidate source. The production V1 tools in all profiles have NOT yet been upgraded or inspected after release; therefore cross-chat discovery on another installed host is not automatically proven. The ledger is shared per profile, not automatically synchronized across owner profiles or devices. Fleet aggregation is a separate tracked acceptance gap. Required deployment QA: actual connected tools/list on every intended owner profile, restart persistence, multi-project dedup, no secret storage, correct separation between owners, no privilege escalation side effect and a verified repaired incident.


## V1 0.11.0-dev.23 compatibility QA (2026-11-05)

The active MMZ owner profile currently uses an immutable `0.11.0-dev.23` runtime, while a separate V1 developer source tree contains uncommitted user/other-writer edits. Do not edit that tree or replace the running service as a side effect of this integration. The live `emad-mmz` profile can already record a capability gap through `tools/capability-gap-cli.mjs --config <its active config>`; its missing-MCP-catalog issue was actually registered, deduplicated, and moved to `TRIAGED` (not verified). Do not reuse another owner's profile scope.

A small source-only QA stage, `tools/v1-dev23-capgap-stage.mjs`, pins the exact immutable live dev23 release `src/server-v0.3.mjs` SHA256 `c1c13efa74c75d00ca3b6e778a7af6b63f4053ac346caec12308d76117565933` together with the public package and two shared state modules. It copies only the 1.1-MiB `src` subtree plus public `package.json` into the user-private existing QA area, applies the four MCP tools with status/telemetry to that isolated source, and labels the QA server `0.11.0-dev.23-capgap-qa`. It refuses unexpected sources, symlink ancestry, existing QA target or altered copied baseline. **It never modifies V1 installed routes, user configs, browser profiles or running processes.**

On MMZ, the one-time stage output is `~/.local/state/CommanderV2/QA/v1-dev23-capgap-bridge`. Subsequent reruns intentionally return `V1_DEV23_GAP_BRIDGE_QA_ALREADY_EXISTS`; they must not overwrite accepted QA source. The opt-in test `test/v1-dev23-capgap-bridge.test.mjs` starts genuine local MCP servers for immutable dev23 and QA source on disposable random ports, compares `tools/list` (60 original tools plus exactly four new), reports and replays a gap with durable requestId, restarts QA server, checks SQLite persistence and denies visibility to a different profile. It makes no physical GUI or Worker effect. This test runs under `npm run test:capability-gaps` and skips when the pinned local QA stage is not present on another CI host.

**Cross-platform six-host native QA (2026-11-05):** The exact-source stager now permits only known pinned dev23 server SHA256 variants: Linux MMZ `c1c13efa74c75d00ca3b6e778a7af6b63f4053ac346caec12308d76117565933`, Linux Aliemad/Aliakbar and Windows three hosts `fafd2151117456b7146fe3dafbe57f5f0507e2ebf8778964ab43562c569387e6` (with the same pinned package, DeliveryStore and idempotency modules). On **all six** separate QA MCP processes, `tools/v1-dev23-capgap-native-qa.mjs` found **60 baseline tools and exactly four new gap tools**, requestId replay and restart persistence, no cross-profile read, and original V1 source unchanged. Aliakbar's **active** dev23 process cwd is the pinned dev23 rollout path; its other dev18 development checkout was not used or edited. No live active service/route or credential was restarted/changed. Source CI includes syntax checks of both stage and QA runner. These are PASS only for disposable host-local QA, not signed installer, authenticated ChatGPT client discovery, GUI consent or production release.

Remaining **installation** gate: qualify a complete, signed and rollbackable V1 updater candidate with one writer for V1; preserve existing owner processes, credentials and route; validate real MCP catalog from the actual authenticated ChatGPT client after promotion and native consent separately. The QA test does not satisfy that acceptance condition. A separate provider authorization, root/UAC, owner browser login, and worker-effects gate stays OPEN.


## No-restart discovery in existing V1 dev23 (MMZ, 2026-11-05)

The existing active V1 0.11.0-dev.23 already loads user-local declarative Agent Extensions from `~/.agents/extensions` at request time. To make a **usable path to the profile-local CLI** discoverable in connected chats without changing/restarting the installed V1 runtime or its Router, this project now provides one canonical source manifest and guide at `extensions/commander-capability-gaps/{agent.json,SKILL.md}`, plus the pinned owner-only installer `tools/install-capability-gap-extension.mjs`. Installer verifies exact source SHA256, refuses an unexpected preexisting extension/symlink path, and only creates one private declarative extension; it does not modify V1 source, connected identities, credentials, GUI sessions, service processes or native OS privileges. It is idempotent.

The MMZ user-local extension was installed and read back through the **actual connected** `agent_extension_get`, `agent_extension_route` and `agent_extension_skill` methods from active V1 `emad-mmz` (version 0.11.0-dev.23). Owner-local read-only HTTP probes also discovered the extension on MMZ `saeid-mmz` (47922) and `default` (48831); the separate `owner-gui-v1` (48837) endpoint returned HTTP 403, which is **not** evidence that the extension is absent. All these profiles still have isolated DeliveryStore scopes, and this shared user-local extension is **metadata/instructions only**: it does not add `capability_gap_*` MCP tools or synchronize gap ledger state between profiles.

After native V1 MCP installation is approved through the independent updater gate, the four actual tools should be verified via the active authenticated client's `tools/list`; the extension can remain a discovery fallback. The verified standalone installed QA bridge remains at `~/.local/state/CommanderV2/QA/v1-dev23-capgap-bridge`, not production. Do not update a dirty V1 Git tree or silently switch its systemd user service in order to install this metadata.


## Owner-private portable gap client on the six connected hosts (2026-11-05)

The no-restart Agent Extension was updated from v0.1.0 to **v0.2.0** with explicit Linux and Windows examples that use an installed portable CLI, so other chats do not depend on the V2 Git checkout on MMZ. The pinned extension source has manifest SHA256 `d94c646466037e29ddf3eafc2ecb683c882e529ec55d8012b21b092fe80cd1e4` and SKILL SHA256 `247bac3be54f1835682e213ea82dd1f80da4669f901150e229bdc7ae1d4ab51f`. MMZ upgraded via `tools/install-capability-gap-extension.mjs --upgrade` with an owner-private v0.1.0 rollback copy and verified exact hash. Five other connected hosts received the same two files through Commander guarded SHA preconditions and backed-up writes; **all six actual V1 `agent_extension_get/route/skill` checks passed** at v0.2.0 without runtime Restart.

An independent two-file portable local package is deployed to all six hosts, with no new privileged service:
- Linux: `~/.local/state/chatgpt-remote-commander/gap-client/{portable-capability-gap-cli.mjs,capability-gap-registry.mjs}`.
- Windows: `%LOCALAPPDATA%\ChatGPTRemoteCommander\gap-client\{portable-capability-gap-cli.mjs,capability-gap-registry.mjs}`.
- SHA256: CLI `8b047e5f7505b555346da562d1d7312c533f6bd43c0ce3062566bc4261e69bfe`; registry `23f0f7a18133b506fe7273920d91841b8fcbae7317e4b19e0684240b48a33683`. Both are unprivileged owner-local text sources. The CLI imports the **installed live V1** `src/delivery-store.mjs` after exact SHA256 verification of `a4b1dff7e8293136215b12ade45062dc0f3a034f677f92e4a656679b513c5c47` and requires explicit `--config`, `--delivery-module`, `--expected-profile` and `--expected-config-sha` bound to actual `system_status`. It refuses a mismatched user or stale/altered config, a symlinked source, a changed V1 delivery module and nonprivate Unix input files. Report, list, get, status and triage use the same per-profile private SQLite ledger as native V2 candidate tools. `test/portable-capability-gap-cli.test.mjs` tests real SQLite persistence, duplicate NO-OP, invalid owner and config SHA rejection and Unix file privacy.

**Actual fleet evidence:** on MMZ, Aliemad Linux, Aliakbar Linux, Emad PC Windows, Emad Server and Amirreza Server, the live V1 MCP `tools/list` returned respectively **129, 121, 129, 116, 116, 116** tools, **zero** native `capability_gap_*` methods, with `agent_extension_get` present. A real owner-config-bound CLI `status` succeeded on each host; an identical sanitized `mcp.capability-gap.runtime-catalog` issue was recorded in each owner's private ledger (new on five hosts, merged with the existing MMZ issue), and replaying the same observation from a new CLI process returned `changed=false` on all six. Disposable private QA input files were removed after the verified writes, and the SQLite records remained. The five new issues were each moved from OPEN to **TRIAGED** (revision 2) with an explicit expectedRevision guard; MMZ's existing issue remained TRIAGED. Every triage response explicitly returned `acceptanceVerified=false`, and private temporary triage input files were removed. Registry data is **not** automatically synchronized between profiles/hosts; only the code and functional issue key are consistent.

**Acceptance boundary:** complete fleet extension-discovery and portable CLI access PASS; **native four-method MCP deployment, fleet-central issue aggregation, signed updater, owner approval, GUI and Worker effects remain OPEN**. Preserve active dev23 services, user sessions, other-writer V1 checkouts, and each account's private authorization scope.
