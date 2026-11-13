#!/usr/bin/env bash
# Merge the SHA-pinned native Core/Node/Tunnel DEB with the GUI DEB into ONE
# dpkg-managed product. QA only; does not install or activate anything.
set -euo pipefail
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
NATIVE="$BASE/dist/installer/Remote-Commander-Linux-amd64.deb"
GUI="$BASE/dist/unified/Remote-Commander-Unified-0.12.0-dev.1-Linux-amd64.deb"
for tool in dpkg-deb python3 sha256sum mktemp; do
  command -v "$tool" >/dev/null || { echo "RC012_MERGE_MISSING_TOOL $tool" >&2; exit 2; }
done
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo RC012_MERGE_LINUX_AMD64_ONLY >&2; exit 2; }
[[ -f "$NATIVE" && -f "$GUI" && ! -L "$NATIVE" && ! -L "$GUI" ]] || {
  echo RC012_MERGE_INPUT_MISSING >&2; exit 2;
}
pkg() { dpkg-deb --field "$1" "$2"; }
[[ "$(pkg "$NATIVE" Package)" == chatgpt-remote-commander &&
   "$(pkg "$GUI" Package)" == chatgpt-remote-commander ]] || {
  echo RC012_MERGE_PACKAGE_IDENTITY_MISMATCH >&2; exit 3;
}
[[ "$(pkg "$NATIVE" Architecture)" == amd64 && "$(pkg "$GUI" Architecture)" == amd64 ]] || {
  echo RC012_MERGE_ARCH_MISMATCH >&2; exit 3;
}
dpkg --compare-versions "$(pkg "$GUI" Version)" gt "$(pkg "$NATIVE" Version)" || {
  echo RC012_MERGE_VERSION_NOT_UPGRADE >&2; exit 3;
}
WORK="$(mktemp -d "$BASE/dist/unified/.native-merge-XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
mkdir "$WORK/native" "$WORK/gui"
dpkg-deb --raw-extract "$NATIVE" "$WORK/native"
dpkg-deb --raw-extract "$GUI" "$WORK/gui"
python3 - "$WORK/native" "$WORK/gui" <<'PY'
import hashlib, json, os, pathlib, shutil, sys
native=pathlib.Path(sys.argv[1])
gui=pathlib.Path(sys.argv[2])
runtime=native/'usr/lib/chatgpt-remote-commander'
core=runtime/'app'
gui_core=gui/'opt/Remote Commander/resources/core'
manifest=json.loads((gui_core/'source-manifest.json').read_text())
if manifest.get('schema')!=2 or manifest.get('count',0)<300:
    raise SystemExit('RC012_MERGE_BAD_CORE_MANIFEST')
if len(manifest.get('files',{}))!=manifest['count']:
    raise SystemExit('RC012_MERGE_BAD_CORE_COUNT')
for rel, digest in manifest['files'].items():
    if not rel or rel.startswith('/') or '\\' in rel or '..' in rel.split('/'):
        raise SystemExit('RC012_MERGE_TRAVERSAL')
    a=core/rel
    b=gui_core/rel
    if not a.is_file() or a.is_symlink() or not b.is_file() or b.is_symlink():
        raise SystemExit('RC012_MERGE_MISSING_SOURCE '+rel)
    h=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
    if h(a)!=digest or h(b)!=digest:
        raise SystemExit('RC012_MERGE_SOURCE_DRIFT '+rel)
required=[
    runtime/'runtime/node',
    runtime/'tunnel/native-tunnel-launch.sh',
    runtime/'tunnel/tunnel-client',
    runtime/'tunnel/cloudflared',
    native/'usr/lib/systemd/user/chatgpt-remote-commander-tunnel@.service',
    gui/'opt/Remote Commander/remote-commander-unified',
    gui/'opt/Remote Commander/chrome-sandbox',
]
for f in required:
    if not f.is_file() or f.is_symlink() or f.stat().st_size<=0:
        raise SystemExit('RC012_MERGE_REQUIRED_ASSET '+str(f))
def iter_entries(path):
    for base, dirs, files in os.walk(path, topdown=True, followlinks=False):
        dirs.sort(); files.sort()
        for item in list(dirs)+files:
            p=pathlib.Path(base)/item
            yield p,p.relative_to(path)
            if p.is_symlink() and item in dirs:
                dirs.remove(item)
for src,rel in iter_entries(gui):
    if rel.parts[0]=='DEBIAN':continue
    dest=native/rel
    if src.is_symlink():
        target=os.readlink(src)
        if dest.is_symlink():
            if os.readlink(dest)!=target:raise SystemExit('RC012_MERGE_SYMLINK_CONFLICT '+str(rel))
        elif dest.exists():raise SystemExit('RC012_MERGE_FILE_CONFLICT '+str(rel))
        else:
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.symlink_to(target)
    elif src.is_dir():
        if dest.exists() and (not dest.is_dir() or dest.is_symlink()):
            raise SystemExit('RC012_MERGE_DIR_CONFLICT '+str(rel))
        dest.mkdir(parents=True,exist_ok=True)
    elif src.is_file():
        if dest.exists():
            if not dest.is_file() or dest.is_symlink() or src.read_bytes()!=dest.read_bytes():
                raise SystemExit('RC012_MERGE_FILE_CONFLICT '+str(rel))
        else:
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(src,dest)
    else:
        raise SystemExit('RC012_MERGE_SPECIAL_FILE '+str(rel))
