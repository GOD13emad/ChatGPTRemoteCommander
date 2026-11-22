#!/usr/bin/env bash
# Disposable GitHub Linux runner only. Use the actual pinned electron-builder
# GUI package as predecessor to test old postrm upgrade -> new postinst.
# This tests the historic GUI maintainer hooks that native-to-native CI misses.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == Linux &&
   "${RUNNER_ENVIRONMENT:-}" == github-hosted &&
   "${CI:-}" == true && -n "${GITHUB_WORKSPACE:-}" &&
   -n "${RUNNER_TEMP:-}" ]] || {
  echo RC012_ELECTRON_MAINTAINER_QA_HOSTED_ONLY >&2; exit 2;
}
[[ "$(id -u)" != 0 ]] || {
  echo RC012_ELECTRON_MAINTAINER_QA_USER_REQUIRED >&2; exit 2;
}
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ "$ROOT" == "$(realpath "$GITHUB_WORKSPACE")" ]] || exit 3
cd "$ROOT"
RAW="$RUNNER_TEMP/rc012-upstream-electron-gui.deb"
NEW=(dist/unified/*.deb)
OLD="$ROOT/dist/installer/Remote-Commander-Linux-amd64.deb"
[[ "${#NEW[@]}" -eq 1 && -f "$RAW" && -f "$OLD" ]] || exit 3
[[ "$(dpkg-deb -f "$RAW" Package)" == chatgpt-remote-commander &&
   "$(dpkg-deb -f "${NEW[0]}" Package)" == chatgpt-remote-commander &&
   "$(dpkg-deb -f "$RAW" Version)" == "$(dpkg-deb -f "${NEW[0]}" Version)" ]] || {
  echo RC012_LEGACY_GUI_PACKAGE_IDENTITY_MISMATCH >&2; exit 3;
}
[[ "$(dpkg-query -W -f='${Version}' chatgpt-remote-commander)" == "$(dpkg-deb -f "$OLD" Version)" ]] || {
  echo RC012_PREDECESSOR_NATIVE_FIXTURE_NOT_RESTORED >&2; exit 3;
}
TMP="$(mktemp -d "$RUNNER_TEMP/rc012-real-electron-upgrade-XXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT
for name in postinst postrm; do
  dpkg-deb --ctrl-tarfile "$RAW" | tar -xOf - "./$name" > "$TMP/gui-$name"
  dpkg-deb --ctrl-tarfile "${NEW[0]}" | tar -xOf - "./$name" > "$TMP/merged-$name"
  cmp -s "$TMP/gui-$name" "$TMP/merged-$name" || {
    echo RC012_MERGED_UPSTREAM_MAINTAINER_CONTENT_CHANGED >&2;exit 4;
  }
done
sudo dpkg --install "$RAW"
test -x '/opt/Remote Commander/remote-commander-unified'
update-alternatives --query remote-commander-unified |
  grep -Fqx 'Value: /opt/Remote Commander/remote-commander-unified'
if command -v apparmor_status >/dev/null && apparmor_status --enabled >/dev/null 2>&1; then
  test -f /etc/apparmor.d/remote-commander-unified
fi
# This calls old Electron postrm upgrade, followed by the merged package postinst.
sudo dpkg --install "${NEW[0]}"
test "$(dpkg-query -W -f='${Version}' chatgpt-remote-commander)" =   "$(dpkg-deb -f "${NEW[0]}" Version)"
update-alternatives --query remote-commander-unified |
  grep -Fqx 'Value: /opt/Remote Commander/remote-commander-unified'
if command -v apparmor_status >/dev/null && apparmor_status --enabled >/dev/null 2>&1; then
  test -f /etc/apparmor.d/remote-commander-unified
  cmp -s /etc/apparmor.d/remote-commander-unified     '/opt/Remote Commander/resources/apparmor-profile'
fi
test -s /usr/lib/chatgpt-remote-commander/runtime/node
test -f /usr/lib/systemd/user/chatgpt-remote-commander@.service
xvfb-run -a env RC_TEST_INSTALLED_GUI=1 node --test test/unified-electron-gui.test.mjs
sudo dpkg --install "$OLD"
test "$(dpkg-query -W -f='${Version}' chatgpt-remote-commander)" =   "$(dpkg-deb -f "$OLD" Version)"
test ! -e '/opt/Remote Commander/remote-commander-unified'
test -f /usr/lib/systemd/user/chatgpt-remote-commander-tunnel@.service
echo RC012_LEGACY_GUI_TO_NATIVE_DEB_MAINTAINER_AND_ROLLBACK_PASS
