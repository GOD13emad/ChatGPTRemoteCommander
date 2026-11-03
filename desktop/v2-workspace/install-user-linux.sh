#!/usr/bin/env bash
set -euo pipefail
src="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
node_bin="$(command -v node)"
major="$(node -p 'process.versions.node.split(".")[0]')"
if (( major < 22 )); then echo NODE22_REQUIRED >&2; exit 2; fi
node --input-type=module - "$src" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const folder=process.argv[2];
const m=JSON.parse(fs.readFileSync(path.join(folder,'MANIFEST.json'),'utf8'));
if(m.mode!=='LOCAL_GUI_PREVIEW_NO_PROMOTION'||!Array.isArray(m.files))throw Error('MANIFEST_INVALID');
const seen=new Set();
for(const f of m.files){
 if(typeof f.path!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(f.path))||seen.has(f.path))throw Error('MANIFEST_PATH_INVALID');
 seen.add(f.path);
 const file=path.join(folder,f.path),st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('MANIFEST_FILE_INVALID');
 if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==f.sha256)throw Error('MANIFEST_HASH_INVALID');
}
for(const name of ['server.mjs','desktop-app.mjs','local-evidence.mjs','owner-seat-evidence.mjs','workflow-view.mjs','transport-evidence.mjs','owner-diagnostic-reader.mjs','v1-runtime-bridge.mjs','continuation-handoff.mjs','app.js','app.css','index.html','README.md'])
 if(!seen.has(name))throw Error('RUNTIME_FILE_MISSING');
JS
dest="$HOME/.local/share/CommanderV2/WorkspacePreview"
parent="$(dirname "$dest")"
apps="$HOME/.local/share/applications"
shortcut="$apps/io.github.god13emad.commander-v2-workspace.desktop"
for d in "$HOME/.local" "$HOME/.local/share" "$parent" "$apps" "$dest"; do
 if test -L "$d"; then echo ALIAS_PATH_FORBIDDEN >&2; exit 2; fi
done
mkdir -p -- "$parent" "$apps"
if test -d "$dest"; then
 for name in server.mjs desktop-app.mjs local-evidence.mjs owner-seat-evidence.mjs workflow-view.mjs transport-evidence.mjs owner-diagnostic-reader.mjs local-model-evidence.mjs v1-runtime-bridge.mjs continuation-handoff.mjs app.js app.css index.html README.md; do
  test -f "$dest/$name" && test ! -L "$dest/$name" &&
  test "$(sha256sum "$dest/$name" | cut -d' ' -f1)" = "$(sha256sum "$src/$name" | cut -d' ' -f1)" ||
  { echo "EXISTING_INSTALL_DIFFERS $name" >&2; exit 3; }
 done
else
 stage="$dest.install-$$"
 (umask 077; mkdir "$stage")
 for name in server.mjs desktop-app.mjs local-evidence.mjs owner-seat-evidence.mjs workflow-view.mjs transport-evidence.mjs owner-diagnostic-reader.mjs local-model-evidence.mjs v1-runtime-bridge.mjs continuation-handoff.mjs app.js app.css index.html README.md; do
  install -m 600 -- "$src/$name" "$stage/$name"
 done
 mv -- "$stage" "$dest"
fi
case "$node_bin:$dest" in *%*|*\"*) echo UNSAFE_DESKTOP_EXEC >&2; exit 2;; esac
content="$(printf '[Desktop Entry]\nType=Application\nName=Commander V2 Workspace Preview\nComment=Isolated GUI preview; Core V1 is unchanged\nExec=%s %s/desktop-app.mjs\nTerminal=false\nCategories=Development;Utility;\nStartupNotify=true\n' "$node_bin" "$dest")"
if test -e "$shortcut"; then
 if test -L "$shortcut" || test "$(cat "$shortcut")" != "$content"; then
  echo UNOWNED_SHORTCUT_PRESENT >&2; exit 3
 fi
else
 (umask 077; printf '%s\n' "$content" > "$shortcut")
 chmod 600 "$shortcut"
fi
printf 'USER_INSTALL_VERIFIED=%s\nDESKTOP_LAUNCHER=%s\nMODE=LOCAL_GUI_PREVIEW_NO_PROMOTION\n' "$dest" "$shortcut"
