# Commander One — Windows & Linux one-file installer preview

## H3f QA10 — current unsigned cross-OS Installer QA (2026-11-05)

**Current artifact gate `V1-08_H3F_QA10_CROSS_OS_QA=PASS_SCOPED`; NOT an externally published Stable release.** QA details, exact hashes, operational limitations, tested upgrade/rollback and owner-only recovery instructions are in `outputs/one-install/h3f-qa10-unicode-upgrade-qa/QA_REPORT.md` (SHA256 `325415b2c549310fce7b8f5cc6aff2d0151b26d6f68ab2668e4222e9606ace55` on both native hosts).

| Host | Local path (relative to its own repository) | Size | SHA256 |
| --- | --- | ---: | --- |
| Windows x64, Emad-PC-Ultimate | `outputs/one-install/h3f-qa10-unicode-upgrade-qa/CommanderOne-Setup-Windows-x64-H3f-QA10-Unsigned-QA.exe` | 151219016 | `a0aaead984d6d1df22b64fca7f26948b08614501c1fb9774e371559cf21101f6` |
| Linux x64, aliemad-Labtop | `outputs/one-install/h3f-qa10-unicode-upgrade-qa/CommanderOne-Setup-Linux-x64-H3f-QA10-Unsigned-QA.run` | 52714934 | `f7685be5355977f0401773a0c9e7faebd512378ff2f7b9adf567b63532a0309f` |

The complete canonical Builder `tools/one-install/build.py` SHA256 `4771a85f1372aa4000d04a1b5ecfa003b86d98348224edca3af228fbaba23c52` built both exact one-file packages with V1-10 QA10 WinForms/GTK and Installer Core SHA256 `856f7e3a8531ee259bfc1a1e7b134e015f38e1d61befe88dda296f902457138b`. Windows Builder `term-1287` exit0, Standard64/Full128, including actual Unicode install **and upgraded migration + rollback** in paths with percent, dollar, spaces and non-Latin characters. New `smoke-unicode-upgrade.py` SHA256 `f10bf0a3fabc1f75b8190a22d819bdbca5c58157dd52bc3c9cac09e50d0fa693` is a required Windows Builder gate when an older native UI installer is supplied, with exact rollback/Core/UI/owner-profile verification. Autostart activation in unsafe percent paths **continues to fail closed**; safe inspection and upgrade are allowed only when owned autostart registry/script state is absent. Linux Builder `term-131` exit0, Standard64/Full133, actual required user-systemd 2-service/SIGKILL recovery PASS. Linux core-only H3e->H3f Unicode Upgrade/Rollback PASS in both modes and real installed QA10 GTK suite 16/16 + Xvfb Button.Click and close-race PASS.

V1-00 R61 owner waived code signing **only**, so these are transparently unsigned binaries with hashes and no SmartScreen bypass. Final postqualification negative tests proved that a byte change **inside** the embedded archive is rejected on both platforms; however Windows SEA `--verify-package` does not attest to changes in unrelated executable bytes. **Before launch, externally verify the SHA-256 of the entire unsigned native file against the trusted release manifest**, not only `--verify-package`. Full observations and clean scratch receipts are in the updated H3f QA report. Blockers remain `G1_INSTALLED_SECURITY=BLOCKED` (real provider-managed OAuth2.1 owner/chat/native revocable grants), V1-00 private fleet Canary/cutover, V1-10 final UI owner approval and actual OS Boot/Login. Original installed dev23 Router processes were not modified, `PUBLIC_STABLE_RELEASE=NOT_PUBLISHED`.

---

## H3d QA6 — historical unsigned full-Builder acceptance (2026-11-05)

**Status `V1-08_H3D_CROSS_OS_INSTALLER_QA=PASS_SCOPED`. This is an unsigned Release Candidate, NOT the public Stable release.** Full detail, scoped tests, source/UI hashes and owner-only rollback instructions: `outputs/one-install/h3d-qa6-unicode-qa/QA_REPORT.md` (matching report SHA256 on both hosts: `c1c1ebed8700a086ba4de0bb9432ed864e821a8494308bf08f17dc9ae4f1bd54`).

| Host | Native Installer under host-local project root | Bytes | SHA256 |
| --- | --- | ---: | --- |
| Emad-PC-Ultimate (Windows x64) | `outputs/one-install/h3d-qa6-unicode-qa/CommanderOne-Setup-Windows-x64-H3d-QA6-Unicode-QA.exe` | 151221576 | `5fa942896c34a10fad0b39e4268139d6b4f8df79852a25dfed1948fe92e512dd` |
| aliemad-Labtop (Linux x64) | `outputs/one-install/h3d-qa6-unicode-qa/CommanderOne-Setup-Linux-x64-H3d-QA6-Unicode-QA.run` | 52714825 | `7f6b1c633a86b79fd402fb05b5ba087aa9ead2a79cc65dcc720863539fb3067e` |

Exact Core SHA256 `363fae46cf0927fc8b6bba97fba46bcde933e8f784e91a7dd861519e9df3d75f`, current Builder SHA256 `6d5d598dcab9c71fb2301e2ba4383fd1b8abc91cea5faab6771a059e171aab3e`. Windows Builder `term-1258` PASS Standard64/Full128 including the **new actual Unicode path installation gate** for both modes; Windows independent pinned rebuild produced exactly the same entire binary SHA. Linux Builder `term-126` PASS Standard64/Full133 including required user-systemd two-profile Headless, SIGKILL recovery and no lingering QA service. R47/R48 sources and QA6 V1-10 UI digests remained accepted and unchanged, and previous H3c files were not overwritten.

**Owner policy update:** For this stable distribution attempt, V1-00 R61 confirms `V1_CODE_SIGNING_REQUIRED_FOR_THIS_STABLE_RELEASE=false` and `V1_UNSIGNED_PUBLIC_DISTRIBUTION_OWNER_AUTHORIZED=true`. Actual signature remains `NotSigned`; do not imply a trusted publisher or bypass SmartScreen. This signing waiver does **not** waive `G1_INSTALLED_SECURITY=BLOCKED`, V1-01 OAuth2.1 real native owner-bound authorization, V1-00 private canary/fleet acceptance, V1-10 final frontend owner signoff or actual OS Boot/Login. Consequently `V1_STANDALONE_FINAL=OPEN` and `PUBLIC_STABLE_RELEASE=NOT_PUBLISHED`. This section updates the QA candidate only; original operational Routers/installations were not changed.

---

## H3c + V1-10 QA6 native UI — integrated one-file QA (2026-11-05)

**Latest V1-08 scoped integration candidate; NOT production release.** The V1-10 frontend handoff `tools/one-install/V1-10-FRONTEND-HANDOFF.md` identifies QA6 as `SOURCE_INTEGRATED_AND_NATIVE_BUILD_QA_PASS_SCOPED`, with no final user acceptance. V1-08 used its **already compiled and independently tested** WinForms QA6 executable SHA256 `f6094292003e4cfbb2a895bd7c35a88ada1a943deb547e7e28f11b3c209247da` and Linux QA6 GTK sources `managed_controls.py` SHA256 `8e2a52b29b3e9116e89c761637234819334e4c5c7799142c2faecb730efc4a88` / `dashboard_ui.py` SHA256 `85c37b72b03f39c5ed53e935fd76968588474f91714e2c145e3937d7e58ee32c` without writing frontend-owned source.

