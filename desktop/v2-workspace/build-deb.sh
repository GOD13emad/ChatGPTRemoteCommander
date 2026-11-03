#!/usr/bin/env bash
# Native DEB for the existing Commander V2 R18 owner-local Workspace preview.
# QA only: builds but never installs, signs or publishes a system package.
set -euo pipefail
if [[ $# -ne 3 ]]; then
  echo 'USAGE: build-deb.sh VERIFIED_PREVIEW_ZIP ZIP_SHA256 NEW_OUTPUT.deb' >&2
  exit 2
fi
archive=$1
pin=$2
output=$3
fail(){ printf 'V2_PREVIEW_DEB_%s\n' "$1" >&2; exit 2; }
[[ $pin =~ ^[a-f0-9]{64}$ ]] || fail INVALID_PIN
[[ -f $archive && ! -L $archive ]] || fail SOURCE_INVALID
[[ $output = /* && $output == *.deb ]] || fail OUTPUT_ABSOLUTE_DEB_REQUIRED
[[ ! -e $output && ! -L $output ]] || { echo V2_PREVIEW_DEB_OUTPUT_ALREADY_EXISTS >&2; exit 3; }
parent=$(dirname -- "$output")
[[ -d $parent && ! -L $parent ]] || fail OUTPUT_PARENT_UNTRUSTED
[[ $(sha256sum -- "$archive" | cut -d' ' -f1) == "$pin" ]] || fail SOURCE_HASH_CHANGED
umask 077
stage=$(mktemp -d "$parent/.v2-deb-qa.XXXXXXXX")
chmod 700 "$stage"
cleanup(){ rm -rf -- "$stage"; }
trap cleanup EXIT
pkg="$stage/pkg"
mkdir -p "$pkg/usr/lib/commander-v2-workspace-preview" \
  "$pkg/usr/share/applications" "$pkg/usr/bin" "$pkg/DEBIAN" \
  "$pkg/usr/share/doc/commander-v2-workspace-preview"
python3 - "$archive" "$pkg/usr/lib/commander-v2-workspace-preview" "$pkg/usr/share/doc/commander-v2-workspace-preview/MANIFEST.json" <<'PY'
import hashlib,json,pathlib,stat,sys,zipfile
src=pathlib.Path(sys.argv[1]);dest=pathlib.Path(sys.argv[2]);doc=pathlib.Path(sys.argv[3])
with zipfile.ZipFile(src) as archive:
    names=archive.namelist()
    manifest=json.loads(archive.read('MANIFEST.json'))
    if manifest.get('mode')!='LOCAL_GUI_PREVIEW_NO_PROMOTION' or manifest.get('schema')!=1:
        raise ValueError('PREVIEW_MODE_REQUIRED')
    files=manifest['files']
    if len(files)!=21 or len(names)!=22 or len(set(names))!=len(names):
        raise ValueError('FILE_COUNT_MISMATCH')
    if set(names)!={x['path'] for x in files}|{'MANIFEST.json'}:
        raise ValueError('MANIFEST_FILE_SET_MISMATCH')
    required={'server.mjs','desktop-app.mjs','app.js','index.html','app.css',
              'local-model-evidence.mjs','upgrade-r18.mjs'}
    if not required.issubset(set(names)):
        raise ValueError('REQUIRED_RUNTIME_MISSING')
    for item in files:
        name=item['path']
        if not isinstance(name,str) or not name.isascii() or not name.replace('.','').replace('-','').replace('_','').isalnum() or '/' in name or name.startswith('.'):
            raise ValueError('UNSAFE_ARCHIVE_NAME')
        info=archive.getinfo(name)
        mode=info.external_attr>>16
        if stat.S_ISLNK(mode): raise ValueError('LINK_NOT_ALLOWED')
        data=archive.read(name)
        if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']:
            raise ValueError('ARCHIVE_HASH_CHANGED')
        (dest/name).write_bytes(data)
    doc.write_bytes(archive.read('MANIFEST.json'))
print('V2_DEB_SOURCE_MANIFEST_VALIDATED=21')
PY
cat > "$pkg/DEBIAN/control" <<'CONTROL'
Package: commander-v2-workspace-preview
Version: 0.18.0~qa20261103
Section: utils
Priority: optional
Architecture: all
Maintainer: Commander V2 QA
Depends: nodejs (>= 22), xdg-utils
Description: Commander V2 owner-local Workspace preview (R18 QA)
 Read-only local dashboard with authenticated local status endpoints.
 This QA package is unsigned and does not enroll ChatGPT or run V2 workers.
CONTROL
cat > "$pkg/usr/bin/commander-v2-workspace-preview" <<'LAUNCH'
#!/bin/sh
set -eu
command -v node >/dev/null 2>&1 || { echo NODE22_REQUIRED >&2; exit 2; }
major=$(node -p 'Number(process.versions.node.split(".")[0])')
[ "$major" -ge 22 ] || { echo NODE22_REQUIRED >&2; exit 2; }
exec node /usr/lib/commander-v2-workspace-preview/desktop-app.mjs
LAUNCH
cat > "$pkg/usr/share/applications/io.github.god13emad.commander-v2-workspace.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Commander V2 Workspace Preview
Comment=Owner-local read-only R18 QA workspace; no ChatGPT enrollment
Exec=commander-v2-workspace-preview
Icon=utilities-terminal
Terminal=false
Categories=Development;Utility;
StartupNotify=true
DESKTOP
find "$pkg" -type d -exec chmod 755 -- {} +
find "$pkg" -type f -exec chmod 644 -- {} +
chmod 755 "$pkg/usr/bin/commander-v2-workspace-preview"
dpkg-deb --build --root-owner-group "$pkg" "$stage/package.deb" >/dev/null
[[ $(dpkg-deb --field "$stage/package.deb" Package) == 'commander-v2-workspace-preview' ]] || fail BUILT_PACKAGE_ID_WRONG
[[ $(dpkg-deb --field "$stage/package.deb" Version) == '0.18.0~qa20261103' ]] || fail BUILT_PACKAGE_VERSION_WRONG
[[ $(dpkg-deb --field "$stage/package.deb" Architecture) == all ]] || fail BUILT_PACKAGE_ARCH_WRONG
install -m 600 -- "$stage/package.deb" "$output"
printf 'V2_R18_NATIVE_QA_DEB=%s\nDEB_SHA256=%s\nSOURCE_SHA256=%s\n' "$output" "$(sha256sum "$output" | cut -d' ' -f1)" "$pin"
