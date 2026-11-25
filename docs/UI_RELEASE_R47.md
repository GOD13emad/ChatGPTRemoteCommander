# R47 — Four-host coordinated UI release: blocked until native acceptance

## Baseline and scope
Commander Core installed v0.10.20 on four Windows/Linux hosts. Independently accepted cumulative Brain MAIN_R29, SHA256 442eb6b31f0ea350688f414f83254247893002870d35ce2987900adade65a2d7. Browser version 0.8.2 is a draft candidate, not the stable version on all hosts. Windows and Linux Control Center candidate code is likewise not deployed to every host.

Browser source: Usefull-Skills/chatgpt-cef-linux PR #81 at exact commit 624295c55610a331c1531792f1040acb02fe4797 (three hosted workflows SUCCESS). Linux Control Center: GOD13emad/ChatGPTRemoteCommander PR #165 at ffdf8be4ed04cc24a7de9740d57a41364be88c49 (four workflows SUCCESS). Windows Control Center: PR #166 at 885270377ca6b8fb5e7736993d2688139a54680d (Windows CI SUCCESS). Do not silently substitute moving branch heads.

## What this pull request does
It adds a read-only fail-closed candidate validator, a version-pinned evidence manifest, and negative tests on Windows/Linux. It NEVER downloads packages, merges PRs, replaces a release pointer, installs a browser, launches GUI automation, modifies credentials or obtains administrative privileges. A syntactically valid manifest with open gates prints status BLOCKED and exits zero so CI can test that the policy works. The explicit --require-ready switch always exits nonzero because this untrusted JSON cannot authorize production. Separate authenticated and signed release approval is mandatory.

## Critical safety gates (eight open)
1. Native GUI STOP/Mutex/no replay on affected hosts.
2. Real CEF Browser on Windows and Linux: RTL, HiDPI, tabs, login privacy, user-native acceptance.
3. Actual operational Control Center Profiles/Tasks/Monitoring on both operating systems.
4. Safe Smart Workflow main routing and durable one-writer journal with rollback.
5. Real Runner checkpoint, power-return recovery and authenticated ACK in the same chat.
6. MMZ Linux secure root:root 4755 sandbox and approved local sudo, after recovered host/root.
7. Game real GUI and Video V2/HQ owner visual and lip-sync acceptance.
8. Trusted code-signing, four-host canary install/uninstall and rollback.

Additional blockers: no verified signed immutable stable Browser 0.8.2 payload SHA, no accepted stable dashboard packages, Linux-secondary (MMZ) disconnected, and independent native UI visual approval missing. User and browser profiles must be preserved. Existing Core auto-updaters do not automatically deploy the separate native UI packages. A CI artifact alone is not a signed installer. Two available certificates on a Windows development host are development certificates, not proven public release trust.

## Test, progress and rollout dependency
Run: node --test test/ui-release-gate.test.mjs
Run: node tools/ui-release-gate.mjs --manifest docs/UI_RELEASE_CANDIDATE_R47.json
A valid BLOCKED result is correct. Whole-product percentage remains UNPROVEN, not inferred from CI activity. Current lifecycle: DISCOVERY, DEFINITION, BASELINE accepted; DEVELOPMENT and source VERIFICATION scoped PASS; Native VALIDATION and DELIVERY/RELEASE blocked; CLOSURE and FINAL not reached.

Before future automatic deployment: produce per-OS signed immutable SHA-pinned release package and attestation, approve host root and rollback, lock an owner-local updater lease, stage into a new versioned directory, verify signature, owner/session privacy, sandbox and native no-input smoke, atomically redirect only a verified owned pointer, retain previous version, and restore it automatically on any failure. No --no-sandbox, no auto reboot, no unguarded file deletion, no owner password in ChatGPT, no silent session reset. Do not promote failed R26-R28 Brain archives or older RC scripts; preserve their forensic provenance.

**Exact next action:** Obtain public trusted installer signing and owner-native cross-platform visual acceptance; restore MMZ connectivity; then create a separate transactional UI updater with install/uninstall/rollback tests and signed stable release approval. This PR is Draft until those gates pass.