| Native platform / owner-local host | New QA6 Installer under this host's repository | Size | SHA256 |
| --- | --- | ---: | --- |
| Windows x64 / Emad-PC-Ultimate | `outputs/one-install/h3c-qa6-ui-qa/CommanderOne-Setup-Windows-x64-H3c-QA6-UI-QA.exe` | 151221576 | `0feb1a17fa24414a86cd312eaf303a753a1028534538fa4f53b4da004344a548` |
| Linux x64 / aliemad-Labtop | `outputs/one-install/h3c-qa6-ui-qa/CommanderOne-Setup-Linux-x64-H3c-QA6-UI-QA.run` | 52714819 | `21b5c531aaa06a479adfe568adfcd64de271e5dfe4c9ec44888e8a9cd7d60823` |

**Native full Builder acceptance:** both released only to an owner-local QA output folder after full `build.py` tests passed. Windows Standard64 / Full128; Linux Standard64 / Full133, exact 60+4 and 124/129+4 baseline tool schema parity. In both OS, installation, independent managed profiles, upgrade/rollback, recoverable uninstall/restore, Autostart, native UI handoff, dead-control reconciliation and privileged legacy HTTP fail-closed passed. Linux `--headless-systemd-qa required` passed on the **new QA6 file** with two live temporary user services, independent ports, unsafe-operation denial and real systemd SIGKILL restart; `bootOrLoginTested=false`. Linux installed QA6 GTK source passed the V1-10 **13/13 real unit/negative tests** (operation `115d4a08-9dd2-4ffe-9784-4afcccdbdfa0`). An actual GTK window sourced from the **installed** one-file QA6 package was created on separate Xvfb, had a clicked `Control Center` button, exactly twelve cards, and unavailable unverified categories (operation `4e7e2bbf-ec73-4d6f-8916-68e0204fe984`, exit 0). DRI3/Mesa and negative Gtk slider dimensions were non-fatal graphics-test warnings. WinForms packaged native EXE SHA256 matches V1-10 QA6; existing Builder-gated real Stop Deny/Approve and startup handoff passed.

**New source archives:** Windows 189 files SHA256 `6e9a8a84c1f37a91dd2fe4d57f7fc6e28edcbc8ceeb0b8d54a481d7054832882`, Linux 186 files SHA256 `059680255ab39074cea7477b5b473d57a6b326087d1b0407b510ea307a27d1f0`, reflecting new native UI payloads; the underlying approved R48/R47 Backend and H3c Installer Core SHA256 `9ae0d8e569ca50ad580460c5e0001b54b88a696a4c2c72797edcd9500c164c52` were not modified. Actual installed native UI digests were independently compared to V1-10 QA6, not inferred from the launcher entry alone. Each host has a machine-readable `build-receipt.json` next to the QA binary.

**Open DoD:** V1-01 authenticated real trusted issuer/owner grant, V1-10 final product UI acceptance, V1-00 fleet-safe integration/cutover, real OS Boot/Login and publisher certificate/signature. No Admin/Root requested, no public release, no install on operational Routers, no physical GUI focus takeover. Status: `V1-08_INTEGRATED_QA6_UI=QA_PASS_SCOPED`, `V1_STANDALONE_FINAL=OPEN`. Historic H3c full Builder QA remains archived below.

---

## H3c full-Builder qualified one-file QA — 2026-11-05

**Current V1-08 QA candidate, not an approved public or production release.** The canonical `tools/one-install/build.py` with the real Headless gate built and exercised a new single-file candidate on both operating systems (with no privileged token, signature or production migration). The SHA differs from the earlier independently repacked H3c QA binary, but their accepted Backend/UI source archive and Installer Core SHA identities are the same.

| OS / host | Exact qualifying QA artifact | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 / Emad-PC-Ultimate | `outputs/one-install/h3c-qualified-qa/CommanderOne-Setup-Windows-x64-Headless-H3c-Qualified-QA.exe` | 151222088 | `084bc76b4ac36c006eb86ff9c29e46e47f7f9ebda76642c466ae5b6941542bf8` |
| Linux x64 / aliemad-Labtop | `outputs/one-install/h3c-qualified-qa/CommanderOne-Setup-Linux-x64-Headless-H3c-Qualified-QA.run` | 52712684 | `a1469859b6983248018611d1e55f0a864ed2ec037b18d3dcba3becbe295e0c80` |

**Source/core integrity:** Windows 189-file R48 archive SHA256 `5db0b11f7af2c6077d843c9e2f38ab1a78f4472e40d68938bb044ea757ffb118`; Linux 186-file R47 archive SHA256 `9b7a2f1a5db0fe5f07ba976cd0f25e67a5485b865a80f00eb5fb1ad032a53d36`. Shared Core SHA256 `9ae0d8e569ca50ad580460c5e0001b54b88a696a4c2c72797edcd9500c164c52`, builder SHA256 `10357f2cff4d442a3c565d23215fd2caa816accc2a2cf610db43cfef3b86d554`. Existing approved WinForms/GTK source bytes remain untouched.

**Full Builder gate:** Windows Standard64 / Full128 and Linux Standard64 / Full133 with exact baseline parity (60+4, 124+4 on Windows; 60+4, 129+4 on Linux), lifecycle, rollback/upgrade, reversible retire/restore, native startup, non-disruptive UI validation, stale runtime cleanup and fail-closed legacy elevated HTTP all PASS. Linux additionally ran `--headless-systemd-qa required` against **the newly built package** and obtained `headlessSystemdQa.status=PASS` for two independently healthy real user services and SIGKILL recovery; `bootOrLoginTested=false`. Windows recorded `headlessSystemdQa=NOT_APPLICABLE`. Both published files passed post-move `--verify-package` and SHA checks; Authenticode is `NotSigned`.

**Build input contract:** `build.py` expects a **raw dev23 base**. Previously patched R47/R48 packaged source is valid as an immutable source archive but is **not** itself an unpatched baseline for parity: running Builder directly against it yields `BASELINE_TOOL_PARITY_FAILED` with no missing/changed/added tools, because the four `capability_gap_*` registrations already exist. In owner-only *temporary copies*, the three exact Builder-inserted runtime changes were reversed under SHA preconditions; reapplying the canonical Builder injections regenerated exactly the original 189/186-file source archives. The raw test baseline then yielded the required four additive tools. No user/production source was reverse-edited.

**Release status:** `QA_PASS_SCOPED`; V1-00 controlled fleet cutover, V1-01 trusted elevated ingress, V1-10 approved final UI, real OS Boot/Login QA and publisher signing remain OPEN. A newer QA binary does **not** replace any current Router or validate Administrator/Root. Each host stores its own machine-readable `outputs/one-install/h3c-qualified-qa/build-receipt.json`; legacy manual-repack H3c QA hashes are preserved below for provenance.

---

## Current cross-OS H3c one-file QA — 2026-11-05

**Status: `QA_PASS_SCOPED`; not a production installation, signed release, fleet cutover, or final V1-10/V1-01 acceptance.** The H3c Installer Core is integrated in `tools/one-install/installer-core.cjs` (SHA256 `9ae0d8e569ca50ad580460c5e0001b54b88a696a4c2c72797edcd9500c164c52`). The files preserve verified Backend and UI payloads, changing only the installer/managed Headless lifecycle.

| Host / platform | Local QA artifact | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Emad-PC-Ultimate / Windows x64 | `outputs/one-install/h3c-qa/CommanderOne-Setup-Windows-x64-Headless-H3c-QA.exe` | 151222088 | `a176d5b33bda86dcaca325b43fecf1612b4d2bbeda3fad78af0965ed98dbc9b2` |
| aliemad-Labtop / Linux x64 | `outputs/one-install/h3c-qa/CommanderOne-Setup-Linux-x64-Headless-H3c-QA.run` | 52712676 | `09b9b252b7b0e90aaf258c6de3a2fdb3fe81084a29063f07675ac9aedd66549c` |

