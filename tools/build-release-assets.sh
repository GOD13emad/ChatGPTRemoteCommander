#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUT="${1:-$ROOT/dist/release}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
EPOCH="$(git -C "$ROOT" show -s --format=%ct HEAD)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for f in   install.ps1 install.sh install-work-plugin.ps1 install-work-plugin.sh   server-install-windows.ps1 server-install-linux.sh START_HERE.md WORK_SETUP.md   assets/plugin-icon.png assets/plugin-icon.svg assets/plugin-logo.png   plugin-template/plugin.json plugin-template/.codex-plugin/plugin.json
do
  [[ -f "$ROOT/$f" ]] || { echo "missing release input: $f" >&2; exit 1; }
done
command -v python3 >/dev/null 2>&1 || { echo 'python3 is required to build deterministic ZIP assets' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo 'sha256sum is required to build release checksums' >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

cp "$ROOT/install.ps1" "$OUT/install.ps1"
cp "$ROOT/install.sh" "$OUT/install.sh"
cp "$ROOT/install-work-plugin.ps1" "$OUT/install-work-plugin.ps1"
cp "$ROOT/install-work-plugin.sh" "$OUT/install-work-plugin.sh"
cp "$ROOT/server-install-windows.ps1" "$OUT/server-install-windows.ps1"
cp "$ROOT/server-install-linux.sh" "$OUT/server-install-linux.sh"
cp "$ROOT/START_HERE.md" "$OUT/START_HERE.md"
cp "$ROOT/WORK_SETUP.md" "$OUT/WORK_SETUP.md"
cp "$ROOT/assets/plugin-icon.png" "$OUT/plugin-icon.png"
cp "$ROOT/assets/plugin-icon.svg" "$OUT/plugin-icon.svg"
cp "$ROOT/assets/plugin-logo.png" "$OUT/plugin-logo.png"

zip_tree() {
  local src="$1" dest="$2"
  python3 - "$src" "$dest" "$EPOCH" <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import os, stat, sys, time
src = Path(sys.argv[1]).resolve()
dest = Path(sys.argv[2]).resolve()
epoch = max(int(sys.argv[3]), 315532800)
dt = time.gmtime(epoch)[:6]
with ZipFile(dest, "w", compression=ZIP_DEFLATED, compresslevel=9) as z:
    for path in sorted((p for p in src.rglob("*") if p.is_file()), key=lambda p: p.relative_to(src).as_posix()):
        rel = path.relative_to(src).as_posix()
        info = ZipInfo(rel, date_time=dt)
        mode = stat.S_IMODE(path.stat().st_mode)
        info.external_attr = (mode & 0xFFFF) << 16
        info.compress_type = ZIP_DEFLATED
        z.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
PY
}

plugin_stage="$TMP/plugin-template"
mkdir -p "$plugin_stage"
cp -a "$ROOT/plugin-template/." "$plugin_stage/"
zip_tree "$plugin_stage" "$OUT/plugin-template.zip"
cp "$OUT/plugin-template.zip" "$OUT/plugin-template-v$VERSION.zip"

installer_stage="$TMP/installer"
mkdir -p "$installer_stage"
for f in install.ps1 install.sh install-work-plugin.ps1 install-work-plugin.sh server-install-windows.ps1 server-install-linux.sh START_HERE.md WORK_SETUP.md; do
  cp "$ROOT/$f" "$installer_stage/$f"
done
cp "$OUT/plugin-template.zip" "$installer_stage/plugin-template.zip"
cat > "$installer_stage/README-INSTALL.txt" <<EOF
ChatGPT Remote Commander v$VERSION
Release commit: $COMMIT

Windows desktop/update:
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -PowerMode -StartServer -SourceRef v$VERSION -ExpectedCommit $COMMIT

Windows Server bootstrap (run from an elevated Administrator PowerShell):
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\server-install-windows.ps1 -SourceRef v$VERSION -ExpectedCommit $COMMIT

Linux:
  ./install.sh --power-mode --start-server --source-ref v$VERSION --expected-commit $COMMIT

Linux Server bootstrap:
  ./server-install-linux.sh --source-ref v$VERSION --expected-commit $COMMIT

No antivirus exclusions are added by the server bootstrap.
EOF
(
  cd "$installer_stage"
  sha256sum install.ps1 install.sh install-work-plugin.ps1 install-work-plugin.sh     server-install-windows.ps1 server-install-linux.sh plugin-template.zip START_HERE.md WORK_SETUP.md README-INSTALL.txt     | LC_ALL=C sort -k2 > SHA256SUMS-INSTALLER.txt
  sha256sum -c SHA256SUMS-INSTALLER.txt
)
zip_tree "$installer_stage" "$OUT/ChatGPT-Remote-Commander-v$VERSION-Installer.zip"

(
  cd "$OUT"
  find . -maxdepth 1 -type f ! -name SHA256SUMS.txt -printf '%f\n'     | LC_ALL=C sort     | while IFS= read -r f; do sha256sum "$f"; done > SHA256SUMS.txt
  sha256sum -c SHA256SUMS.txt
)

count="$(find "$OUT" -maxdepth 1 -type f | wc -l | tr -d ' ')"
[[ "$count" -eq 16 ]] || { echo "unexpected release asset count: $count" >&2; exit 1; }
echo "RELEASE_ASSETS_PASS version=$VERSION commit=$COMMIT count=$count out=$OUT"
