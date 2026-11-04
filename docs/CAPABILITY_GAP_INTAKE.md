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