Windows preserved R48's 189-file source SHA256 `5db0b11f7af2c6077d843c9e2f38ab1a78f4472e40d68938bb044ea757ffb118` and WinForms SHA256 `2ed5401810027d56968f3b1db6789903a2acda78b2af51f0178c53b907d581bf`. The Windows SEA rebuilt byte-identically from exact pinned inputs. Linux preserved R47's 186-file source SHA256 `9b7a2f1a5db0fe5f07ba976cd0f25e67a5485b865a80f00eb5fb1ad032a53d36` and GTK SHA256 `aafe811384f1f8051d71e56e1b261878bf836c08685e912bb5e0179623d28d86`; Linux H3c repack also rebuilt byte-identically.

**Actual disposable package QA:** Windows Standard 64 / Full Power 128 MCP tools; Linux Standard 64 / Full Power 133. Both platforms passed two-profile installation, exact prior-R48/R47 to H3c Upgrade/Rollback in both modes, reversible Uninstall/Restore, owner-local Autostart, native startup handoff, safe lifecycle/control/port handling, identical-build incompatible payload rejection, and protected anonymous HTTP 403. Windows passed native WinForms Stop Deny/Accept offscreen events without touching the owner's desktop. Linux passed two concurrent independent real `systemd --user` services, per-profile stop, old/live unsafe mutation rejection, service SIGKILL recovery to a new verified PID, and changed-config SHA rejection on repeated enable. Full Power Headless enable is deliberately refused pending V1-01 trusted admission. All tests were temporary and non-elevated; no original Routers, installed profiles, or R48/R47 files were changed.

**Automated Headless release gate (2026-11-05):** The owned `tools/one-install/smoke-headless-systemd.py` is a reusable, actual owner-local user-systemd acceptance test. It checks exact Installer SHA, two independently healthy profiles, active Upgrade/Uninstall refusal, optional previous-Installer mutation refusal, config-SHA mismatch rejection, systemd crash restart (opt-in switch), recoverable Uninstall/Restore, Full Power trust boundary and cleanup. `tools/one-install/build.py` now supports `--headless-systemd-qa auto|required|off` (default `auto`): on a ready non-root Linux user manager with `linger=yes`, it runs this test before publishing the preview; absent readiness it records `NOT_RUN`, not `PASS`. Use `required` for release qualification to fail closed when systemd is unavailable. On Windows it reports `NOT_APPLICABLE`. Both the actual Linux H3c binary and the exact Builder gate were exercised: durable operations `1a7d4a33-693a-4348-8016-5137e993870f` and `e4532866-1631-48d6-8bee-791b59f94366` succeeded (exit 0). Twelve pure Builder receipt/admission tests passed on Windows. These results prove user-service restart after a process fault, **not** an actual OS reboot or login event. No permanent service or live Router changed.

**Rollback after an independently approved managed deployment:** Disable every H3c Linux Headless profile via its installed `bin/node Commander.cjs --headless-disable --target TARGET --profile PROFILE`; disable enabled Autostart and stop owner backends. Invoke the same OS H3c package with `--rollback --target TARGET --mode standard` (or `--mode full` for a Full Power managed install). Verify `--status`, profile identity, state hash, and healthy Backend. Rollback requires the known exact backup slot and retains the newer candidate without deletion. For recoverable `--uninstall`, use `--restore` only with exactly one verified retired slot and a free target. Do not operate on unmanaged legacy Router installations.

**Open gates:** V1-01 authenticated privilege boundary, final V1-10 UI sign-off, V1-00 fleet integration approval, real OS Login/Restart QA, Commander publisher signing/public release. `V1_STANDALONE_FINAL=OPEN`.

---

## Previous Windows R48 unsigned QA — 2026-11-05

Windows R48 is the **latest Windows x64 packaged QA**; Linux R47 remains the current Linux x64 packaged QA. R48 is a separately tested one-file preview, **not** a signed publisher release or production migration.

| OS | Owner-local QA artifact | Bytes | SHA256 |
| --- | --- | ---: | --- |
| Windows x64 (R48) | `outputs/one-install/r48/CommanderOne-Setup-Windows-x64-UI-preview.exe` | 151,210,824 | `246c8fcb922161f4073fd787a681fafb7d8f62d64d3e2086b50cab6b13b11ddd` |
| Linux x64 (R47) | `outputs/one-install/r47/CommanderOne-Setup-Linux-x64-UI-preview.run` | 52,713,514 | `29232cfe836a33d0ecd528596584df76ca21d3b9558ced1f2d5a0ca0e2d71481` |

Windows R48 source archive SHA256 `5db0b11f7af2c6077d843c9e2f38ab1a78f4472e40d68938bb044ea757ffb118` (189 files). The exact binary passed independent size, outer SHA, 189-file embedded `--verify-package`, Standard64/Full128 installed runtime/lifecycle/upgrade/rollback/reversible uninstall/WinForms/Autostart/dead-control recovery and fail-closed privileged anonymous HTTP gates. A **separate actual temporary full-mode installation** confirmed all four packaged GUI sources byte-for-byte: `gui-control.ps1` (`5a45067b1748d6bde33a903801918794540267624369ce6b78048dda7ba92df0`), `gui-native.cs` (`613f04fe13e173d79e7d9779ac9a64048bd1ce59d98d32ea40ae2143d3b1ccd0`), `gui-notice.cs` (`353c74bcd9bcd695b2b32b29fe8eece08a749f64aaabbbbd5b6492b162f33062`), and `gui-dxgi-session-probe.cs` (`bbc6babe1b6cb1694ec09f17b308ef43bb697f7ae6a725581a18521ee85afaa9`). R48 acceptance operation `fec8c1ff-7924-4625-9726-e948c0617510` SUCCEEDED exit0. The previous R48 attempt was **rejected** when the Builder silently excluded GUI Overlay files; that incomplete exact-hash binary was removed before rebuilding. Builder now requires these four Windows GUI files with fixed source hashes, rather than merely noticing their presence in an Overlay directory. The actual accepted R48 file is `NotSigned`.

On-host live read-only screenshot QA: the same R48 helper on HPC-159 returned a 320×240 frame; on HPC-154 it correctly returned `GUI_OWNER_RDP_SESSION_DISCONNECTED`, without exporting a frame, input injection, session reset, or changing the production helper. Native D3D11/DXGI tests passed adapter and output checks on both, but HPC-154's `DuplicateOutput` returned `0x887A0028` (disconnected RDP session); HPC-159 returned `S_OK`. Windows local session manager logged an HPC-154 disconnect on 2026-11-05 at 04:44:48 UTC. The error classifier is verified; actual frame restoration requires an authorized owner-side RDP reconnect and a new test. Its supported WGC alternative remains untested. GUI-safety source suite: 90 passed, 1 skipped, no failures. These tests prove the scoped classifier and same-host control behavior, **not** unrestricted GUI-control acceptance.

**P0 operational mitigation:** The real installed older source-different `FULL_ACCESS` Canary HTTP ports returned anonymous `/mcp` status 200 in a read-only tools/list request. There were 13 configured owner-local Canary profiles across six hosts after a concurrent new MMZ profile was discovered; independent later checks established all 13 stopped, loopback ports unbound and owner-local Autostart disabled. Original six `0.11.0-dev.23` `FULL_POWER` connectors stayed online. **Do not start those older FULL_ACCESS Canaries** until authenticated ingress and security boundary are deployed and tested. A successful R47/R48 synthetic-config 403 test does **not** automatically secure those older running installations. A high-admin native-token action and authenticated V2 ingress are still unproven.

