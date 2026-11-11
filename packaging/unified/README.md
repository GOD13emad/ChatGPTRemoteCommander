# Unified Commander — source-pinned engineering pilot

Builds **one native installer per OS** from a single pinned Git commit: electron-builder NSIS (Windows, per-user) or DEB (Linux). Electron embeds its own Node.js, while `extraResources/core` carries the unchanged Commander source. A compact per-user preview copy is the only mutable runtime tree; no system-wide Node/.NET SDK is required to launch this package.

## Build (not a Stable promotion)

From the repository root: `node packaging/unified/prepare.mjs`. From this directory: `npm ci` and `npm run build:linux` on Linux, or `npm run build:win` on Windows. Build manifests pin the exact `git HEAD` and tree. Uncommitted changes to the embedded Core/tool paths cause failure. Artifacts go to `dist/unified/`.

## Single-install migration contract

The Linux DEB now retains the existing `chatgpt-remote-commander` package identity. An `apt-get -s install` probe on the reference Linux host showed one **upgrade**, zero **new** packages and zero removals; this is an install-simulation receipt, not native rollback or running-service acceptance.

The Windows NSIS package belongs to a different installer family from the historical Inno `RemoteCommander` application. Its `legacy-inno-guard.nsh` checks the old uninstall registration in user and machine registry hives and refuses to create a second install. The same guard is exercised on a disposable GitHub Windows runner with an isolated simulated legacy uninstall key. It **does not** uninstall the old application, migrate profiles, elevate privileges or claim a full cutover.

These QA packages must **not** be installed over operational Commander until authentic G1/J01 enrollment, signed artifacts, profile backup verification, browser integration, boot/login reactivation, app identity and v0.12 rollback are accepted. The fail-closed Windows guard must be replaced with a real transactional cutover only after those steps are implemented and tested.

## Validation and security scope

`node --test test/unified-packaging.test.mjs` on the repository root runs a real isolated Core health check and tests hash fail-closed behavior. The launcher permits only three fixed IPC calls from a sandboxed renderer. Its preview binds loopback, enables no privileged tools, does not connect to a ChatGPT account, and neither stops nor replaces the existing 0.11 runtime. Only one app window instance is permitted per account.

**No Stable claim:** Code signing, authenticated G1/J01 owner enrollment, MeshCentral managed-device adapter, Playwright browser adapter, automatic signed updates, reboot/login persistence, artifact provenance signing, migration/rollback and all-host singleton cutover are not yet implemented or accepted in this pilot. The existing active installations must remain in place until those gates succeed. `npm run build` alone is not an install acceptance or authorization grant.
