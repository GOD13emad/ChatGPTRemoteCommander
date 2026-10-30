#!/usr/bin/env bash
# Reproducible user-local geckodriver adapter. No sudo, no browser profile reuse.
set -euo pipefail
umask 077
VERSION='0.37.1'
ARCHIVE="geckodriver-v$VERSION-linux64.tar.gz"
EXPECTED_ARCHIVE_SHA='e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e'
EXPECTED_BINARY_SHA='f831b7e61454804e8a307edd951bf8a5f373efe3f718e75454a6485a51f6e39f'
URL="https://github.com/mozilla/geckodriver/releases/download/v$VERSION/$ARCHIVE"
ACTION='--plan-only'
ARCHIVE_SOURCE=''
if [ "$#" -ne 0 ]; then ACTION="$1"; fi
if [ "$#" -eq 3 ]; then
 [ "$ACTION" = '--install' ] && [ "$2" = '--archive-file' ] && [ -n "$3" ] ||
  { echo GECKODRIVER_USAGE >&2; exit 2; }
 ARCHIVE_SOURCE="$3"
elif [ "$#" -gt 1 ]; then echo GECKODRIVER_USAGE >&2; exit 2; fi
[ "$ACTION" = '--plan-only' ] || [ "$ACTION" = '--install' ] ||
 { echo GECKODRIVER_USAGE >&2; exit 2; }
printf 'GECKODRIVER_PLAN version=%s arch=linux-x86_64 action=%s sudo=false\n' "$VERSION" "$ACTION"
[ "$ACTION" = '--install' ] || exit 0
[ "$(uname -m)" = 'x86_64' ] || { echo GECKODRIVER_ARCH_UNSUPPORTED >&2; exit 2; }
for program in tar sha256sum mktemp stat install; do
 command -v "$program" >/dev/null || { echo GECKODRIVER_PREREQUISITE_MISSING >&2; exit 2; }
done
PARENT="$HOME/.local/share/chatgpt-remote-commander/adapters"
TARGET="$PARENT/geckodriver"
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
 [ -d "$TARGET" ] && [ ! -L "$TARGET" ] &&
 [ -f "$TARGET/geckodriver" ] && [ ! -L "$TARGET/geckodriver" ] &&
 [ "$(sha256sum "$TARGET/geckodriver" | cut -d' ' -f1)" = "$EXPECTED_BINARY_SHA" ] &&
 [ -f "$TARGET/manifest.json" ] && [ ! -L "$TARGET/manifest.json" ] &&
 grep -Fq "\"version\":\"$VERSION\"" "$TARGET/manifest.json" ||
 { echo GECKODRIVER_EXISTING_ADAPTER_UNVERIFIED >&2; exit 3; }
 echo GECKODRIVER_ALREADY_VERIFIED
 exit 0
fi
[ -d "$PARENT" ] || mkdir -p -m 700 "$PARENT"
[ -d "$PARENT" ] && [ ! -L "$PARENT" ] && [ "$(stat -c %U "$PARENT")" = "$(id -un)" ] ||
 { echo GECKODRIVER_ADAPTER_PARENT_UNVERIFIED >&2; exit 3; }
STAGE="$(mktemp -d "$PARENT/.geckodriver-stage.XXXXXXXX")"
trap 'rm -rf -- "$STAGE"' EXIT
if [ -n "$ARCHIVE_SOURCE" ]; then
 [ -f "$ARCHIVE_SOURCE" ] && [ ! -L "$ARCHIVE_SOURCE" ] || { echo GECKODRIVER_ARCHIVE_INVALID >&2; exit 4; }
 cp -- "$ARCHIVE_SOURCE" "$STAGE/$ARCHIVE"
else
 command -v curl >/dev/null || { echo GECKODRIVER_CURL_REQUIRED >&2; exit 2; }
 curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --tlsv1.2 --connect-timeout 15 --max-time 120 -o "$STAGE/$ARCHIVE" "$URL"
fi
echo "$EXPECTED_ARCHIVE_SHA  $STAGE/$ARCHIVE" | sha256sum -c - >/dev/null ||
 { echo GECKODRIVER_ARCHIVE_HASH_MISMATCH >&2; exit 4; }
[ "$(tar -tzf "$STAGE/$ARCHIVE")" = 'geckodriver' ] ||
 { echo GECKODRIVER_ARCHIVE_UNEXPECTED_MEMBERS >&2; exit 4; }
tar -xOzf "$STAGE/$ARCHIVE" geckodriver >"$STAGE/geckodriver"
chmod 700 "$STAGE/geckodriver"
[ "$(sha256sum "$STAGE/geckodriver" | cut -d' ' -f1)" = "$EXPECTED_BINARY_SHA" ] ||
 { echo GECKODRIVER_BINARY_HASH_MISMATCH >&2; exit 4; }
cat >"$STAGE/manifest.json" <<EOF
{"schema":1,"version":"$VERSION","source":"$URL","archiveSha256":"$EXPECTED_ARCHIVE_SHA","binarySha256":"$EXPECTED_BINARY_SHA","platform":"linux-x86_64"}
EOF
chmod 600 "$STAGE/manifest.json"
rm -- "$STAGE/$ARCHIVE"
mv -T -n -- "$STAGE" "$TARGET"
[ -f "$TARGET/geckodriver" ] &&
[ "$(sha256sum "$TARGET/geckodriver" | cut -d' ' -f1)" = "$EXPECTED_BINARY_SHA" ] ||
 { echo GECKODRIVER_PROMOTION_UNVERIFIED >&2; exit 5; }
echo "GECKODRIVER_USERLOCAL_INSTALLED version=$VERSION verified=true sudo=false"