**Additional R48 native Administrator boundary QA (2026-11-05):** Canonical `tools/one-install/qa-high-token-privileged-http.mjs` SHA256 `9985492167e3310e130cc13a363ef562db3899a17e4f8c6b17194614f9692742` ran with independently verified real **high-integrity Windows Administrator tokens** on both HPC154 and HPC159. In each host, actual `probeWindowsAdministrator` succeeded; all 12 unauthorized loopback HTTP requests covering `STANDARD`, `FULL_POWER` and `FULL_ACCESS` configurations and forged Bearer/chat/Host metadata returned HTTP 403, with 0 dispatched calls and `/health` intact. This is 24/24 checks across both hosts. The test module identities exactly match the accepted R48 installer modules (verified from another disposable full-mode install); the packaged legacy guard precedes MCP dispatch. Expanded isolated V2 authentication/WorkflowStore grant regression passed 158/158 tests on Windows. **This verifies the defensive boundary, not a working trusted V2 OAuth/mTLS deployment, an authorized privileged tool execution, or a public signed service.** No production service or owner GUI was modified; SHA-pinned ephemeral QA directories were removed. Linux native Root approval was not available in the three owner sessions.

Open release gates: signed publisher identity (two unrelated code-signing certs exist on owner Windows but no Commander-specific trusted private-key certificate, Authenticode `NotSigned`); real OS Login Autostart, owner-authorized RDP GUI frame on HPC-154, authenticated privileged caller/approval boundary, and reversible six-host legacy Router/profile cutover. No Administrator/UAC prompt was needed to build or test R48; `V1_STANDALONE_FINAL=OPEN`.

## Previous cross-OS unsigned QA: R47 (2026-11-05)

The latest **Commander V1** one-file QA packages are pinned below. This release adds a fail-closed boundary for the **legacy anonymous HTTP `/mcp` ingress** when a worker is configured FULL_ACCESS, runs with real elevated Windows token, runs as Linux root, or cannot prove a nonprivileged native token. A separately authenticated, owner-bound V2 ingress is still required to accept protected actions; HTTP Bearer text or a FULL_POWER name is not a privileged authorization proof. The ordinary owner-level FULL_POWER legacy MCP path remains available.

| OS | QA artifact on owner host | Bytes | SHA256 |
| --- | --- | ---: | --- |
| Windows x64 | `outputs/one-install/r47/CommanderOne-Setup-Windows-x64-UI-preview.exe` | 151,201,608 | `26e24fd93afd2cdfb4922477486e70aa167da529aba4c2668e6e7717ef45a72f` |
| Linux x64 | `outputs/one-install/r47/CommanderOne-Setup-Linux-x64-UI-preview.run` | 52,713,514 | `29232cfe836a33d0ecd528596584df76ca21d3b9558ced1f2d5a0ca0e2d71481` |

Windows source archive SHA256 `188b5cff5516a7a754813eef8de75f8b0b01ec7551ce1105a5b938e94eb0a165`, 183 files and WinForms UI SHA256 `2ed5401810027d56968f3b1db6789903a2acda78b2af51f0178c53b907d581bf`; Linux source archive SHA256 `9b7a2f1a5db0fe5f07ba976cd0f25e67a5485b865a80f00eb5fb1ad032a53d36`, 186 files, GTK UI SHA256 `aafe811384f1f8051d71e56e1b261878bf836c08685e912bb5e0179623d28d86`. Both exact final binaries independently passed SHA/size and `--verify-package`. Windows Builder operation `5714451a-b698-49b4-9dae-cb69dfbb82d1`; Linux `56a08969-4748-40d8-9c60-bd0654295e70`; both SUCCEEDED exit0 with mandatory Standard and Full Power installed-gate PASS: MCP/HTTP dev23 parity, multi-profile lifecycle, upgrade/rollback, reversible uninstall/restore, native Autostart handoff, non-killing dead-control reconciliation, real WinForms/GTK scoped controls and new `privilegedLegacyHttpQuarantinePass=true`. 15 security unit tests PASS on Windows. **No package was signed or installed over dev23 connectors.**

The Linux R47 package was also delivered to MMZ via an ephemeral Tailscale peer-only HTTP Range transfer, resumed after transport timeout, exact final SHA/size and embedded manifest checked. MMZ isolated installed-file security QA operation `b466c272-b8ed-41a0-8021-d3895226d43a` SUCCEEDED exit0: FULL_POWER nonprivileged [200,200], synthetic configured FULL_ACCESS anonymous and forged-token [403,403], `productionTouched=false`, `actualAdminTokenTested=false`; its original source-different Canary remained live. All temporary transport scripts and the 116MB duplicate staged Windows GUI build were removed after verification.

Six original dev23 connectors and 12 source-different managed Canaries are separate services. The 12 Canaries last passed runtime identity and owner-local Autostart registration, but a real OS Login event, per-host migration of production Router/session bindings, actual physical owner GUI input consent, high-admin-token runtime acceptance and HPC154 live GDI capture remain OPEN. The Windows screenshot fault on HPC154 is Win32 invalid-handle 6; per Microsoft, the sanctioned alternatives are Windows.Graphics.Capture and the DXGI Desktop Duplication API, not an RDP session reset or GUI guard bypass. No public publisher-signing identity is provided; Windows Authenticode is `NotSigned`. `V1_STANDALONE_FINAL=OPEN`.

## Previous Linux unsigned QA: R46 (2026-11-05)

**Linux x64**: `outputs/one-install/r46/CommanderOne-Setup-Linux-x64-UI-preview.run` — **52,712,816 bytes**, SHA256 `cfb2b70d5ead2a7e514a351665f5f1d299a39f748bdc3345a091a882485369d8`. The actual file passed independent `--verify-package` (185 files; archive SHA256 `fcd027903217047b28bd58f258e19ae96de0e75bf43d3c69db4fc4900894050b`). It remains an **unsigned owner-local QA preview**. The active original `dev.23` Router was not replaced. On Windows **R45 remains the latest packaged QA**: R46 core was source-tested on Windows (Standard and Full), but the Windows R46 Builder invocation was rejected by tool safety checks; no Windows R46 executable or public release has been accepted.

R46 introduces `--runtime-reconcile`, a deliberately non-killing recovery for a dead **owner-managed** Backend control record. It refuses any live/reused/inaccessible PID, changed profile configuration, active reconcile lock, occupied control/backend port, unsafe recovery alias or changed control file. On a verified dead record it first makes a private exclusive recovery copy, then removes only that exact stale file; a separate `--start` is needed to restart. Second reconcile is idempotent, and an exclusive lock blocks competing managed Start while reconciliation is in progress. The command does **not** imply system Administrator/Root or physically authorized GUI control.