# electron-builder may stage private (0700) application directories. An installed
# desktop program must be traversable by the OS owner without root privileges;
# normalize only this static, public application tree, never owner credentials.
opt_root=native/'opt'
desktop_root=opt_root/'Remote Commander'
share_root=native/'usr/share'
if (not opt_root.is_dir() or opt_root.is_symlink()
        or not desktop_root.is_dir() or desktop_root.is_symlink()
        or not share_root.is_dir() or share_root.is_symlink()):
    raise SystemExit('RC012_MERGED_DESKTOP_DIRECTORY_INVALID')
opt_root.chmod(0o755)
# Normalize the installed public GUI and desktop integration files, including
# app.asar, AppArmor template, .desktop/icon files. Never touch per-owner data.
for static_root in (desktop_root,share_root):
    for base,dirs,files in os.walk(static_root,followlinks=False):
        current=pathlib.Path(base)
        if not current.is_dir() or current.is_symlink():
            raise SystemExit('RC012_MERGED_DESKTOP_DIRECTORY_UNSAFE')
        current.chmod(0o755)
        for basename in files:
            asset=current/basename
            if asset.is_symlink():continue
            if not asset.is_file():raise SystemExit('RC012_MERGED_GUI_FILE_UNSAFE')
            asset.chmod(0o755 if asset.stat().st_mode&0o111 else 0o644)
native_control=(native/'DEBIAN/control').read_text()
gui_control=(gui/'DEBIAN/control').read_text()
def field(s,name):
    for row in s.splitlines():
        if row.startswith(name+': '):
            return row.partition(': ')[2]
    raise SystemExit('RC012_MERGE_MISSING_CONTROL '+name)
if field(gui_control,'Package')!=field(native_control,'Package'):
    raise SystemExit('RC012_MERGE_CONTROL_PACKAGE_MISMATCH')
if field(gui_control,'Architecture')!=field(native_control,'Architecture'):
    raise SystemExit('RC012_MERGE_CONTROL_ARCH_MISMATCH')
deps=[]
for spec in (field(native_control,'Depends')+', '+field(gui_control,'Depends')).split(','):
    spec=spec.strip()
    if spec and spec not in deps:deps.append(spec)
gui_control=gui_control.replace('Depends: '+field(gui_control,'Depends'),
   'Depends: '+', '.join(deps),1)
for p in (gui/'DEBIAN').iterdir():
    if p.name not in ('control','md5sums'):
        shutil.copy2(p,native/'DEBIAN'/p.name)
(native/'DEBIAN/control').write_text(gui_control)
# Build one truthful inventory of every installed regular file.
md5=[]
for path,rel in iter_entries(native):
    if rel.parts[0]=='DEBIAN':continue
    if path.is_file() and not path.is_symlink():
        md5.append(hashlib.md5(path.read_bytes()).hexdigest()+'  '+str(rel))
(native/'DEBIAN/md5sums').write_text('\n'.join(sorted(md5))+'\n')
print('UNIFIED_NATIVE_CORE_TUNNEL_GUI_STAGED',
      json.dumps({'verifiedCoreFiles':manifest['count'],'nativeTunnel':True,
       'desktop':True,'controlDependencies':len(deps),'totalFiles':len(md5)}))
PY
TARGET="$WORK/combined.deb"
dpkg-deb --build --root-owner-group "$WORK/native" "$TARGET" >/dev/null
for f in   'usr/lib/chatgpt-remote-commander/tunnel/native-tunnel-launch.sh'   'usr/lib/chatgpt-remote-commander/tunnel/tunnel-client'   'usr/lib/chatgpt-remote-commander/runtime/node'   'usr/lib/systemd/user/chatgpt-remote-commander-tunnel@.service'   'opt/Remote Commander/remote-commander-unified'; do
  dpkg-deb --contents "$TARGET" | grep -F "./$f" >/dev/null || {
    echo "RC012_MERGED_PACKAGE_MISSING $f" >&2; exit 5;
  }
done
# Fail the release build if any installed GUI directory is inaccessible to
# regular users; this catches future electron-builder mode regressions.
dpkg-deb --contents "$TARGET" | awk '
  /\.\/opt\/Remote Commander\// || /\.\/usr\/share\// {
    if (substr($1,1,1)=="d" && $1!="drwxr-xr-x") {
      print "RC012_MERGED_GUI_DIRECTORY_NOT_TRAVERSABLE" > "/dev/stderr"; bad=1
    }
    if (substr($1,1,1)=="-" && $1!="-rw-r--r--" && $1!="-rwxr-xr-x") {
      print "RC012_MERGED_GUI_FILE_NOT_READABLE" > "/dev/stderr"; bad=1
    }
  }
  END { exit bad }
' || exit 5
[[ "$(pkg "$TARGET" Package)" == chatgpt-remote-commander ]] || exit 5
[[ "$(pkg "$TARGET" Version)" == "$(pkg "$GUI" Version)" ]] || exit 5
BEFORE="$(sha256sum "$GUI"|cut -d' ' -f1)"
AFTER="$(sha256sum "$TARGET"|cut -d' ' -f1)"
mv -f -- "$TARGET" "$GUI"
echo "RC012_SINGLE_NATIVE_LINUX_BUNDLE_PASS version=$(pkg "$GUI" Version) guiInputSha256=$BEFORE combinedSha256=$AFTER installed=false"
