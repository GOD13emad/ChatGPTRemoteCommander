#!/usr/bin/env bash
# Portable QA runner using the upstream AppImage extract-and-run option.
# No root, no FUSE mount and no changes to Commander V1 or existing browser profiles.
set -euo pipefail
base="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
app="$base/Chat-On-Steroids-Linux-x64.AppImage"
test -f "$app" && test ! -L "$app" || { echo QA_APPIMAGE_NOT_TRUSTED >&2; exit 3; }
expected="4ab56321d1efb3abdc4dbd12dbd885365038e3c18c3ba8413b5c1886b3ec51fc"
actual="$(sha256sum "$app" | cut -d' ' -f1)"
test "$actual" = "$expected" || { echo QA_APPIMAGE_SHA256_MISMATCH >&2; exit 3; }
state="$HOME/.local/state/CommanderV2-CoS-R18-QA-20261104"
for item in "$HOME/.local" "$HOME/.local/state" "$state" "$state/config" "$state/data" "$state/cache"; do
  if test -L "$item"; then echo QA_PROFILE_SYMLINK_REFUSED >&2; exit 3; fi
done
umask 077
mkdir -p -m 700 "$state/config" "$state/data" "$state/cache"
export XDG_CONFIG_HOME="$state/config" XDG_DATA_HOME="$state/data" XDG_CACHE_HOME="$state/cache"
export APPIMAGE_EXTRACT_AND_RUN=1 TMPDIR=/tmp
exec "$app" "$@"