Linux packaged Builder operation `ab674e0e-6ff6-4127-9d38-f35c62aaa357` SUCCEEDED exit0: Standard (64 tools) and Full Power (133) both passed package install/HTTP/MCP parity, lifecycle, R45→R46 upgrade and rollback, reversible uninstall/restore, native XDG Autostart handoff and `runtimeDeadControlReconcilePass=true`. Canonical core SHA256 `e11a22d221f8fce6df76a832735d886fcdb4e699b55d8d5f492b750ca73ebbc2`; Builder SHA256 `3bb299dbd439ab8e9d0d1f32b64ad7f47731ec81a9171439d9840ab4db6d1d18`. Independent owner-local source integration also PASS on Windows Standard op `b6d24db4-b1ec-4824-92d4-65098c4c120b`, Windows Full op `3d71e8ed-2353-4469-8e4a-9613215ac13d`, Linux Standard op `36280a97-dcf3-4d91-b456-7324dc05b5da`. On MMZ host, R46 core+QA file copied byte-identically and **Full Power** independent regression op `daa029ac-811b-4658-b3a8-63ff4ec3e2fa` also PASS, using only disposable R45 installations. No R46 package installed on MMZ; MMZ's working R45 artifact and differently sourced live Canary were preserved.

**Other acceptance gates OPEN:** Windows R46 executable packaging, actual physical GUI-owner consent and task-effect receipts, HPC-154 native screenshot (independent GDI CopyFromScreen and BitBlt both returned Win32 error 6 Invalid handle, whereas HPC-159 passed), genuine OS-login startup, trusted publisher signing and six-host one-managed-install Router cutover. Do not sign using unrelated development certificates, reset a shared RDP session without authorization, or bypass tool invocation restrictions.

## Previous Windows QA: R45 (2026-11-05)

R45 keeps the managed R44 installer Core but closes the isolated **Windows WinForms Stop confirmation** acceptance gate with real in-process button events. It does not silently alter the original owner desktop: the production Yes/No dialog is unchanged; the isolated test supplies controlled denial and approval, verifying that denial leaves Backend running and approval stops it. This is stronger UI-event QA, **not** permission for global desktop takeover.

| Platform | Owner-host artifact | Bytes | SHA256 |
| --- | --- | ---: | --- |
| Windows x64 | `outputs/one-install/r45/CommanderOne-Setup-Windows-x64-UI-preview.exe` | 151,195,976 | `a22ed5d48de7e73b1ff99a42c31c02de22dc6636a1d5e13dc3af94ab4cd499ef` |
| Linux x64 | `outputs/one-install/r45/CommanderOne-Setup-Linux-x64-UI-preview.run` | 52,711,868 | `3b57bb36b919cd9fac2f57da39e6b050c379be2192b7094fe1ef55b53f5feade` |

Both final files passed on-host `--verify-package` and SHA256 rechecks. **Actual packaged** install, HTTP/MCP parity, lifecycle, R44→R45 upgrade/rollback (Windows) and R42→R45 (Linux, since Linux payload is byte-identical to R44), reversible uninstall/restore, Autostart registration, native startup launcher handoff all PASS for both Standard and Full Power. Windows additionally reports `winformsStopConfirmPass=true` in both modes, Linux correctly reports it `false` because this Windows-only UI gate is not applicable. Windows UI SHA256 `2ed5401810027d56968f3b1db6789903a2acda78b2af51f0178c53b907d581bf`; Windows source archive SHA256 `99b0203f3822600127146a02d5a7de367ed071dc0bc191c6a3485e17e8cd2f69`. Linux archive SHA256 remains `c91f4f9d65be0c61fa12212d86cd496f9ddf8741ff9cb3ea5d9530e5628bef5f`. Durable Builder ops: Windows `5fa4b086-d8f6-4c3a-80d3-1da38aa4900a`, Linux `11653f4d-7240-499f-8f96-133489131de4`, both SUCCEEDED exit0.

The canonical Builder now fails closed when the WinForms Start/Status/Stop denied/approved event harness cannot prove a genuine isolated Backend result. It uses a disposable .NET build and managed install, not a production instance. Confirmed separate offscreen QA Standard op `6963b5dc-8dd2-46c6-82a2-9109aaf79ac6` and Full Power op `937197cb-b6b0-4ca1-82af-05ee142052ee`, both PASS; all test roots and redundant 116MB Windows UI staging were verified then cleaned. A fresh KDE aliemad read-only desktop frame also passed via observed `kde-x11-xdotool-readonly` Backend, not Wayland input consent.

No publisher-signed Windows installer or approved general Linux release was produced. Windows Authenticode is `NotSigned`; existing unrelated Development certificates are not valid public Commander publisher credentials. `FULL_POWER` is not OS Administrator/Root. Emad owner Windows Broker `os.probe` answered from SYSTEM, but metadata is protected and broader native authority is not asserted. Live Fleet six-host replacement, cross-profile browser auth actions and owner GUI focus control remain OPEN. Preserve R44 and installed `dev.23` as recovery baselines; do not cut over existing Router services without an owner-approved reversible migration.

## Previous unsigned QA candidate: R44 (2026-11-05)

**New native launcher QA gate:** Windows and Linux both ran their actual owner-local startup entry (WScript / XDG Exec), verified the managed Backend identity, stopped cleanly and disabled registration in isolated Full Power runs. Release Builder now requires this test for BOTH Standard and Full Power before publication. Windows Builder operation `718ce9c4-7774-4e58-afab-a6e3465ae9ab` and Linux `864a41d4-02ee-49e9-9ac4-64b1c7fb203a` both PASS with `nativeStartupHandoffPass=true`. Windows executable rebuild has same source manifest, UI hash, file size and PE timestamp as the retained R44 but a distinct outer SHA256: `1469ba7dc13078dda4120ee4ca42b1dbb192841f595a8900ef28109652cc47c9`; byte-level reproducibility is OPEN, gap `gap-c1d6d19a07b2ce1f8003`. The retained R44 file hashes listed below remain unchanged. Real OS login event, public signing and fleet deployment remain OPEN.

R44 is the latest **local, unsigned, reproducibly pinned** Windows/Linux preview, tested with the full seven-file Full Access/Browser/Capability Gap overlay. Production, publisher signing, authenticated GUI control and all-host migration are NOT accepted.

| Platform | Owner-host output | Bytes | SHA256 |
| --- | --- | ---: | --- |
| Windows x64 | `outputs/one-install/r44/CommanderOne-Setup-Windows-x64-UI-preview.exe` | 151,195,976 | `b05ab197c02d730b54eb36443f9626eb6b19c15822c9d79cbe26479efc2a7754` |
| Linux x64 | `outputs/one-install/r44/CommanderOne-Setup-Linux-x64-UI-preview.run` | 52,711,868 | `3b57bb36b919cd9fac2f57da39e6b050c379be2192b7094fe1ef55b53f5feade` |

**Frozen two-OS acceptance:** identical installer Core SHA256 `3a0801735e6ed4ebff0bf5be0839bc62cbe1de994367538cebec84abd1d1868c`, gated Builder SHA256 `42e23d6df5d7ec20bb91c7d03cc068390cff7957fc63f98e5a5e44a716520b33`, and rollback test SHA256 `0a583f3ff8d04ddfe80d7f10d99efad79cf81bee5c80f1cbf7d155ef543003a8`. All seven overlay source hashes were pinned identically across the builders; OS-specific dev23 source and UI assets remain distinct. For **each** platform and each Standard/Full Power mode: actual executable install and live backend tool-schema parity, two-profile start/status/stop, upgrade/rollback with source/core/UI identity, reversible uninstall/restore, and two-profile installed-CLI autostart enable/disable PASS. Independent `--verify-package`, SHA256 and file-size postpromotion checks PASS.

Linux's first expanded-overlay attempt exposed an unsafe standing GUI flag and failed closed; syncing the newer Core (explicitly sets `ownerAuthorizedTakeover=false`) resolved this with the safety test **retained**, not disabled. A subsequent rollback test needed an updated SHA256-backed artifact-slot identity because the Core now keys failed/backup slots on source+core+UI; the revised test also checks the retained candidate's identity. Initial Linux local-file promotion receipt had a cosmetic grep formatting failure *after* the atomic move; independent reconciliation verified the exact target and package, without replaying the move. The earlier R43 packages below remain previous QA evidence, not the recommended current candidate.

