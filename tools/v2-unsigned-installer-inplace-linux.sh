#!/usr/bin/env bash
# Disposable GitHub-hosted Ubuntu only: previous QA -> ReadonlyFix -> previous QA.
set -euo pipefail
if [[ "$(printenv GITHUB_ACTIONS 2>/dev/null || true)" != true ||
      "$(printenv RUNNER_ENVIRONMENT 2>/dev/null || true)" != github-hosted ||
      "$(printenv GITHUB_REPOSITORY 2>/dev/null || true)" != GOD13emad/ChatGPTRemoteCommander ||
      "$(printenv RUNNER_OS 2>/dev/null || true)" != Linux ||
      "$(id -u)" == 0 ]]; then
 echo V2_LINUX_REPLACE_NOT_HOSTED_DENY >&2;exit 42
fi
if dpkg-query -W commander-v2 >/dev/null 2>&1 || test -e '/opt/Commander V2'; then
 echo V2_LINUX_REPLACE_DIRTY_RUNNER_DENY >&2;exit 43
fi
oldsha=93d3e3632b13d4bda26f02d76a2108a514829900335a3e27ac135b021fc09995
newsha=e16d14114b877c7389b05f97215b95077aafd854803292fcb689c0f04c98df12
base='https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/download'
work="$(mktemp -d "$RUNNER_TEMP/commander-v2-replace-qa-XXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
curl -fLsS --retry 2 --connect-timeout 20 --max-time 300 \
 "$base/commander-v2.1.50-unsigned-qa.20261105/Commander-V2-Linux-x64.deb" -o "$work/old.deb"
curl -fLsS --retry 2 --connect-timeout 20 --max-time 300 \
 "$base/commander-v2.1.50-unsigned-qa.readonlyfix.20261105/Commander-V2-Linux-x64.deb" -o "$work/new.deb"
printf '%s  %s\n%s  %s\n' "$oldsha" "$work/old.deb" "$newsha" "$work/new.deb" |
 sha256sum --check --status
for file in "$work/old.deb" "$work/new.deb";do
 test "$(dpkg-deb --field "$file" Package)" = commander-v2
 test "$(dpkg-deb --field "$file" Version)" = 2.1.50
 test "$(dpkg-deb --field "$file" Architecture)" = amd64
done
echo V2_REPLACE_LINUX_BOTH_RELEASES_SHA_PASS
manifest='/opt/Commander V2/resources/commander-v2-workspace/MANIFEST.json'
checkinstalled(){
 dpkg-query -W commander-v2 |grep -F 'commander-v2'|grep -F '2.1.50' >/dev/null
 test -x '/opt/Commander V2/commander-v2'
 test -f "$manifest"
}
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "$work/old.deb"
checkinstalled
oldmanifest="$(sha256sum "$manifest"|cut -d' ' -f1)"
echo V2_REPLACE_LINUX_OLD_PACKAGE_INSTALLED
# Only an artificial nonsecret fixture. No actual owner profile is inspected.
state="$HOME/.config/Commander V2"
test ! -e "$state" || { echo V2_REPLACE_LINUX_STATE_ALREADY_EXISTS >&2;exit 45; }
install -d -m 700 "$state"
marker="$state/qa-hosted-synthetic-state.txt"
printf '%s\n' 'V2_HOSTED_SYNTHETIC_STATE_PRESERVE' > "$marker"
markerSha="$(sha256sum "$marker"|cut -d' ' -f1)"
checkstate(){
 test "$(sha256sum "$marker"|cut -d' ' -f1)" = "$markerSha"
}
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --reinstall "$work/new.deb"
checkinstalled
newmanifest="$(sha256sum "$manifest"|cut -d' ' -f1)"
test "$newmanifest" = 1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64
test "$oldmanifest" != "$newmanifest"
checkstate
echo V2_REPLACE_LINUX_INPLACE_READONLYFIX_PASS
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --reinstall "$work/old.deb"
checkinstalled
test "$(sha256sum "$manifest"|cut -d' ' -f1)" = "$oldmanifest"
checkstate
echo V2_REPLACE_LINUX_DISPOSABLE_ROLLBACK_PASS
sudo env DEBIAN_FRONTEND=noninteractive apt-get purge -y commander-v2
if dpkg-query -W commander-v2 >/dev/null 2>&1; then
 echo V2_REPLACE_LINUX_PURGE_REGISTRATION_REMAINS >&2;exit 44
fi
test ! -e '/opt/Commander V2/commander-v2'
checkstate
echo V2_REPLACE_LINUX_SYNTHETIC_OWNER_STATE_PRESERVED_PASS
echo V2_REPLACE_LINUX_FINAL_PURGE_PASS
