# Versioned experimental development

This directory contains Saeid development snapshots that are intentionally separated from production runtime authority.

The release baseline for this tree is v0.10.6 on top of official v0.10.5. Experimental files are versioned so the work is not lost and can be audited or continued by another account, but they are not automatically installed or promoted.

- `companion-v01`: exact PR #99 companion source snapshot at commit `715f99ae229e9e44ccc2e2b4ad6e6c3531b442da`. **Blocked / not production-wired** because hosted Windows private-file qualification recorded `COMPANION_ACL_INVALID`; historical tests also expected runtime 0.10.4 after core moved to 0.10.5.
- `project-operations-v03`: finite policy kernel, execution-scope guard, durable monitor, feature service and focused tests. No production MCP registration or installer wiring.
- `paused-domain-policy`: pure game/video admission policy. Game/video execution remains user-paused.
- `windows-private-files-q5/overlay`: incomplete Windows private-file overlay. **STOP — DO NOT RUN** package/native/compile/parity/focused/full drafts until native owner/ACL/lifecycle gates are independently qualified.
- `owned-browser-r3`: accepted Saeid headless fixture/graceful-close component snapshot. It is **not production-wired**; its browser-control file is fixture-only.

Production release acceptance must come from the top-level v0.10.6 qualification, CI/canary and release gates. Experimental PASS evidence never upgrades the whole product to FINAL.
