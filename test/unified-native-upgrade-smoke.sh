#!/usr/bin/env bash
# Disposable hosted Linux runner only. Exercises actual same-name Debian upgrade,
# native tunnel persistence, sandboxed GUI and downgrade rollback.
# Historical input must be the independently attested, immutable prior DEB.
set -Eeuo pipefail
trap 'printf "RC012_NATIVE_UPGRADE_STEP_FAILED line=%s\\n" "$LINENO" >&2' ERR
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == Linux &&
   "${RUNNER_ENVIRONMENT:-}" == github-hosted &&
   "${CI:-}" == true && -n "${GITHUB_WORKSPACE:-}" && -n "${RUNNER_TEMP:-}" ]] || {
  echo 'RC012_NATIVE_UPGRADE_TEST_HOSTED_RUNNER_ONLY' >&2; exit 2;
}
[[ "$(id -u)" != 0 ]] || { echo RC012_NATIVE_UPGRADE_TEST_NONROOT_EXPECTED >&2; exit 2; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ "$ROOT" == "$(realpath "$GITHUB_WORKSPACE")" &&
   "$HOME" != "$GITHUB_WORKSPACE" &&
   ! -e "$HOME/.local/share/ChatGPTRemoteCommander" &&
   ! -e "$HOME/.local/share/chatgpt-remote-commander" ]] || {
  echo RC012_NATIVE_UPGRADE_TEST_OWNER_INSTALL_REFUSED >&2;exit 3;
}
cd "$ROOT"
OLD="$ROOT/dist/qa-historical/Remote-Commander-Unified-0.12.0-dev.12-Linux-amd64.deb"
OLD_SHA256=4a6cecd5eef2faca8d726dbf6ac3cd1d6118a4ba86518a3a63dc76e3ae79915e
command -v node >/dev/null || { echo RC012_SOURCE_VERSION_NODE_MISSING >&2; exit 3; }
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
GUI_VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/packaging/unified/package.json")"
[[ "$VERSION" =~ ^0\.12\.0-dev\.[1-9][0-9]*$ && "$VERSION" == "$GUI_VERSION" ]] || {
  echo RC012_NATIVE_UPGRADE_SOURCE_VERSION_MISMATCH >&2;exit 3;
}
NEW="$ROOT/dist/unified/Remote-Commander-Unified-${VERSION}-Linux-amd64.deb"
[[ -f "$OLD" && ! -L "$OLD" && -f "$NEW" && ! -L "$NEW" ]] || {
  echo RC012_NATIVE_UPGRADE_ARTIFACT_UNTRUSTED >&2; exit 3;
}
verify_old_digest(){
  printf '%s  %s\n' "$OLD_SHA256" "$OLD" | sha256sum -c --status || {
    echo RC012_HISTORICAL_DEB_DIGEST_MISMATCH >&2; exit 3;
  }
}
verify_old_digest
for artifact in "$OLD" "$NEW"; do
  test "$(dpkg-deb --field "$artifact" Package)" = chatgpt-remote-commander
  test "$(dpkg-deb --field "$artifact" Architecture)" = amd64
done
test "$(dpkg-deb --field "$OLD" Version)" = '0.12.0~dev.12'
test "$(dpkg-deb --field "$NEW" Version)" = "${VERSION/-dev./~dev.}"
dpkg --compare-versions "$(dpkg-deb --field "$NEW" Version)" gt "$(dpkg-deb --field "$OLD" Version)" || {
  echo RC012_NATIVE_UPGRADE_VERSION_ORDER_INVALID >&2; exit 3;
}
echo RC012_HISTORICAL_DEB_PIN_AND_ORDER_PASS
# Audit *actual* Native and merged DEB payload names BEFORE installing even on
# this disposable hosted runner. The public app payload is only the committed
# runtime Core, never the complete repository or human project/Skill records.
python3 - "$OLD" "$NEW" <<'PUBLIC_APP_BOUNDARY'
import subprocess, sys
prefix="./usr/lib/chatgpt-remote-commander/app/"
allowed_dirs={"src","tools","vendor","assets"}
allowed_files={"config.json","package.json","source-manifest.json","packaging/unified/owner-pinned-provenance.mjs","packaging/unified/migration-preflight.mjs","packaging/unified/package.json","packaging/unified/owner-dpapi-profile-recovery.ps1","packaging/unified/owner-systemd-creds-profile-recovery.sh"}
allowed_scaffolding={"packaging","packaging/unified"}
for pkg in sys.argv[1:]:
    listing=subprocess.check_output(["dpkg-deb","--contents",pkg],text=True)
    seen=set()
    for row in listing.splitlines():
        at=row.find(prefix)
        if at<0: continue
        relative=row[at+len(prefix):].split(" -> ",1)[0].strip().rstrip("/")
        if not relative: continue
        head=relative.split("/",1)[0]
        kind=row.lstrip()[:1]
        if relative in allowed_files and kind=="-":
            seen.add(relative)
            continue
        if relative in allowed_scaffolding and kind=="d":
            continue
        if head in allowed_dirs:
            seen.add(relative)
            continue
        raise SystemExit("RC012_PUBLIC_NATIVE_APP_PATH_DISALLOWED "+relative)
    required={"package.json","config.json","source-manifest.json","src/server-v0.3.mjs","packaging/unified/owner-pinned-provenance.mjs"}
    if pkg==sys.argv[-1]:
        required.update({"packaging/unified/migration-preflight.mjs","packaging/unified/package.json","packaging/unified/owner-dpapi-profile-recovery.ps1","packaging/unified/owner-systemd-creds-profile-recovery.sh"})
    if not required.issubset(seen):
        raise SystemExit("RC012_PUBLIC_NATIVE_APP_REQUIRED_FILE_MISSING")