**Open:** real OS-login Autostart event, signed/public release and licensing, GUI owner-session consent, usable cross-app/browser agent UX, safe six-host cutover/rollback and native OS elevated-scope claims. Local builder snapshots are evidence of release qualification, not an authorization to install over active legacy roots.

## Previous unsigned QA candidate: R43 (2026-11-05)

R43 was built from a pinned, isolated copy of the existing Builder and verified on the Windows and Linux owner hosts. Neither preview is signed, published as a general release, installed into the live Router routes, or proof of authenticated app/browser automation. Do not replace legacy Commander installations with these packages without a separately approved migration.

| Platform | Actual on-host file | Size (bytes) | SHA256 |
| --- | --- | ---: | --- |
| Windows x64 | `outputs/one-install/r43/CommanderOne-Setup-Windows-x64-UI-preview.exe` | 151,191,368 | `07bad6890c1a5568646554f3162e847b67d3f4397e6b18271261780eee858036` |
| Linux x64 | `outputs/one-install/r43/CommanderOne-Setup-Linux-x64-UI-preview.run` | 52,709,171 | `0f3217c6be9111fcd42c5ad9111ea652b5cc28d5a7bcedbb73dbfeeb71001332` |

Both **actual executable packages** passed independent `--verify-package` (exit0), and Builder-gated real backend, per-profile start/stop, upgrade/rollback from R42, reversible uninstall/restore, and packaged-CLI autostart enable/disable on both Standard and Full Power. On Windows: 64 Standard / 128 Full Power tools; on Linux: 64 Standard / 133 Full Power tools. The added Registry methods were exactly four per mode; differing platform-specific Full Power tool counts are factual and must not be reported as identical. The new startup QA explicitly did **not** simulate a real login event. Build operations: Windows `28c50f47-8bcf-4213-87a6-3e0436283dec`, Linux `08bc2172-b526-42df-b580-51ede753c339`.

**Release-gate provenance:** R43 builds used the short-lived `.qa/r43-release-builder/` snapshot with canonical source core SHA `15fe94a7b7c91256366b46227a592b90f12445a32944f3d9f278c9c7c62a7546`, Builder QA SHA `546b9c812fdd90d94ecc5ab7224888f5480b5cd34ca4044c91eff5c4bf8a93d5`, packaged autostart test SHA `b66adc2b368b05897403007fb8e6168aaade12096c0b5fc25443b32554735509`. This prevents overwriting another writer's uncommitted `build.py` changes. The packaged gate is now integrated in canonical build.py and was independently re-run on both OSs, including the additional native-launch handoff; Windows SEA byte-for-byte reproducibility remains unresolved. Do not infer signed/public release acceptance from these local QA artifacts.

## Previous release candidate: R42 (2026-11-05)

R42 has **verified Standard and Full Power** local QA on Windows x64 and Linux x64, including native dashboard asset integrity, two managed profiles, live MCP Backend, reversible preview-to-preview upgrades and explicit owner-local **reversible uninstall/restore**. These are **unsigned QA previews**, not a signed production distribution or an approved replacement for the six active legacy hosts.

| Host | Current one-file QA candidate | SHA256 |
| --- | --- | --- |
| Emad Windows | `outputs/one-install/r42/CommanderOne-Setup-Windows-x64-UI-preview.exe` | `d0367bf2cf7f979eb58eee2c4257fa9fc4573e65657b2539143a48c439f9e1eb` |
| Emad Linux | `outputs/one-install/r42/CommanderOne-Setup-Linux-x64-UI-preview.run` | `8075e59e4bdb931aaf6e71faf4998f24fd3fd4a6a15739e988a9016710ecc0c0` |

### Owner-local reversible uninstall

The installed R42 CLI **does not perform irreversible deletion**. `--uninstall --target TARGET` refuses any active or stale backend control and occupied configured ports, checks the exact managed product marker and profile structure, and renames the entire inactive managed root to a content-addressed `.retired-` sibling. The original TARGET becomes uninstalled; user data and all profiles remain intact in the retired root. `--restore --target TARGET` using the R42 installer or retired CLI restores that exact root only when the original TARGET is absent. If a different install occupies TARGET, restoration refuses to overwrite it. Retired copies are recovery data, **not additional active installations**. There is no automatic purge, privilege escalation, production service destruction or cross-user file migration.

Windows examples (explicit only; use a disposable TARGET for evaluation):

```powershell
& "$target\Commander.exe" --stop --target $target --profile default
& "$target\Commander.exe" --uninstall --target $target
& $setup --restore --target $target
```

Linux equivalents:

```bash
"$target/bin/node" "$target/Commander.cjs" --stop --target "$target" --profile default
"$target/bin/node" "$target/Commander.cjs" --uninstall --target "$target"
"$setup" --restore --target "$target"
```

Release Builder R42 now publishes only after **both** Standard and Full Power pass `smoke.py` (64-tool schema parity), `smoke-lifecycle.py`, R39→R42 `smoke-upgrade.py`, and `smoke-retire.py`. The last suite verifies preserved byte-identical two-profile JSON/state, active-uninstall refusal, target-occupied restore refusal and exact restore in both OSes. Linux GTK actual Start/Status/Stop widget events passed in the isolated owner-only QA. Windows WinForms Start/Status real button event handlers passed from the owner-local **offscreen** test harness `ManagedProfileUiOffscreenQA.csproj`, without foreground focus or physical input; this does not prove full native Windows on-screen UX/Stop modal. Existing live Router state is untouched.

**Six-host read-only migration baseline:** Emad Windows three configured routes/21 release directories; Emad Linux one/9; MMZ Linux one/27; Aliakbar Linux zero in the standard routing directory; Emad Windows server two/6; Amirreza Windows server two/6. No product marker of a production single-root migration was present in the inspected known directories. The zero count for Aliakbar is **not proof of no Commander installation elsewhere**. Unattended migration of legacy roots, signing, autostart, real OS GUI screen control and the complete chat/browser/agent task UI remain OPEN.

---


**Status (R37, 2026-11-05): executable pre-release QA. Not yet signed, not a production upgrade, and not a fully autonomous desktop agent.** The UI is a reused *read-only native Control Center*. The application Core is installed beneath one managed directory for the current OS user, with multiple logical account profiles inside that directory. Existing dev.23 services and installed profiles are **not migrated, deleted or stopped**.

## Current tested one-file outputs

| OS | Native installer | SHA256 | Size |
| --- | --- | --- | --- |
| Windows x64 | `outputs/one-install/CommanderOne-Setup-Windows-x64-UI-preview.exe` | `f96f71f24a536350cd72b12a639e0b221703201c1d1671769f8477c348b864ea` | 151,163,720 B |
| Linux x64 | `outputs/one-install/CommanderOne-Setup-Linux-x64-UI-preview.run` | `8266f7c6af1844040c4a76ff4fcf76da874e78a866a9a421b6994028a9b74739` | 52,707,564 B |

Each file includes the Commander dev23 backend (with scoped API and capability-gap extension), an OS-appropriate Node runtime, and native read-only Control Center assets. **Windows** bundles a self-contained .NET/WinForms UI. **Linux** contains the existing GTK4/Adwaita UI (system `python3`, `gi`, Gtk 4, Adw 1 required on the destination; this is checked by `--dashboard-probe`). No Chromium browser is installed or selected as a default.

