# Commander Capability Gap Intake — verified owner-profile workflow

Use for **observed** missing Commander tools, native GUI/Portal permissions, unsupported browser attachment, missing provider configuration and blocked automation. Keep the existing project Brain as the single authority; a gap is one traceable issue, not a permission grant or a separate project.

## 1. Check live capability first

Read `system_status`, inspect the actual `tools/list` on the intended connected owner profile and use a supported alternative if available. When the four **native** `capability_gap_report`, `capability_gap_list`, `capability_gap_get`, `capability_gap_triage` MCP tools are genuinely present, use those. Check existing keys before a new report. Do not claim these tools are installed merely because this Agent Extension is visible.

## 2. Portable fallback (actually installed on the fleet)

A self-contained, user-local pair of files is installed beside each other:

- Linux: `$HOME/.local/state/chatgpt-remote-commander/gap-client/portable-capability-gap-cli.mjs`
- Windows: `$env:LOCALAPPDATA\ChatGPTRemoteCommander\gap-client\portable-capability-gap-cli.mjs`

It uses `capability-gap-registry.mjs` in the same folder and imports `deliveryLocation` from the **exact active V1 dev23** `src/delivery-store.mjs`, with SHA256 pin `a4b1dff7e8293136215b12ade45062dc0f3a034f677f92e4a656679b513c5c47`. It does not need the V2 source repository on the target host.

Both `--config` and `--delivery-module` must be absolute verified paths belonging to **the current owner profile**. Obtain `--expected-profile` and `--expected-config-sha` from that profile's current `system_status.instance.profile` and `system_status.configSha256`. Do not derive the expected hash from an unverified candidate config alone. An incorrect profile, modified config or unpinned V1 delivery module is rejected.

Linux example (fill in actual verified values, do not use another owner's paths):

```bash
node "$HOME/.local/state/chatgpt-remote-commander/gap-client/portable-capability-gap-cli.mjs" list \
 --config "/VERIFIED/OWNER/CONFIG/config.json" \
 --delivery-module "/PINNED/ACTIVE/V1/src/delivery-store.mjs" \
 --expected-profile "VERIFIED_PROFILE" --expected-config-sha "VERIFIED_64_HEX_SHA256"
```

Windows PowerShell example:

```powershell
$cli = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\gap-client\portable-capability-gap-cli.mjs'
node $cli list --config 'C:\VERIFIED\OWNER\config.json' `
 --delivery-module 'C:\PINNED\V1\src\delivery-store.mjs' `
 --expected-profile 'VERIFIED_PROFILE' --expected-config-sha 'VERIFIED_64_HEX_SHA256'
```

To report: replace `list` with `report` and append `--input "/PRIVATE/issue.json"`. To read evidence: use `get --input "/PRIVATE/key.json"`; key JSON contains `{"capabilityKey":"browser.owner-session.native-attach"}`. For status, use `status`. The input file must be private (Linux mode 0600); never put tokens, passwords, cookies, sessions, personal data or raw chat transcripts in it. Stable functional keys deduplicate repeated evidence; distinct hosts maintain separate private ledgers.

## 3. Repair and consent

Each report contains real `projectKey`, category, native `consentGate`, title, `requiredBehavior`, `observedLimitation`, exact `errorCode`, `candidateSolution` and reproducible `acceptanceTest`. Use `TRIAGED` or `BLOCKED` until a real host-scoped test proves the required effect; these tracking states are not PASS.

A broad `FULL_POWER` label does not grant OS Administrator/Root, another owner's browser profile, OAuth tokens or native Portal approval. Prefer supported user-local routes; obtain only the minimum necessary native UAC/sudo/Portal/browser-owner approval when actually required. Continue independent authorized work.

This Agent Extension provides **discovery instructions only**. It neither executes Shell nor adds MCP methods, nor synchronizes data between owners or hosts. The portable fallback is a separately installed local CLI. Actual connected `tools/list`, owner permissions, installation/rollback and verified tool effects remain independent gates. Canonical technical documentation: `docs/CAPABILITY_GAP_INTAKE.md` in the verified V2 repository.
