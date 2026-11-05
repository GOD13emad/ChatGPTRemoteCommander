#!/usr/bin/env bash
# Disposable GitHub-hosted Ubuntu only. Never run on a real owner system.
set -euo pipefail
sha='e16d14114b877c7389b05f97215b95077aafd854803292fcb689c0f04c98df12'
url='https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/download/commander-v2.1.50-unsigned-qa.readonlyfix.20261105/Commander-V2-Linux-x64.deb'
if [[ "$(printenv GITHUB_ACTIONS 2>/dev/null || true)" != true ||
      "$(printenv RUNNER_ENVIRONMENT 2>/dev/null || true)" != github-hosted ||
      "$(printenv GITHUB_REPOSITORY 2>/dev/null || true)" != GOD13emad/ChatGPTRemoteCommander ||
      "$(printenv RUNNER_OS 2>/dev/null || true)" != Linux || "$(id -u)" == 0 ]]; then
  echo V2_QA_HOSTED_LINUX_ONLY_DENY >&2; exit 42
fi
if dpkg-query -W commander-v2 >/dev/null 2>&1 || test -e '/opt/Commander V2' || test -e /usr/bin/commander-v2; then
 echo V2_QA_PREEXISTING_INSTALL_DENY >&2;exit 43
fi
work="$(mktemp -d "$RUNNER_TEMP/commander-v2-qa-XXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 300 "$url" --output "$work/installer.deb"
echo "$sha  $work/installer.deb" | sha256sum -c --status
test "$(dpkg-deb --field "$work/installer.deb" Package)" = commander-v2
test "$(dpkg-deb --field "$work/installer.deb" Version)" = 2.1.50
test "$(dpkg-deb --field "$work/installer.deb" Architecture)" = amd64
echo V2_LINUX_INSTALLER_SHA_PASS
# All OS mutations below are restricted to this fresh GitHub-hosted VM.
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "$work/installer.deb"
dpkg-query -W commander-v2 | grep -F '2.1.50'
test -x '/opt/Commander V2/commander-v2'
test "$(sha256sum '/opt/Commander V2/resources/commander-v2-workspace/MANIFEST.json' | cut -d' ' -f1)" = 1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64
test "$(sha256sum '/opt/Commander V2/resources/commander-v2-workspace/v1-runtime-bridge.mjs' | cut -d' ' -f1)" = 7a1f500ce3071bff685876db8acbadf4d11b165a05659f69599fc24177ea16cd
test -f '/opt/Commander V2/resources/commander-v1-core/MANIFEST.json'
echo V2_LINUX_PACKAGED_RESOURCES_PASS
sudo env DEBIAN_FRONTEND=noninteractive apt-get purge -y commander-v2
if dpkg-query -W commander-v2 >/dev/null 2>&1; then echo V2_LINUX_PURGE_REGISTRATION_REMAINS >&2;exit 44;fi
test ! -e '/opt/Commander V2/commander-v2'
test ! -e '/etc/apparmor.d/commander-v2'
echo V2_HOSTED_LINUX_INSTALL_PURGE_PASS
