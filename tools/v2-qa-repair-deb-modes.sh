#!/usr/bin/env bash
# QA-only corrective rebuild of an already pinned upstream Electron DEB.
# Does not install, sign, publish, or touch existing Core V1 / system services.
set -euo pipefail
if [[ $# != 3 ]]; then echo 'USAGE: script ORIGINAL_DEB SHA256 OUTPUT_DEB' >&2; exit 2; fi
source_deb=$1
source_hash=$2
output_deb=$3
[[ -f $source_deb && ! -L $source_deb ]] || { echo SOURCE_INVALID >&2; exit 2; }
[[ $source_hash =~ ^[a-f0-9]{64}$ ]] || { echo HASH_INVALID >&2; exit 2; }
[[ ! -e $output_deb && ! -L $output_deb ]] || { echo OUTPUT_EXISTS >&2; exit 3; }
output_parent=$(dirname -- "$output_deb")
[[ -d $output_parent && ! -L $output_parent ]] || { echo OUTPUT_PARENT_INVALID >&2; exit 2; }
actual=$(sha256sum -- "$source_deb" | cut -d' ' -f1)
[[ $actual == "$source_hash" ]] || { echo SOURCE_SHA_MISMATCH >&2; exit 2; }
dpkg-deb --field "$source_deb" Package Version Architecture | grep -qx 'Package: commander-v2-workspace-preview' || { echo PACKAGE_INVALID >&2; exit 2; }
[[ $(dpkg-deb --field "$source_deb" Version) == 2.1.49 && $(dpkg-deb --field "$source_deb" Architecture) == amd64 ]] || { echo BASELINE_INVALID >&2; exit 2; }
stage=$(mktemp -d "$output_parent/.v2-deb-qa-stage.XXXXXXXX")
chmod 700 -- "$stage"
cleanup(){ rm -rf -- "$stage"; }
trap cleanup EXIT
mkdir -m 700 -- "$stage/pkg"
dpkg-deb --raw-extract "$source_deb" "$stage/pkg"
# The pinned upstream archive has no symlinks: refuse a changed shape.
if find "$stage/pkg" -type l -print -quit | grep -q .; then echo SYMLINK_UNEXPECTED >&2; exit 2; fi
data_root="$stage/pkg/opt/Commander V2 Workspace Preview"
[[ -f "$data_root/resources/app.asar" && -f "$data_root/commander-v2-workspace-preview" && -f "$data_root/chrome-sandbox" ]] || { echo REQUIRED_DATA_MISSING >&2; exit 2; }
sha256sum -- "$data_root/resources/app.asar" "$data_root/commander-v2-workspace-preview" > "$stage/content-before"
# Correct packaging metadata, not installed V1/V2. Preserve file data and executable classification.
find "$stage/pkg" -type d -exec chmod a+rx -- {} +
find "$stage/pkg" -type f -perm /u+x -exec chmod a+rx -- {} +
find "$stage/pkg" -type f ! -perm /u+x -exec chmod a+r -- {} +
# The upstream postinst already selects SUID sandbox mode on supported systems.
# Do not force an always-SUID binary into the archive.
sed -i 's/^Version: 2\.1\.49$/Version: 2.1.49+commander.1/' "$stage/pkg/DEBIAN/control"
[[ $(dpkg-deb --field "$stage/pkg" Version 2>/dev/null || sed -n 's/^Version: //p' "$stage/pkg/DEBIAN/control") == 2.1.49+commander.1 ]] || { echo VERSION_EDIT_FAILED >&2; exit 2; }
sha256sum -- "$data_root/resources/app.asar" "$data_root/commander-v2-workspace-preview" > "$stage/content-after"
cmp -s "$stage/content-before" "$stage/content-after" || { echo BINARY_CONTENT_CHANGED >&2; exit 2; }
if find "$stage/pkg" -type d ! -perm /a+rx -print -quit | grep -q . || find "$stage/pkg" -type f ! -perm /a+r -print -quit | grep -q .; then echo MODE_REPAIR_FAILED >&2; exit 2; fi
tmp_deb="$stage/candidate.deb"
dpkg-deb --build --root-owner-group "$stage/pkg" "$tmp_deb" >/dev/null
[[ $(dpkg-deb --field "$tmp_deb" Version) == 2.1.49+commander.1 ]] || { echo REBUILT_VERSION_INVALID >&2; exit 2; }
# Published artifact remains a private QA-only file; no automatic installation.
install -m 600 -- "$tmp_deb" "$output_deb"
printf 'QA_REPACK_BUILT=%s\nINPUT_SHA256=%s\nOUTPUT_SHA256=%s\n' "$output_deb" "$source_hash" "$(sha256sum "$output_deb" | cut -d' ' -f1)"
