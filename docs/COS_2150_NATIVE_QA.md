# CoS 2.1.50 native installer QA — 2026-11-04

**Status: SCOPED_SOURCE_BUILD_AND_PACKAGE_QA_PASS, NOT production FINAL.** This is an evidence appendix to the existing Commander V2 project Brain, not a replacement Index, Brain, state, or roadmap.

## Source and isolation

Upstream: `totec448-spec/chat-on-steroids` **tag `v2.1.50`, commit `11f7e92db9be74701c8b9c0f890280b206814846`**. Materialized via filtered Git sparse checkout, not a truncated GitHub tarball, and independently confirmed `package.json.version=2.1.50`.

- MMZ Linux QA-only source: `~/.local/state/CommanderV2/QA/cos-sparse-tag-v2.1.50-20261104/`.
- Emad Windows QA-only source: `%LOCALAPPDATA%\CommanderV2\QA\official-cos-tag2150-sparse-20261104\`.
- No owner source repository, V1 installation, browser profile, or active ChatGPT session was edited. Git working-tree changes in the QA source are intentionally **isolated build overlays**; do **not** claim a pristine-tag binary or silently commit the changes to upstream.

In both OS builds, production dependency `sharp: 0.35.4` was replaced by the same-source-staged, exact version `sharp: npm:@janhapke/sharp-electron@0.35.4-electron.1` and `overrides.sharp: "$sharp"`, with npm lockfile updated and dependency checked. This addresses the **reproduced** unpatched Linux Electron 44 `SIGSEGV` (exit 139) on a 2×2 PNG; the exact replacement generated a 95-byte PNG in a real Electron subprocess without the crash. Changing `package.json` alone without re-solving `package-lock.json` is invalid.

Reproduction prerequisites: check out exact commit, stage via existing `tools/stage-v2-cos-afterpack.mjs` with the disposable-source marker `.commander-v2-isolated-qa` (Linux stage already applied; existing macOS hook preserved), use `npm pkg set 'dependencies.sharp=npm:@janhapke/sharp-electron@0.35.4-electron.1' 'overrides.sharp=$sharp'` and `npm install --ignore-scripts`, materialize exactly matching Electron `44.3.0`, then `npm run typecheck`, `npm run build`, `node scripts/package.mjs --platform linux --arch x64` or `--platform win32 --arch x64`. Both platform builds independently verified pinned tunnel-client v0.0.19, ripgrep 15.2.0 and target-native dependencies. Linux build had to materialize official upstream `docs/licenses`, `docs/release-notes`, `artwork`, and `.github` sparse paths; failing to materialize them caused **test fixture missing-file errors**, not an accepted app regression. Linux DEB icon files needed 0644 permissions before invoking `electron-builder`; execute final package assembly with `umask 022`, and verify the archive has no unreadable entries. All QA-only artifacts stayed under their respective local QA directories.

## Verified Linux x64 deliverables

From patched official tag, Native Electron `44.3.0`:

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `release/Chat-On-Steroids-Linux-x64.deb` | 164,384,524 | `5e8f204094f18a94f2e1504e47123b232a71b69d6c7aa3148feabfad0c12f5c9` |
| `release/Chat-On-Steroids-Linux-x64.AppImage` | 191,718,362 | `cb5f1350b1ce8044acd1cdda9a67c1d0f95eeacb4ab7c95bd683e8a71d4ce3b9` |

Package metadata: `chat-on-steroids`, `2.1.50`, `amd64`. `dpkg-deb -c` verified **0 owner-only `0600` files / 0 inaccessible `0700` directories**. Independently `dpkg-deb -x` to a QA-owned path: extracted `app.asar` byte-equal to original build, actual extracted Electron/Node `smoke-packaged-runtime.mjs` **PASS**: MCP modules, Sharp/libvips PNG=95 bytes, PTY, tree-sitter parse, packaged tunnel/ripgrep, runtime version 2.1.50. Isolated `Xvfb` with temporary HOME/config/cache observed an actual visible CoS `BrowserWindow`; V1 and real owner desktop were not touched. Test performed with QA-only `--no-sandbox`; this is not a production sandbox acceptance. No global `dpkg`/APT install or Linux package signature.

Five upstream critical test suites: `test/packaging.test.ts`, `test/mcp.test.ts`, `test/bridge.test.ts`, `test/mcp-tool-declarations.test.ts`, `test/bridge-port-lifecycle.test.ts`. **1036 total / 1019 PASS / 0 FAIL / 17 SKIP**, log `/tmp/v2-cos2150-vendor-critical-suites-with-fixtures-20261104.log`, SHA256 `ee4297be9fe2be498551f7cd90476d8646df0b2190387cdd7ec6dfec17e47501`. Earlier 12 failures in `test/packaging.test.ts` were caused by missing `.github/workflows` and `docs/release-notes` sparse-checkout fixtures; they were not masked or marked PASS. An older attempt at the full 481-file suite did not complete and emitted mock DOM `NodeFilter`/`CSS` errors; it is NOT a full-suite PASS claim.

## Verified Windows x64 deliverable

Host: Emad's Windows account, isolated official tag checkout (not the main owner source repository). Node `26.7.0` and npm `12.2.1`; `npm run typecheck` **PASS**, `npm run build` **PASS**; `node scripts/package.mjs --platform win32 --arch x64` **exit 0** and native packaged-runtime smoke **PASS**. Reused independently hash-matched same-version Electron 44.3.0 cached runtime and pinned binary caches from the pre-existing separate QA source; no private keys copied.

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `release/Chat-On-Steroids-Setup-x64.exe` | 184,158,993 | `5040a6b5790534d14ab65397c8ff5b688cf5f9c4c94ba353e42551cc17ffd1ee` |

NSIS archive independently integrity-checked via a QA-isolated copy of `7z-x64.exe` and matching `7z-x64.dll` from the installed build dependency. 7-Zip reported **`NSIS-3 Unicode`, `Everything is Ok`**, 11 archive files. `Get-AuthenticodeSignature` reported **`NotSigned`**, and VersionInfo reported **2.1.50**. Windows GUI was **not** launched on a live owner desktop and installer was **not** executed into an installed profile. Owner Remote Commander repo has numerous pre-existing changes; no reset, commit, install, or checkout action was performed against it.

## Explicit remaining production acceptance

- This is the **CoS upstream-based native standalone app**, not yet a single integrated CoS + Commander V1/V2 + R18 + enrolled ChatGPT Worker distribution. The V2 Workspace R18 remains separately owner-local QA-installed on four desktops; two HPCs remain compute-only.
- G11 has scoped verified **BUILD + NATIVE RUNTIME + archive QA on Linux/Windows** but **external publisher signing, clean install/upgrade tests, real GUI acceptance on Windows, and integrated distribution are OPEN**. Do not label these unsigned packages as official vendor-published binaries; no upstream releases or public channels were modified.
- G3 ChatGPT per-conversation OAuth/principal/grant and G4 true production Worker effect remain OPEN; previous dual-HPC signed task is bounded owner-authorized QA with `productionV2=false`. G6 consented owner browser session, G12 production fleet acceptance, G13 FINAL remain OPEN.
- Do not change active V1, owner worktrees, existing authenticated browser sessions, private keys or active installed CoS app while verifying this QA build.