## Inspect and test without touching an existing live installation

Windows PowerShell:

```powershell
$setup = "$HOME\source\repos\ChatGPTRemoteCommander\outputs\one-install\CommanderOne-Setup-Windows-x64-UI-preview.exe"
$target = "$env:LOCALAPPDATA\CommanderOne-Preview-Test"
& $setup --verify-package
& $setup --install --mode standard --target $target
& "$target\Commander.exe" --status --target $target
& "$target\Commander.exe" --dashboard-probe --target $target
# Explicitly open the existing read-only native Control Center:
& "$target\Commander.exe" --dashboard --target $target
```

Linux Bash:

```bash
setup="$HOME/source/repos/ChatGPTRemoteCommander/outputs/one-install/CommanderOne-Setup-Linux-x64-UI-preview.run"
target="$HOME/.local/share/CommanderOne-Preview-Test"
"$setup" --verify-package
"$setup" --install --mode standard --target "$target"
"$target/bin/node" "$target/Commander.cjs" --status --target "$target"
"$target/bin/node" "$target/Commander.cjs" --dashboard-probe --target "$target"
# Explicit GTK launch; only when the graphical user is present and agrees:
"$target/bin/node" "$target/Commander.cjs" --dashboard --target "$target"
```

Use `--mode full` instead of `--mode standard` during a *fresh* installation to select Full Power configuration. This **does not** grant Administrator/Root privileges or permission to operate another person's desktop. Select the mode on installation: modifying it later requires a separate managed reconfiguration procedure, which is not yet released. To add a second logical profile within the **same** product root, run the installed Commander CLI with `--add-profile --profile MMZ --target TARGET`; no second installation is created. `--run --profile default --target TARGET` runs the backend in the foreground, using the configured loopback port (which must be available). The native Control Centers read the existing same-owner production monitoring state; they are **not yet a live edit/control console for the newly installed preview profiles**. Use `--dashboard-probe` to test UI assets and OS dependencies without opening a window.

If TARGET is an existing unmanaged installation or an installation of another version/mode, this preview **refuses installation**, leaves it intact and reports that explicit migration is required. Avoid installing over a production root; preview migration and uninstall are not accepted. The package does not auto-start services, inject apps, copy credentials/cookies, modify the Windows Registry, elevate OS permissions or invoke a GUI unprompted.

## Verification and build

Both OS builds passed their own real executable `--verify-package`, clean fresh install, idempotent re-run, two logical profiles, dashboard SHA/dependency probe, actual installed backend `/health` + MCP `tools/list`, temporary installation cleanup, and identical 64 MCP schemas under **both** Standard and Full Power. Cross-OS canonical schema hashes:

- Standard: `0c5712c116519a9d95842c99931b533f40c41cd6dd996c4dd57fe6fe170ebd2d`
- Full Power: `625c12eb44c26e93e875b96394799075a1420ea5c2da32f46f3b84b57d605a30`

Windows WinForms offscreen UI structure/theme/accessibility tests passed. Linux existing unit tests (32/32) and a separate synthetic, owner-data-free Xvfb native GTK render (five stack pages/five visible navigation buttons, 199px sidebar) passed. **These findings do not prove real user account automation, GUI control authority, shopping/messages, universal OS parity or finished UX.**

Implementation: `tools/one-install/{installer-core.cjs,build.py,smoke.py}`. Builder derives backend from immutable installed dev23 and a bounded QA overlay of canonical browser/Registry/Full Access modules, rather than the dirty whole worktree; it embeds SHA256 of every application file. It builds with official Node SEA for Windows or a SHA-checked self-extracting Linux package, then runs both actual installed standard/full smokes against a *staged executable* before publishing the finished one-file preview on the output filesystem. No network access or UAC is needed by the tested local package.

**Open product gates:** independently qualified and signed Windows/Linux release, user-facing chat/browser/workflow control UI (not just read-only monitoring), safe profile/session migration and backup/rollback/uninstall, stable one-install autostart/update, real authenticated action receipts with browser/app-profile neutrality, native authorization UX, and fleet deployment to six known connected hosts. Do not call this a finished public installer.


## R38 lifecycle preview (superseded by R39)

The **newer R38 preview** now supports explicit background lifecycle commands and allocates separate, available loopback ports on installation rather than using the Router-reserved port `47831`:

| OS | R38 installer | SHA256 |
| --- | --- | --- |
| Windows x64 | `outputs/one-install/r38/CommanderOne-Setup-Windows-x64-UI-preview.exe` | `62e0a9d954b4cb5362e22ded46a502417a967728e058097a1fa31adcfb532431` |
| Linux x64 | `outputs/one-install/r38/CommanderOne-Setup-Linux-x64-UI-preview.run` | `28d9fdd607a9b91b6ffd35194ac777d918fbb5c27228e91eb2eba2a44746ec25` |

For an **isolated fresh preview** install, use the installed CLI with `--start --target TARGET --profile default`, `--runtime-status --target TARGET --profile default` and `--stop --target TARGET --profile default`. This starts a detached local backend, probes exact `/health` profile/config identity before accepting launch, reports live state, and stops it through its own authenticated local control socket. To run two accounts in one installation, `--add-profile --profile MMZ`, then `--start --profile MMZ`; each profile has its own port, state and private control record. A duplicate launch is refused. Port conflicts and a modified/stolen control token are rejected without stopping an unrelated process. **This does not imply unattended remote control, Administrator/Root, or a finished visual agent.** In a user-owned installed environment, same-user access to the private control record is part of the trust model.

The two real OS lifecycle tests executed `tools/one-install/smoke-lifecycle.py` on the R38 one-file installers and passed: two real concurrent backend processes/HTTP identities, unique ports outside known reserved stable-router ports, duplicate-start rejection, occupied-port rejection, forged-control-token rejection, verified per-profile `--stop`, and state cleanup. All smoke installs and services were terminated and removed. R38 packages remain **unsigned local previews**; production migration, browser/app authorized tasks, visual interaction and universal Linux GTK portability remain unverified.


## Current R39 candidate — build gate and content identity (2026-11-05)

**Use these newer tested files** for fresh, isolated evaluation; R37 and R38 files remain historical QA artifacts, not recommended for new installs:

| OS | R39 one-file installer | SHA256 |
| --- | --- | --- |
| Windows x64 | `outputs/one-install/r39/CommanderOne-Setup-Windows-x64-UI-preview.exe` | `6dc954ef60fce2b92fcf5be1c3ccc49475d713cc30a5e5ec898ee932c19df73c` |
| Linux x64 | `outputs/one-install/r39/CommanderOne-Setup-Linux-x64-UI-preview.run` | `6407ab6909fbc640d5a0f738fbcd4c4f073bb7ca16380dc59f340685d3dd516e` |

The single-file release builder now **gates both Standard and Full Power on real lifecycle tests**, including an installed backend's verified `start → health → runtime-status → stop`, separate free loopback ports, duplicate/occupied-port rejection and forged-control-token refusal. It still also performs manifest integrity, native dashboard verification, 60 unchanged installed-dev23 MCP schemas plus four Registry additions, and same-OS archive extraction before publishing. Deterministic QA rebuilds of both R39 installers produced **identical artifact SHA256** and were cleaned after verification.

The installer now treats the product content SHA256 **and** native UI asset identity as part of idempotency, in addition to its build label. When the label matches but payload differs, it fails with `INSTALLER_SAME_BUILD_DIFFERENT_PAYLOAD_REQUIRES_UPGRADE` without modifying the existing installation. Tested on Windows and Linux by trying to install R39 over an isolated R37 installation, preserving the old `product.json` bytes. No automatic upgrade, legacy migration, uninstall or desktop shortcut registration is implemented.

