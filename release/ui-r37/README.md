# R37 — Cross-platform UI release and automatic-update gate

**Status:** `BLOCKED`; **automatic installation / Production promotion:** `DISABLED`.

This is a read-only, host-agnostic release-policy validator for a coordinated Native Browser and Control Center rollout. It is **not** an installer, task scheduler, downloaded update, or authorization to modify installed Core. The owner wants automatic updates on four machines; the current evidence still cannot safely satisfy that.

**Baseline:** Commander Core v0.10.20 on Saeid Windows, Emad Windows, Emad Linux, and MMZ Linux. Immutable accepted cumulative Project Brain MAIN_R29 SHA256 `442eb6b31f0ea350688f414f83254247893002870d35ce2987900adade65a2d7`. No Router or user browser profile changes.

## Exact candidate sources

- Browser CEF Native Windows/Linux: `Usefull-Skills/chatgpt-cef-linux`, candidate v0.8.2, PR #81, pinned head `ad7d923f69c7e698aaf83b0b5547a6c1752c3900`. v0.8.1 existing stable release MUST NOT be overwritten.
- Windows Control Center WinForms: `GOD13emad/ChatGPTRemoteCommander`, PR #166, commit `885270377ca6b8fb5e7736993d2688139a54680d`; hosted Windows and overall source CI PASS, physical Native visual acceptance OPEN.
- Linux Control Center GTK4/Adwaita: same Core repo, PR #165, last pinned candidate `b5eddea6b05a1a7cfe0e6dd273ab5fac9b87c413`. Later source work may exist; every new head must be re-pinned before release. Synthetic GTK X11 produced a real screenshot in R35, but repeated R36 navigation/visual acceptance probes failed and are preserved as FAIL; 19/19 local unit tests PASS, not Native owner acceptance.

## Host and release gates

Actual manifest `ui-channel-r37.json` is BLOCKED with 31 unresolved checks. In particular, MMZ Commander tunnel is offline and its previous CEF package root vanished with unverified cause. Emad Linux needs owner-local interactive `sudo` to set root:root 4755 on native Linux sandbox. No publicly trusted Windows code-signing certificate or known verified Authenticode installer chain was found; development self-signed certs are not release-quality signing.

The validator rejects missing/reassigned host IDs, untrusted download origins, packages with unknown SHA256, absent signature evidence, missing native UI screenshots/owner acceptance, stale/unapproved rollback receipts, lack of four-host availability and disallowed Core/profile mutations. All successful **synthetic** evidence produces only `STAGE_ELIGIBLE_NOT_INSTALLED`: never claims a product is installed, released or safe to run.

## Usage (READ-ONLY)

`node ui-release-guard.cjs --status ui-channel-r37.json` returns structured BLOCKED status and reasons.

`node ui-release-guard.cjs --enforce ui-channel-r37.json` exits 78 until all required gates pass. It does NOT download, install, restart, elevate, delete, merge, publish or change any user files. On eligible input it only reports eligibility for independently authenticated staging.

`node --test ui-release-guard.test.cjs` runs synthetic positive and negative scenarios, including falsified host or version, invalid package SHA/origin and false release claims. Windows Emad result 8/8 PASS, source-test log SHA `b69bc5893f856cb5a3443170c013f4d5f170fca40fddf8ea31a53d07e203a372`.

## FINAL acceptance prerequisites

Provide immutable, version-specific Windows/Linux Browser and Control Center artifacts with official SHA manifest, trusted signature for Windows, Linux native sandbox root:root 4755 with owner-approved local password only, visual RTL/HiDPI/login/session preservation on owner machines, fail-closed GUI STOP/Mutex, verified Control Center Profiles/Tasks read/write through accepted authenticated IPC, Runner crash/power-return and same-ChatGPT-conversation ACK, four-host canary+uninstall+rollback receipts. Promote only **after** all product Release gates accepted and independently reverify the exact candidate hash on each host. The active auto updater for Core **must not** be assumed to update these separate UI products.

**SUPERSEDED—DO NOT RUN:** previous rejected R26/R27/R28 Brain packers/verifiers, old MMZ missing Browser launcher, unverified Windows installer, stale GUI frames. Keep evidence.
