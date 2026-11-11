#!/usr/bin/env bash
# Disposable hosted Linux runner only. Exercises actual same-name Debian upgrade,
# native tunnel persistence, sandboxed GUI and downgrade rollback.
set -euo pipefail
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
OLD="$ROOT/dist/installer/Remote-Commander-Linux-amd64.deb"
NEW="$ROOT/dist/unified/Remote-Commander-Unified-0.12.0-dev.1-Linux-amd64.deb"
test -f "$OLD" && test -f "$NEW"
test "$(dpkg-deb --field "$OLD" Package)" = chatgpt-remote-commander
test "$(dpkg-deb --field "$NEW" Package)" = chatgpt-remote-commander
dpkg --compare-versions "$(dpkg-deb --field "$NEW" Version)" gt "$(dpkg-deb --field "$OLD" Version)"
if dpkg-query -W -f='${Status}' chatgpt-remote-commander 2>/dev/null | grep -q 'install ok installed'; then
  echo RC012_HOSTED_RUNNER_ALREADY_HAS_COMMANDER; exit 3
fi
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends xvfb xauth "./${OLD#"$ROOT/"}" 2>/dev/null || {
  # Relative paths below must be evaluated in the repository root.
  echo RC012_NATIVE_OLD_INSTALL_FAILED >&2; exit 4;
}
NATIVE=/usr/lib/chatgpt-remote-commander
for rel in runtime/node tunnel/native-tunnel-launch.sh tunnel/tunnel-client tunnel/cloudflared; do
  test -s "$NATIVE/$rel"
done
test -f /usr/lib/systemd/user/chatgpt-remote-commander-tunnel@.service
test ! -e '/opt/Remote Commander/remote-commander-unified'
TMP="$(mktemp -d /tmp/rc012-native-upgrade-XXXXXX)"
trap 'rm -rf -- "$TMP"' EXIT
for rel in runtime/node tunnel/native-tunnel-launch.sh tunnel/tunnel-client tunnel/cloudflared; do
  sha256sum "$NATIVE/$rel" | sed "s|$NATIVE/|$TMP/|" >> "$TMP/pre-upgrade-sha256.txt"
done
sudo apt-get install -y -qq --no-install-recommends "$NEW"
test "$(dpkg-query -W -f='${Status}' chatgpt-remote-commander)" = 'install ok installed'
test "$(dpkg-query -W -f='${Version}' chatgpt-remote-commander)" = "$(dpkg-deb --field "$NEW" Version)"
for rel in runtime/node tunnel/native-tunnel-launch.sh tunnel/tunnel-client tunnel/cloudflared; do
  actual="$(sha256sum "$NATIVE/$rel" | cut -d' ' -f1)"
  expected="$(grep -F " $TMP/$rel" "$TMP/pre-upgrade-sha256.txt" | cut -d' ' -f1)"
  test "$actual" = "$expected"
done
test -f /usr/lib/systemd/user/chatgpt-remote-commander-tunnel@.service
test -x '/opt/Remote Commander/remote-commander-unified'
test "$(stat -c %u '/opt/Remote Commander/chrome-sandbox')" -eq 0
cd "$ROOT"
xvfb-run -a env RC_TEST_INSTALLED_GUI=1 node --test test/unified-electron-gui.test.mjs
sudo apt-get install -y -qq --allow-downgrades --no-install-recommends "$OLD"
test "$(dpkg-query -W -f='${Version}' chatgpt-remote-commander)" = "$(dpkg-deb --field "$OLD" Version)"
test -f "$NATIVE/tunnel/native-tunnel-launch.sh"
test ! -e '/opt/Remote Commander/remote-commander-unified'
echo 'RC012_NATIVE_UPGRADE_SANDBOX_GUI_AND_ROLLBACK_PASS'
