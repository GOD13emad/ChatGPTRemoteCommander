# Versioned experimental development

This directory contains Saeid development snapshots that are intentionally separated from production runtime authority.

The repository's current production core is v0.10.8. Individual experimental snapshots retain their own pinned qualification baselines. Experimental files are versioned so the work is not lost and can be audited or continued by another account, but they are not automatically installed or promoted.

- `finite-companion-v1.0.0`: source-review snapshot of the separately accepted finite companion on core 0.10.6, with self-contained public test fixtures and redacted non-executable deployment review text. **Not a public installer, general project agent, or accepted 0.10.8 integration.** Historical private acceptance and new public-copy tests are separate boundaries.

- `companion-v01`: exact PR #99 companion source snapshot at commit `715f99ae229e9e44ccc2e2b4ad6e6c3531b442da`. **Blocked / not production-wired** because hosted Windows private-file qualification recorded `COMPANION_ACL_INVALID`; historical tests also expected runtime 0.10.4 after core moved to 0.10.5.
- `project-operations-v03`: finite policy kernel, execution-scope guard, durable monitor, feature service and focused tests. No production MCP registration or installer wiring.
- `paused-domain-policy`: pure game/video admission policy. Game/video execution remains user-paused.
- `windows-private-files-q5/overlay`: incomplete Windows private-file overlay. **STOP — DO NOT RUN** package/native/compile/parity/focused/full drafts until native owner/ACL/lifecycle gates are independently qualified.
- `owned-browser-r3`: accepted Saeid headless fixture/graceful-close component snapshot. It is **not production-wired**; its browser-control file is fixture-only.

Production release acceptance must come from the corresponding top-level version's qualification, CI/canary and release gates. Experimental PASS evidence never upgrades the whole product to FINAL.
