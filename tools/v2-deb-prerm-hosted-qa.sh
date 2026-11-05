#!/usr/bin/env bash
# Build only a disposable DEB control-script candidate from exact public DEB.
# No public release, no mutation to actual owner machines.
set -euo pipefail
if [[ "$(printenv GITHUB_ACTIONS 2>/dev/null || true)" != true ||
      "$(printenv RUNNER_ENVIRONMENT 2>/dev/null || true)" != github-hosted ||
      "$(printenv GITHUB_REPOSITORY 2>/dev/null || true)" != GOD13emad/ChatGPTRemoteCommander ||
      "$(printenv RUNNER_OS 2>/dev/null || true)" != Linux ||
      "$(id -u)" == 0 ]];then
 echo V2_PRERM_CANDIDATE_HOSTED_ONLY_DENY >&2;exit 42
fi
if dpkg-query -W commander-v2 >/dev/null 2>&1 || test -e '/opt/Commander V2'; then
 echo V2_PRERM_DIRTY_RUNNER_DENY >&2;exit 43
fi
source='tools/v2-deb-alternatives-prerm.sh'
test -f "$source"
sh -n "$source"
work="$(mktemp -d "$RUNNER_TEMP/v2-prerm-candidate-qa-XXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
url='https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/download/commander-v2.1.50-unsigned-qa.readonlyfix.20261105/Commander-V2-Linux-x64.deb'
curl -fLsS --retry 2 --connect-timeout 20 --max-time 300 "$url" -o "$work/published.deb"
printf '%s  %s\n' e16d14114b877c7389b05f97215b95077aafd854803292fcb689c0f04c98df12 "$work/published.deb" | sha256sum -c --status
dpkg-deb -R "$work/published.deb" "$work/unpacked"
test ! -e "$work/unpacked/DEBIAN/prerm"
install -m 0755 "$source" "$work/unpacked/DEBIAN/prerm"
# dpkg-deb --raw-extract may create private DEBIAN 0700; the control
# directory must be 0755..0775 for building a Debian package.
chmod 0755 "$work/unpacked/DEBIAN"
test "$(stat -c '%a' "$work/unpacked/DEBIAN")" = 755
dpkg-deb --build --root-owner-group "$work/unpacked" "$work/candidate.deb"
test "$(dpkg-deb --field "$work/candidate.deb" Package)" = commander-v2
test "$(dpkg-deb --field "$work/candidate.deb" Version)" = 2.1.50
test "$(dpkg-deb --field "$work/candidate.deb" Architecture)" = amd64
test "$(dpkg-deb --ctrl-tarfile "$work/candidate.deb" | tar -xOf - ./prerm | sha256sum | cut -d' ' -f1)" = "$(sha256sum "$source"|cut -d' ' -f1)"
echo V2_PRERM_DISPOSABLE_CONTROL_REPACK_PASS
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "$work/candidate.deb"
test -x '/opt/Commander V2/commander-v2'
test "$(sha256sum '/opt/Commander V2/resources/commander-v2-workspace/MANIFEST.json'|cut -d' ' -f1)" = 1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64
echo V2_PRERM_DISPOSABLE_PACKAGE_INSTALL_PASS
sudo env DEBIAN_FRONTEND=noninteractive apt-get purge -y commander-v2 >"$work/purge.log" 2>&1
if grep -E 'warning: alternative .*doesn.t exist|warning: .etc.alternatives.commander-v2 is dangling' "$work/purge.log";then
 echo V2_PRERM_DANGLING_ALTERNATIVES_STILL_WARN >&2;exit 45
fi
if dpkg-query -W commander-v2 >/dev/null 2>&1;then
 echo V2_PRERM_REGISTRATION_REMAINS >&2;exit 46
fi
test ! -e '/opt/Commander V2/commander-v2'
test ! -e /etc/apparmor.d/commander-v2
test ! -e /usr/bin/commander-v2
echo V2_PRERM_DISPOSABLE_INSTALL_PURGE_NO_ALTERNATIVES_WARNING_PASS
