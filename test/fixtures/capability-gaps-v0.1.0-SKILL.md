# Commander Capability Gap Intake

Use for an **observed** missing Commander tool, native permission, browser connector, unsupported driver or blocked automation in the current project. Keep the established Project Brain as the only project authority.

First inspect `system_status` and the actual MCP catalog. If installed, use `capability_gap_list` / `capability_gap_get` before reporting. Record distinct actual evidence with `capability_gap_report` and update proposals through `capability_gap_triage`. Duplicate observations must be NO-OP; never treat tracked state as PASS.

When the four tools are not yet installed, and an authorized owner-local shell is genuinely available, use the V2 source fallback **only with the verified active owner profile config**:

```bash
cd "$HOME/source/repos/RemoteCommanderV2"
node tools/capability-gap-cli.mjs list --config "/EXACT/OWNER/CONFIG/config.json"
node tools/capability-gap-cli.mjs report --config "/EXACT/OWNER/CONFIG/config.json" --input "/PRIVATE/ISSUE.json"
node tools/capability-gap-cli.mjs get --config "/EXACT/OWNER/CONFIG/config.json" --input "/PRIVATE/KEY.json"
```

On MMZ, `emad-mmz` specifically uses `/home/mmz/.local/state/chatgpt-remote-commander/profiles/emad-mmz/config.json`; never assume that path represents any other user/profile. Verify every other profile independently. Put no credentials, cookies, private keys, session material, raw chat logs, or unrelated personal data into issue input or reports. Use private temporary files.

A report identifies a stable functional `capabilityKey`, `projectKey`, category, exact native `consentGate`, required behavior, observed error, candidate repair and reproducible acceptance test. Prefer safe user-local alternatives; native UAC/sudo, KDE Portal, OAuth or browser-owner authorization remains mandatory where required. `FULL_POWER` is not unrestricted Administrator/Root. Continue independent work.

The profile ledger is durable but **not fleet-synchronized**. This extension is only discoverable instructions; it does **not** install four MCP methods, execute any shell command itself, grant OS privileges, modify browser sessions, or certify deployment. Actual connected `tools/list` and scoped live tests are required before declaring release PASS. See canonical `docs/CAPABILITY_GAP_INTAKE.md` in the V2 source.
