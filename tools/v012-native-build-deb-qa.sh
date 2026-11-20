#!/usr/bin/env bash
# Build one disposable, self-contained Commander V2 v0.12 RC native DEB
# from the exact tracked source. No host registration, no public release.
set -euo pipefail
fail(){ printf 'V012_DEB_QA_%s\n' "$1" >&2; exit 2; }
[[ $# -eq 2 ]] || fail ARGUMENTS
repo=$1
output=$2
[[ -d $repo && -d $repo/.git ]] || fail SOURCE_NOT_GIT
[[ $output = /* && $output == *.deb ]] || fail OUTPUT_MUST_BE_NEW_ABSOLUTE_DEB
[[ ! -e $output && ! -L $output ]] || fail OUTPUT_EXISTS
parent=$(dirname -- "$output")
[[ -d $parent && ! -L $parent ]] || fail OUTPUT_PARENT
command -v dpkg-deb >/dev/null || fail DPKG_DEB_MISSING
command -v node >/dev/null || fail NODE_MISSING
[[ $(node -p 'process.platform+" "+process.arch') == 'linux x64' ]] || fail TARGET_MISMATCH
[[ $(node -p 'Number(process.versions.node.split(".")[0])') -ge 22 ]] || fail NODE22_REQUIRED
nodebin=$(node -p 'process.execPath')
[[ -f $nodebin && ! -L $nodebin ]] || fail NODE_BINARY_ALIAS
noderoot=$(dirname -- "$(dirname -- "$nodebin")")
[[ -f $noderoot/LICENSE && ! -L $noderoot/LICENSE ]] || fail NODE_LICENSE_NOT_VERIFIED
[[ $parent != "$repo" && "$parent" != "$repo/"* ]] || fail SOURCE_OUTPUT_OVERLAP
umask 077
stage=$(mktemp -d "$parent/.v012-native-qa-XXXXXXXX")
chmod 700 "$stage"
cleanup(){ rm -rf -- "$stage"; }
trap cleanup EXIT
node "$repo/tools/v012-unified-release-assemble.mjs" \
 --source "$repo" --out "$stage" --mode desktop > "$stage/receipt.json"
bundle=$(node - "$stage/receipt.json" <<'NODE'
const fs=require('node:fs');
const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(r.version!=='0.12.0-rc.1'||r.mode!=='desktop'||
  r.sourceCoreVersion!=='0.11.0-dev.19'||r.nativeOsInstallerBuilt!==false)
  process.exit(3);
process.stdout.write(r.bundle);
NODE
)
[[ $bundle == "$stage/"* && -d $bundle ]] || fail BUNDLE_SCOPE_INVALID
pkg="$stage/pkg"
mkdir -p "$pkg/opt/Commander V2" "$pkg/usr/bin" "$pkg/usr/share/doc/commander-v2" "$pkg/DEBIAN"
cp -a -- "$bundle/." "$pkg/opt/Commander V2/"
mkdir -p "$pkg/opt/Commander V2/runtime"
cp -- "$nodebin" "$pkg/opt/Commander V2/runtime/node"
cp -- "$noderoot/LICENSE" "$pkg/usr/share/doc/commander-v2/Node22-LICENSE"
cp -- "$repo/LICENSE" "$pkg/usr/share/doc/commander-v2/Commander-LICENSE"
cat > "$pkg/usr/bin/commander-v2" <<'ENTRY'
#!/bin/sh
set -eu
exec "/opt/Commander V2/runtime/node" "/opt/Commander V2/bin/commander-v2.mjs" "$@"
ENTRY
cat > "$pkg/DEBIAN/control" <<'CONTROL'
Package: commander-v2
Version: 0.12.0~rc1
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Commander V2 QA
Depends: libc6, libstdc++6
Description: Commander V2 v0.12 candidate unified managed runtime (QA only)
 One user-facing package containing staged Windows/Linux shared source,
 headless Core and local Workspace GUI. No ChatGPT permission is granted
 by package installation. This is a candidate, not a Stable release.
CONTROL
find "$pkg" -type d -exec chmod 755 -- {} +
find "$pkg" -type f -exec chmod 644 -- {} +
chmod 755 "$pkg/usr/bin/commander-v2" "$pkg/opt/Commander V2/runtime/node"
dpkg-deb --build --root-owner-group "$pkg" "$stage/output.deb" >/dev/null
[[ $(dpkg-deb --field "$stage/output.deb" Package) == commander-v2 ]] || fail PACKAGE_ID_CHANGED
[[ $(dpkg-deb --field "$stage/output.deb" Version) == 0.12.0~rc1 ]] || fail PACKAGE_VERSION_CHANGED
[[ $(dpkg-deb --field "$stage/output.deb" Architecture) == amd64 ]] || fail ARCH_CHANGED
out="$stage/unpacked"
mkdir -p "$out"
dpkg-deb -x "$stage/output.deb" "$out"
[[ -x "$out/opt/Commander V2/runtime/node" ]] || fail RUNTIME_MISSING
manifest="$out/opt/Commander V2/manifest.json"
[[ -f $manifest ]] || fail MANIFEST_MISSING
node - "$out/opt/Commander V2" "$stage/receipt.json" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const root=process.argv[2],rc=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
if(crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex')!==rc.manifestSha256)process.exit(4);
if(m.files.length!==rc.entries)process.exit(5);
for(const f of m.files){
 const p=path.join(root,...f.path.split('/'));
 if(fs.statSync(p).size!==f.bytes||
   crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==f.sha256)process.exit(6);
}
NODE
"$out/opt/Commander V2/runtime/node" "$out/opt/Commander V2/bin/commander-v2.mjs" inspect |
node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let a=JSON.parse(s);if(a.version!=="0.12.0-rc.1"||a.fullPowerReady!==false||a.stableRelease!==false)process.exit(7)})'
install -m 600 -- "$stage/output.deb" "$output"
printf 'V012_NATIVE_QA_DEB_BUILD_PASS version=0.12.0~rc1 bytes=%s sha256=%s\n' \
 "$(stat -c %s "$output")" "$(sha256sum "$output"|cut -d' ' -f1)"