To run the installed program, use the platform-specific CLI from the previous section, for example Windows:

```powershell
& "$target\Commander.exe" --start --target $target --profile default
& "$target\Commander.exe" --runtime-status --target $target --profile default
& "$target\Commander.exe" --dashboard --target $target
& "$target\Commander.exe" --stop --target $target --profile default
```

Or Linux:

```bash
"$target/bin/node" "$target/Commander.cjs" --start --target "$target" --profile default
"$target/bin/node" "$target/Commander.cjs" --runtime-status --target "$target" --profile default
"$target/bin/node" "$target/Commander.cjs" --dashboard --target "$target"
"$target/bin/node" "$target/Commander.cjs" --stop --target "$target" --profile default
```

**Trust boundary:** the local stop protocol validates a random per-launch token, profile and exact backend config identity and does not kill arbitrary PIDs. Control records are private to the same OS account, not a multi-user administrator boundary. Full Power remains *owner-user* authority only, and the native Control Center is still **read-only**: the operator must explicitly start services and select tasks through supported Commander MCP tools. The public all-in-one autonomous workspace, explicit migration with rollback, secure app/browser account actions, signed and independent Windows/Linux installer distribution remain OPEN.


## R41 — managed native UI and recoverable one-file upgrades (2026-11-05)

R41 is a **prior** local QA preview; R42 supersedes it. Older R37–R40 files remain evidence only, not a recommended public installer.

| OS | Current R41 single-file installer | SHA256 |
|---|---|---|
| Windows x64 | `outputs/one-install/r41/CommanderOne-Setup-Windows-x64-UI-preview.exe` | `85a7d2c44d77dc0b73860eaa99fc39dfec7ae5a6d7beb267f070ba3f515f388e` |
| Linux x64 | `outputs/one-install/r41/CommanderOne-Setup-Linux-x64-UI-preview.run` | `c3ec74850b691459da9593bb2a579b48c02054e40e6f24675c7e63d30dca1bd9` |

**Managed native buttons:** the reused Windows WinForms dashboard now offers an explicitly opened `Managed Profiles` dialog. The existing Linux GTK4/Adwaita Profiles page now embeds Start, Status and double-confirmed Stop buttons. These actions use only the selected **current owner-local preview** profile; they do not switch or mutate legacy Routers, acquire an Administrator/Root token, copy browser credentials, or take over a foreign GUI. Invoke the installed CLI with `--dashboard --target TARGET` to open the system's native dashboard explicitly. Use `--dashboard-probe` to check the signed-by-manifest native asset without launching it.

**Verified UI scope:** Windows interactive dialog was compiled with the immutable dev23 WinForms source and bundled with a file SHA check. Its click behavior was **not** independently tested on a live owner display, which is not a release PASS. Linux GTK widget Start/Status/Stop click events were exercised on a disposable installed R40 preview with an isolated Xvfb session, including a second Stop confirmation and real backend receipts; `GTK_REAL_BUTTON_EVENTS_PASS`. A subsequent full desktop launch test was blocked by Linux Commander's explicit GUI API restriction, and the Linux KDE Wayland portal presently reports `available=false`; the live display proof remains **OPEN**. The direct shell restriction was not bypassed.

**Safe update and rollback** (QA preview only; no automatic migration):
- The **newer installer file** accepts `--upgrade --mode standard|full --target TARGET` only for an existing single managed preview root. It refuses active/stale backend-control records, any occupied configured profile ports, unexpected files/aliases, and an implicit power-mode change. It preserves every profile's JSON bytes and the private `state` folder, stages a complete new app beside the current root, and performs a guarded rename cutover. The old installation remains under a content-addressed `.rollback-` sibling as a recoverable backup.
- The newly installed CLI accepts `--rollback --target TARGET`, returning the exact old managed installation if its preserved identity matches. It retains the newer candidate under a `.failed-` sibling for audit; no program is deleted or killed. **Backups/failed candidates are temporary recovery copies, not active installations; cleanup requires a separately verified retention decision.**
- If the older installation is an unmanaged legacy dev23 root, the installer **refuses** rather than trying to infer how to migrate it. Upgrade/rollback is therefore limited to controlled preview-to-preview transitions, **not** six-host fleet deployment.

Windows PowerShell example, with a fresh **test** TARGET and the new R41 file in `$setup`:

```powershell
& $setup --upgrade --mode standard --target $target
& "$target\Commander.exe" --runtime-status --target $target --profile default
& "$target\Commander.exe" --rollback --target $target
```

Linux example using the matching R41 `.run`:

```bash
"$setup" --upgrade --mode standard --target "$target"
"$target/bin/node" "$target/Commander.cjs" --runtime-status --target "$target" --profile default
"$target/bin/node" "$target/Commander.cjs" --rollback --target "$target"
```

**Actual R41 build acceptance:** in each OS and for both Standard and Full Power, Builder executes the real one-file installer, verifies unchanged 60-tool dev23 MCP schema plus four Gap tools, real two-profile detached start/status/stop with occupied port and tampered-control-token refusals, and a complete R39→R41 upgrade/rollback on an isolated owner-local test root with data and both profiles preserved. Only then is a final artifact published atomically. Windows and Linux each returned `upgradeRollbackPass=true` in both modes. SHA256 provides **integrity checking**, not a publisher signature or supply-chain attestation. Public signing, uninstall/autostart, real Windows GUI-click acceptance, Linux Portal authorization, full desktop chat/browser/action UI, and the owner-approved six-host migration remain **OPEN**.


## R43 — owner-local autostart source QA (not a published installer)

R43 adds explicit `--autostart-status`, `--autostart-enable` and `--autostart-disable` to the current **source** `installer-core.cjs`. It is opt-in for one exact managed `--target ROOT --profile NAME`, never enabled by `--install` or migration. Windows uses a uniquely named HKCU Run entry and private hidden-launch script; Linux uses a unique XDG user autostart `.desktop` entry. Unknown, modified or partial existing startup registrations fail closed. Upgrade, rollback, uninstall and restore refuse to proceed while an autostart registration for any installed profile is enabled or inconsistent; disable and reconcile first. No elevation or system-wide startup changes are involved.

Two live-host clean-room runs on separate disposable **R42 installations** tested source-level actions against two logical profiles, idempotence, per-profile isolation, uninstall refusal, disable, and reversible uninstall/restore: Windows `f0ff5363-28d0-40b3-9760-fa68ae453d13` PASS, Linux `2f7ee425-5240-4f93-ade7-99a6f1de09dc` PASS. The exact tested source SHA256 is `15fe94a7b7c91256366b46227a592b90f12445a32944f3d9f278c9c7c62a7546`; test `smoke-autostart.py` SHA256 `e4c172245af7a239d5fdeabf4f10b075630de26447d9b12e0e153a7c2092eee5`. They did not perform an actual OS login event. **R43 is now packaged and tested as the two unsigned QA files listed above, not as a signed or public installer.** The R42 binaries remain unchanged. The Release Builder was run from a pinned QA snapshot; canonical build.py is concurrently dirty and awaits a conflict-safe merge of the R43 gate. Preserve concurrent V1 worktree changes. The canonical Builder now gates both packaged Autostart controls and real native launcher handoff in both Standard/Full Power, with exact receipts under R44 above. Actual OS login and owner GUI canaries remain to be accepted.
