# Evidence Contract

## Required source/release evidence

- Exact clean commit and peeled tag identity.
- `npm run check`, `npm test`, `npm run audit`, and `npm run test:gui-native` from exact release bytes or their documented exact-source authority.
- Release asset exact set, bytes, SHA-256, plugin ZIP contents, effective Windows/Linux installer pin, and GitHub asset digest reconciliation.

## Required runtime evidence per profile

- Device name, version, role, profile/isolation, config SHA-256, commit, slot, project directory, backend port, stable router port, PID/listener ownership.
- Router health/generation/backend identity; exact `tools/list`; workflow status/resume safety; Power/fullFilesystem/permanent-delete/GUI policy; shutdown/restart/logoff guards.
- Exact tunnel-client process count and health-listener ownership; one real call through the enrolled Secure MCP Tunnel.
- Zero active call/mutation/lock/terminal/GUI ambiguity/running-or-uncertain workflow before cutover.

## Required cleanup evidence

- Old process and router in-flight count reached zero.
- Retirement evidence ZIP exists and hashes verify.
- Legacy untracked/ignored files and Git refs are preserved outside the retired tree.
- No old release/app directory, old autostart/registry/profile reference, unknown listener, duplicate tunnel, or stale process remains.

Absence of an error is not PASS. Missing evidence is `UNPROVEN`.
