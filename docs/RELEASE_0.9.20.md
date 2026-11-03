# ChatGPT Remote Commander v0.9.20

Date: 2026-09-28

## Objective

Close the last fresh-server qualification gap found by a disposable-server audit of the published v0.9.19 installers.

Runtime policy, Skill routing, authorization, GUI behavior, durable workflows, browser behavior, and external Extension architecture are unchanged from v0.9.19 except for the version identifier.

## Failure evidence

A disposable GitHub-hosted canary tested the immutable v0.9.19 server assets rather than a developer checkout.

### Windows Server

The Windows Server 2022 hosted runner was elevated. Node.js and Git were deliberately removed from PATH before invoking the published `server-install-windows.ps1`.

Result: **PASS**.

Evidence included:

- Node.js 22.23.3 downloaded and verified;
- Git for Windows downloaded and verified;
- exact release commit `e04cff5a4985f905afe08a6b4a791baadc54bc46` installed;
- `SERVER_INSTALL_WINDOWS_PASS`;
- allowlist evidence written under ProgramData;
- no reboot required by prerequisites;
- no antivirus exclusions added;
- final marker `WINDOWS_DISPOSABLE_SERVER_CANARY_PASS`.

### Linux clean server

The published `server-install-linux.sh` was executed as root inside a clean Ubuntu 24.04 container.

The bootstrap successfully installed its declared OS packages, fetched the exact v0.9.19 commit, installed portable Node 22.23.3, and installed the pinned tunnel client. Qualification then failed in `test/installer-check.mjs`:

`Error: python3 is required for the Linux GUI helper`

This is a real prerequisite omission: the installer qualification contract requires Python 3 even when GUI capabilities are disabled and the server is installed with `--no-start`, but the fresh Linux bootstrap did not install or require Python 3.

## Root Cause -> Prevention -> Guard

**Root cause 1:** fresh-Linux prerequisite lists omitted Python 3 although release qualification invokes the Python parser for the Linux GUI helper.

**Prevention 1:** Linux prerequisite installation now installs Python 3 on supported package-manager families, and the prequalification required-command gate explicitly requires `python3`.

**Root cause 2 found by the first v0.9.20 canary:** after Python was present, headless-server qualification still executed the native GNOME helper self-test and therefore required PyGObject/`gi` even though all GUI capabilities were explicitly disabled.

**Prevention 2:** headless server validation keeps static/schema/source GUI checks but skips only the native GNOME integration probe. Normal Linux CI and `--enable-gui` validation continue to execute the full native probe.

**Static guard:** installer contract tests require Python 3 in both `install.sh` and `server-install-linux.sh`.

**System guard:** a permanent `Server Install Canary` workflow runs when installer/package/canary files change. It tests:

- Windows Server 2022 with Node/Git removed from PATH;
- clean Ubuntu 24.04 in a disposable container.

The canaries use the exact pull-request head ref/SHA and do not mutate production targets.

## Scope

No Defender, EDR, AppLocker, WDAC, firewall, or other security control is disabled. The Windows bootstrap remains allowlist/hash/signature based and does not add antivirus exclusions.

Domain Agent Extensions remain separately installed under the external Extension root and are not bundled with Commander.

## Acceptance gates

1. focused installer/onboarding/release-asset checks;
2. permanent Windows/Linux disposable server canary on the exact candidate SHA;
3. full Windows exact-SHA check/test/audit;
4. clean Linux exact-SHA check/test/audit plus release-asset build;
5. hosted Windows/Ubuntu CI;
6. immutable release publication and published-byte checksum verification;
7. candidate-first rollout and live version/route checks.

FINAL remains UNPROVEN until all gates complete.


## Post-release closure

The immutable v0.9.20 release was subsequently accepted after all listed gates completed. Final evidence is recorded in `PROJECT_CONTROL_STATE.md`, `PROJECT_BRAIN.md`, and evidence record `E-REL-20260928-R10`.

This section is a main-branch documentation update only; it does not alter the immutable v0.9.20 release bytes or tag.
