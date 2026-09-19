#!/usr/bin/env bash
set -euo pipefail
APP_ID="${1:-}"
MARKETPLACE_NAME="${MARKETPLACE_NAME:-chatgpt-remote-commander-personal}"
SOURCE_PATH="${BASH_SOURCE[0]:-}"
if [[ -n "$SOURCE_PATH" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$SOURCE_PATH")" 2>/dev/null && pwd || pwd)"
else
  SCRIPT_DIR="$(pwd)"
fi
INSTALL_ROOT="${INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/ChatGPTRemoteCommander/work-plugin}"
TEMPLATE_SOURCE="${TEMPLATE_SOURCE:-}"
TEMP_TEMPLATE_ROOT=""
CURL_CONNECT_TIMEOUT="${REMOTE_COMMANDER_CURL_CONNECT_TIMEOUT:-15}"
CURL_MAX_TIME="${REMOTE_COMMANDER_CURL_MAX_TIME:-180}"
RELEASE_TAG='__REMOTE_COMMANDER_RELEASE_TAG__'
PLUGIN_TEMPLATE_SHA256='__REMOTE_COMMANDER_PLUGIN_TEMPLATE_SHA256__'
PLUGIN_TEMPLATE_MANIFEST_BASE64='__REMOTE_COMMANDER_PLUGIN_TEMPLATE_MANIFEST_BASE64__'
CANONICAL_RELEASE_BASE='https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/download'

cleanup() {
  [[ -z "$TEMP_TEMPLATE_ROOT" ]] || rm -rf "$TEMP_TEMPLATE_ROOT"
}
trap cleanup EXIT

published_template_pin() {
  [[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]
}

verify_template_directory() {
  local root="$1"
  published_template_pin || return 0
  node --input-type=module - "$root" "$PLUGIN_TEMPLATE_MANIFEST_BASE64" <<'NODE'
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const [, , rootArg, encoded] = process.argv;
const root=path.resolve(rootArg);
let expected;
try { expected=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')); } catch { throw new Error('PLUGIN_TEMPLATE_MANIFEST_INVALID'); }
if(!Array.isArray(expected)||expected.length===0) throw new Error('PLUGIN_TEMPLATE_MANIFEST_INVALID');
const safe=(name)=>typeof name==='string'&&/^[A-Za-z0-9._+\/-]+$/.test(name)&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&!name.split('/').some(x=>x===''||x==='.'||x==='..');
const expectedMap=new Map(); const expectedDirs=new Set();
for(const item of expected){
  if(!safe(item.name)||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[0-9a-f]{64}$/.test(item.sha256)||expectedMap.has(item.name.toLowerCase())) throw new Error('PLUGIN_TEMPLATE_MANIFEST_INVALID');
  expectedMap.set(item.name.toLowerCase(),item);
  const parts=item.name.split('/'); for(let i=1;i<parts.length;i++) expectedDirs.add(parts.slice(0,i).join('/').toLowerCase());
}
const files=new Map(); const dirs=new Set();
function walk(dir,relative=''){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const rel=relative?`${relative}/${entry.name}`:entry.name;
    if(!safe(rel)) throw new Error('PLUGIN_TEMPLATE_ENTRY_INVALID');
    const full=path.join(dir,entry.name); const st=fs.lstatSync(full);
    if(st.isSymbolicLink()) throw new Error('PLUGIN_TEMPLATE_ENTRY_INVALID');
    if(st.isDirectory()){ dirs.add(rel.toLowerCase()); walk(full,rel); }
    else if(st.isFile()) files.set(rel.toLowerCase(),{rel,full,st});
    else throw new Error('PLUGIN_TEMPLATE_ENTRY_INVALID');
  }
}
walk(root);
if(files.size!==expectedMap.size||dirs.size!==expectedDirs.size||[...dirs].some(x=>!expectedDirs.has(x))) throw new Error('PLUGIN_TEMPLATE_SET_MISMATCH');
for(const [key,item] of expectedMap){
  const actual=files.get(key); if(!actual||actual.rel!==item.name) throw new Error('PLUGIN_TEMPLATE_SET_MISMATCH');
  const hash=crypto.createHash('sha256').update(fs.readFileSync(actual.full)).digest('hex');
  if(actual.st.size!==item.bytes||hash!==item.sha256) throw new Error('PLUGIN_TEMPLATE_ENTRY_HASH_MISMATCH');
}
NODE
}

extract_verified_template_zip() {
  local zip="$1" destination="$2" actual
  actual="$(sha256sum "$zip" | awk '{print tolower($1)}')"
  [[ "$actual" == "$PLUGIN_TEMPLATE_SHA256" ]] || { echo 'PLUGIN_TEMPLATE_SHA256_MISMATCH' >&2; return 1; }
  mkdir -p "$destination"
  if command -v unzip >/dev/null 2>&1; then
    node --input-type=module - "$zip" "$destination" "$PLUGIN_TEMPLATE_MANIFEST_BASE64" <<'NODE'
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const [, , zip, destinationArg, encoded] = process.argv;
const destination=path.resolve(destinationArg);
let expected;
try { expected=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')); } catch { throw new Error('PLUGIN_TEMPLATE_MANIFEST_INVALID'); }
const safe=(name)=>typeof name==='string'&&/^[A-Za-z0-9._+\/-]+$/.test(name)&&!name.includes('\\')&&!name.startsWith('/')&&!/^[A-Za-z]:/.test(name)&&!name.split('/').some(x=>x===''||x==='.'||x==='..');
const expectedMap=new Map(); const expectedDirs=new Set();
for(const item of expected||[]){
  if(!safe(item.name)||!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[0-9a-f]{64}$/.test(item.sha256)||expectedMap.has(item.name.toLowerCase())) throw new Error('PLUGIN_TEMPLATE_MANIFEST_INVALID');
  expectedMap.set(item.name.toLowerCase(),item);
  const parts=item.name.split('/'); for(let i=1;i<parts.length;i++) expectedDirs.add(parts.slice(0,i).join('/').toLowerCase());
}
if(expectedMap.size===0) throw new Error('PLUGIN_TEMPLATE_MANIFEST_INVALID');
const listing=spawnSync('unzip',['-Z1',zip],{encoding:'utf8',maxBuffer:16*1024*1024});
if(listing.status!==0) throw new Error('PLUGIN_TEMPLATE_ARCHIVE_INVALID');
const files=new Map(); const dirs=new Set();
for(const raw of listing.stdout.split(/\r?\n/).filter(Boolean)){
  const isDirectory=raw.endsWith('/'); const name=isDirectory?raw.slice(0,-1):raw;
  if(!safe(name)) throw new Error('PLUGIN_TEMPLATE_ENTRY_INVALID');
  const key=name.toLowerCase();
  if(isDirectory){ if(dirs.has(key)||!expectedDirs.has(key)) throw new Error('PLUGIN_TEMPLATE_SET_MISMATCH'); dirs.add(key); continue; }
  if(files.has(key)||!expectedMap.has(key)) throw new Error('PLUGIN_TEMPLATE_SET_MISMATCH'); files.set(key,name);
}
if(files.size!==expectedMap.size||[...expectedMap.keys()].some(x=>!files.has(x))) throw new Error('PLUGIN_TEMPLATE_SET_MISMATCH');
for(const [key,item] of expectedMap){
  const name=files.get(key); if(name!==item.name) throw new Error('PLUGIN_TEMPLATE_SET_MISMATCH');
  const extracted=spawnSync('unzip',['-p',zip,name],{encoding:null,maxBuffer:128*1024*1024});
  if(extracted.status!==0) throw new Error('PLUGIN_TEMPLATE_ARCHIVE_INVALID');
  const data=extracted.stdout; const hash=crypto.createHash('sha256').update(data).digest('hex');
  if(data.length!==item.bytes||hash!==item.sha256) throw new Error('PLUGIN_TEMPLATE_ENTRY_HASH_MISMATCH');
  const target=path.resolve(destination,...name.split('/'));
  if(!target.startsWith(destination+path.sep)) throw new Error('PLUGIN_TEMPLATE_ENTRY_INVALID');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,data,{flag:'wx'});
}
NODE
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$zip" "$destination" "$PLUGIN_TEMPLATE_MANIFEST_BASE64" <<'PY'
import base64, hashlib, json, os, pathlib, re, sys, zipfile
archive, destination, encoded = sys.argv[1:]
destination = pathlib.Path(destination).resolve()
try: expected = json.loads(base64.b64decode(encoded).decode('utf-8'))
except Exception: raise SystemExit('PLUGIN_TEMPLATE_MANIFEST_INVALID')
safe = lambda n: isinstance(n,str) and re.fullmatch(r'[A-Za-z0-9._+/\-]+',n) and not n.startswith('/') and not re.match(r'^[A-Za-z]:',n) and all(x not in ('','.','..') for x in n.split('/'))
records={}
for item in expected:
    key=item.get('name','').lower()
    if not safe(item.get('name')) or key in records or not isinstance(item.get('bytes'),int) or item['bytes']<0 or not re.fullmatch(r'[0-9a-f]{64}',item.get('sha256','')): raise SystemExit('PLUGIN_TEMPLATE_MANIFEST_INVALID')
    records[key]=item
with zipfile.ZipFile(archive) as z:
    files={}
    allowed_dirs={('/'.join(i['name'].split('/')[:n])).lower() for i in expected for n in range(1,len(i['name'].split('/')))}
    seen_dirs=set()
    for info in z.infolist():
        raw=info.filename; name=raw[:-1] if info.is_dir() and raw.endswith('/') else raw
        if not safe(name): raise SystemExit('PLUGIN_TEMPLATE_ENTRY_INVALID')
        key=name.lower()
        if info.is_dir():
            if key in seen_dirs or key not in allowed_dirs: raise SystemExit('PLUGIN_TEMPLATE_SET_MISMATCH')
            seen_dirs.add(key); continue
        if key in files or key not in records: raise SystemExit('PLUGIN_TEMPLATE_SET_MISMATCH')
        files[key]=info
    if set(files)!=set(records): raise SystemExit('PLUGIN_TEMPLATE_SET_MISMATCH')
    for key,item in records.items():
        info=files[key]
        if info.filename!=item['name']: raise SystemExit('PLUGIN_TEMPLATE_SET_MISMATCH')
        data=z.read(info)
        if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']: raise SystemExit('PLUGIN_TEMPLATE_ENTRY_HASH_MISMATCH')
        target=(destination / pathlib.PurePosixPath(item['name'])).resolve()
        if destination not in target.parents: raise SystemExit('PLUGIN_TEMPLATE_ENTRY_INVALID')
        target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
PY
  else
    echo 'unzip or python3 is required to verify and extract the Plugin template' >&2; return 1
  fi
  verify_template_directory "$destination"
}

if [[ "$APP_ID" =~ ^plugin_((asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+)$ ]]; then APP_ID="${BASH_REMATCH[1]}"; fi
[[ "$APP_ID" =~ ^(asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+$ ]] || {
  echo 'AppId must be an app id (asdk_app_/connector_/templated_apps_) or the corresponding plugin_ technical id.' >&2; exit 2;
}
[[ "$MARKETPLACE_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'MarketplaceName contains unsupported characters.' >&2; exit 2; }
command -v codex >/dev/null 2>&1 || { echo 'codex CLI not found' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'node is required' >&2; exit 1; }

resolve_template() {
  if [[ -n "$TEMPLATE_SOURCE" && -f "$TEMPLATE_SOURCE/plugin.json" ]]; then verify_template_directory "$TEMPLATE_SOURCE"; TEMPLATE="$TEMPLATE_SOURCE"; return; fi
  if [[ -f "$SCRIPT_DIR/plugin-template/plugin.json" ]]; then verify_template_directory "$SCRIPT_DIR/plugin-template"; TEMPLATE="$SCRIPT_DIR/plugin-template"; return; fi
  published_template_pin || { echo 'PLUGIN_TEMPLATE_PIN_REQUIRED' >&2; exit 1; }
  TEMP_TEMPLATE_ROOT="$(mktemp -d)"
  local zip="$TEMP_TEMPLATE_ROOT/plugin-template.zip"
  local extracted="$TEMP_TEMPLATE_ROOT/verified-template"
  echo "Local Plugin template not found; downloading pinned Release template $RELEASE_TAG." >&2
  command -v curl >/dev/null 2>&1 || { echo 'curl is required to download the Plugin template' >&2; exit 1; }
  command -v sha256sum >/dev/null 2>&1 || { echo 'sha256sum is required to verify the Plugin template' >&2; exit 1; }
  curl --fail --silent --show-error --location \
    --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" \
    "$CANONICAL_RELEASE_BASE/$RELEASE_TAG/plugin-template.zip" -o "$zip"
  extract_verified_template_zip "$zip" "$extracted"
  [[ -f "$extracted/plugin.json" ]] || { echo 'Downloaded Plugin template did not contain plugin.json.' >&2; exit 1; }
  TEMPLATE="$extracted"
}
TEMPLATE=""
resolve_template

MARKETPLACE_ROOT="$INSTALL_ROOT/marketplace"
PLUGIN_ROOT="$MARKETPLACE_ROOT/plugins/chatgpt-remote-commander"
MANIFEST_DIR="$MARKETPLACE_ROOT/.agents/plugins"
rm -rf "$PLUGIN_ROOT"
mkdir -p "$PLUGIN_ROOT" "$MANIFEST_DIR"
cp -a "$TEMPLATE/." "$PLUGIN_ROOT/"
chmod +x "$PLUGIN_ROOT/bind-app.sh"
"$PLUGIN_ROOT/bind-app.sh" "$APP_ID"

node --input-type=module - "$PLUGIN_ROOT" <<'NODE'
import fs from 'node:fs';
const root=process.argv[2];
const p=root+'/plugin.json';
const manifest=JSON.parse(fs.readFileSync(p,'utf8'));
manifest.extensions['com.openai'].interface.displayName='ChatGPT Remote Commander (Personal)';
manifest.extensions['com.openai'].interface.shortDescription='Use your registered Remote Commander app';
fs.writeFileSync(p,JSON.stringify(manifest,null,2)+'\n');
NODE

cat > "$MANIFEST_DIR/marketplace.json" <<JSON
{
  "name": "$MARKETPLACE_NAME",
  "interface": {"displayName": "ChatGPT Remote Commander (Personal)"},
  "plugins": [{
    "name": "chatgpt-remote-commander",
    "source": {"source": "local", "path": "./plugins/chatgpt-remote-commander"},
    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
    "category": "Productivity"
  }]
}
JSON

codex plugin remove "chatgpt-remote-commander@$MARKETPLACE_NAME" >/dev/null 2>&1 || true
codex plugin marketplace remove "$MARKETPLACE_NAME" >/dev/null 2>&1 || true
codex plugin marketplace add "$MARKETPLACE_ROOT"
codex plugin add "chatgpt-remote-commander@$MARKETPLACE_NAME" --json

node --input-type=module - "$PLUGIN_ROOT" "$APP_ID" <<'NODE'
import fs from 'node:fs';
const [, , root, expected] = process.argv;
const app=JSON.parse(fs.readFileSync(root+'/.app.json','utf8'));
const manifest=JSON.parse(fs.readFileSync(root+'/plugin.json','utf8'));
if(app.apps?.['remote-commander']?.id!==expected) process.exit(2);
if(manifest.extensions?.['com.openai']?.apps!=='./.app.json') process.exit(3);
NODE

echo "WORK_PLUGIN_INSTALL_PASS marketplace=$MARKETPLACE_NAME app=$APP_ID root=$MARKETPLACE_ROOT"
echo 'Restart/reload ChatGPT Desktop or start a fresh Work task so the plugin inventory reloads.'
