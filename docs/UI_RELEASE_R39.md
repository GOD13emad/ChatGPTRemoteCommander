# Unified native UI R39 — Cross-platform integration candidate

This Draft integration combines **Windows R34** SHA `885270377ca6b8fb5e7736993d2688139a54680d` and **Linux GTK R36** SHA `b5eddea6b05a1a7cfe0e6dd273ab5fac9b87c413` on the accepted Core v0.10.20 baseline. Both original PRs remain open and their source histories are preserved. Browser v0.8.2 candidate SHA `624295c55610a331c1531792f1040acb02fe4797` is in separate CEF PR #81; v0.8.1 immutable release remains authoritative for installed hosts.

This branch is **not a release**, installer, scheduled updater or authorization to override user sessions. It verifies both OS UI source trees and adds a read-only manifest/negative-test gate under `config/ui-release-r39.json` and `tools/check-ui-release-r39.mjs`.

The manifest explicitly requires exact-head CI, trusted Windows Authenticode signature, immutable release artifact SHA256, Linux sandbox, Native GUI and user acceptance, authenticated same-ChatGPT-conversation ACK, and canary installation/uninstall/rollback on all four hosts. **MMZ is disconnected**, Linux Native GTK rendering and Browser Native GUI not yet owner-accepted, and unsigned/missing installers cannot be promoted. A green CI test never overrides missing physical evidence. The checker does not cryptographically validate signatures and does not deploy anything.

Status: `PARTIAL_NOT_FINAL`; eight open critical product gates, project % UNPROVEN. Latest accepted cumulative Brain MAIN_R29. If all prerequisites eventually pass, a *separate audited, transactional updater* must still be built and tested. Never enable unattended installs or reboot before acceptance.