print("RC012_PUBLIC_NATIVE_APP_ALLOWLIST_PASS")
PUBLIC_APP_BOUNDARY
if dpkg-query -W -f='${Status}' chatgpt-remote-commander 2>/dev/null | grep -q 'install ok installed'; then
  echo RC012_HOSTED_RUNNER_ALREADY_HAS_COMMANDER; exit 3
fi
command -v xvfb-run >/dev/null || { echo RC012_XVFB_PREFETCH_MISSING >&2; exit 4; }
dpkg-query -W -f='${Status}\n' libnotify4 libsecret-1-0 2>/dev/null | grep -c '^install ok installed$' | grep -qx 2 || { echo RC012_SIGNED_GUI_DEPENDENCIES_NOT_PREFETCHED >&2; exit 4; }
# Compare actual installed bytes against each distinct verified input. The old
# artifact is a complete unified package, so the old GUI must also be restored.
TMP="$(mktemp -d /tmp/rc012-native-upgrade-XXXXXX)"
trap 'rm -rf -- "$TMP"' EXIT
dpkg-deb -x "$OLD" "$TMP/old"
dpkg-deb -x "$NEW" "$TMP/new"
NATIVE=/usr/lib/chatgpt-remote-commander
verify_installed_package(){
  local artifact="$1" extracted="$2" rel expected actual
  test "$(dpkg-query -W -f='${Status}' chatgpt-remote-commander)" = 'install ok installed'
  test "$(dpkg-query -W -f='${Version}' chatgpt-remote-commander)" = "$(dpkg-deb --field "$artifact" Version)"
  for rel in \
    "$NATIVE/runtime/node" "$NATIVE/tunnel/native-tunnel-launch.sh" \
    "$NATIVE/tunnel/tunnel-client" "$NATIVE/tunnel/cloudflared" \
    "$NATIVE/app/source-manifest.json" "$NATIVE/app/package.json" \
    /usr/lib/systemd/user/chatgpt-remote-commander-tunnel@.service \
    '/opt/Remote Commander/remote-commander-unified' \
    '/opt/Remote Commander/chrome-sandbox' \
    '/opt/Remote Commander/resources/core/source-manifest.json'; do
    [[ -f "$extracted$rel" && ! -L "$extracted$rel" && -f "$rel" && ! -L "$rel" ]] || {
      echo "RC012_NATIVE_INSTALLED_ASSET_UNTRUSTED $rel" >&2; return 1;
    }
    expected="$(sha256sum "$extracted$rel" | cut -d' ' -f1)"
    actual="$(sha256sum "$rel" | cut -d' ' -f1)"
    test "$actual" = "$expected" || {
      echo "RC012_NATIVE_INSTALLED_BYTE_MISMATCH $rel" >&2; return 1;
    }
  done
  test -x '/opt/Remote Commander/remote-commander-unified'
  test "$(stat -c %u '/opt/Remote Commander/chrome-sandbox')" -eq 0
  test "$(stat -c %a '/opt/Remote Commander/chrome-sandbox')" = "$(stat -c %a "$extracted/opt/Remote Commander/chrome-sandbox")"
}
verify_old_digest
sudo dpkg --install "$OLD" || {
  echo RC012_NATIVE_OLD_INSTALL_FAILED >&2; exit 4;
}
verify_installed_package "$OLD" "$TMP/old"
echo RC012_HISTORICAL_UNIFIED_BASELINE_INSTALLED
sudo dpkg --install "$NEW"
verify_installed_package "$NEW" "$TMP/new"
xvfb-run -a env RC_TEST_INSTALLED_GUI=1 node --test test/unified-electron-gui.test.mjs
verify_old_digest
sudo dpkg --install "$OLD"
verify_installed_package "$OLD" "$TMP/old"
echo RC012_NATIVE_UPGRADE_SANDBOX_GUI_AND_ROLLBACK_PASS
