#!/usr/bin/env bash
# Exact published Commander V2 DEB QA, only on disposable GitHub-hosted Linux.
set -euo pipefail
if [[ "$(printenv GITHUB_ACTIONS 2>/dev/null || true)" != true ||
      "$(printenv RUNNER_ENVIRONMENT 2>/dev/null || true)" != github-hosted ||
      "$(printenv GITHUB_REPOSITORY 2>/dev/null || true)" != GOD13emad/ChatGPTRemoteCommander ||
      "$(printenv RUNNER_OS 2>/dev/null || true)" != Linux ||
      "$(id -u)" == 0 ]];then
 echo V2_PUBLIC_PRERM_HOSTED_ONLY_DENY >&2;exit 42
fi
if dpkg-query -W commander-v2 >/dev/null 2>&1 ||
   test -e '/opt/Commander V2' ||
   test -e /usr/bin/commander-v2;then
 echo V2_PUBLIC_PRERM_EXISTING_INSTALL_DENY >&2;exit 43
fi
tag='commander-v2.1.50-unsigned-qa.debprermfix.20261105'
url="https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/download/$tag/Commander-V2-Linux-x64.deb"
expected='176682a41abb332e830b69f210a5e77f0c0561d526cae342094ed17b7d8ebc15'
work="$(mktemp -d "$RUNNER_TEMP/v2-public-prerm-qa-XXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
curl -fLsS --retry 2 --connect-timeout 20 --max-time 300 "$url" -o "$work/published.deb"
printf '%s  %s\n' "$expected" "$work/published.deb" |sha256sum -c --status
test "$(dpkg-deb --field "$work/published.deb" Package)" = commander-v2
test "$(dpkg-deb --field "$work/published.deb" Version)" = 2.1.50
test "$(dpkg-deb --field "$work/published.deb" Architecture)" = amd64
test "$(dpkg-deb --ctrl-tarfile "$work/published.deb" |tar -xOf - ./prerm|sha256sum|cut -d' ' -f1)" = a2fb497525e7383e82b2040c455caf04fe15adfcd13bdb86502a82332a7e3b82
echo V2_PUBLIC_NATIVE_PRERM_BINARY_AND_HOOK_SHA_PASS
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "$work/published.deb"
test -x '/opt/Commander V2/commander-v2'
test "$(sha256sum '/opt/Commander V2/resources/commander-v2-workspace/MANIFEST.json'|cut -d' ' -f1)" = 1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64
state="$HOME/.config/Commander V2"
test ! -e "$state" || { echo V2_PUBLIC_PRERM_PREEXISTING_STATE >&2;exit 44; }
install -d -m 700 "$state"
printf '%s\n' 'V2_PUBLIC_NATIVE_PRERM_SYNTHETIC_USER_DATA' >"$state/hosted-qa-marker.txt"
mark="$(sha256sum "$state/hosted-qa-marker.txt"|cut -d' ' -f1)"
echo V2_PUBLIC_NATIVE_PRERM_PACKAGE_INSTALLED_PASS
sudo env DEBIAN_FRONTEND=noninteractive apt-get purge -y commander-v2 >"$work/purge.log" 2>&1
if grep -E 'warning: alternative .*doesn.t exist|warning: .etc.alternatives.commander-v2 is dangling' "$work/purge.log";then
 echo V2_PUBLIC_NATIVE_PRERM_DANGLING_WARNING_REMAINS >&2;exit 45
fi
if dpkg-query -W commander-v2 >/dev/null 2>&1;then
 echo V2_PUBLIC_NATIVE_PRERM_REGISTRATION_REMAINS >&2;exit 46
fi
test ! -e '/opt/Commander V2/commander-v2'
test ! -e /etc/apparmor.d/commander-v2
test ! -e /usr/bin/commander-v2
if update-alternatives --query commander-v2 >/dev/null 2>&1;then
 echo V2_PUBLIC_NATIVE_PRERM_ALTERNATIVE_REMAINS >&2;exit 47
fi
test "$(sha256sum "$state/hosted-qa-marker.txt"|cut -d' ' -f1)" = "$mark"
echo V2_PUBLIC_NATIVE_PRERM_SYNTHETIC_USERDATA_PRESERVED_PASS
echo V2_PUBLIC_NATIVE_PRERM_INSTALL_PURGE_WARNING_FREE_PASS
