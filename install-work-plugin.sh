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

cleanup() {
  [[ -z "$TEMP_TEMPLATE_ROOT" ]] || rm -rf "$TEMP_TEMPLATE_ROOT"
}
trap cleanup EXIT

if [[ "$APP_ID" =~ ^plugin_((asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+)$ ]]; then APP_ID="${BASH_REMATCH[1]}"; fi
[[ "$APP_ID" =~ ^(asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+$ ]] || {
  echo 'AppId must be an app id (asdk_app_/connector_/templated_apps_) or the corresponding plugin_ technical id.' >&2; exit 2;
}
[[ "$MARKETPLACE_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'MarketplaceName contains unsupported characters.' >&2; exit 2; }
command -v codex >/dev/null 2>&1 || { echo 'codex CLI not found' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'node is required' >&2; exit 1; }

resolve_template() {
  if [[ -n "$TEMPLATE_SOURCE" && -f "$TEMPLATE_SOURCE/plugin.json" ]]; then printf '%s\n' "$TEMPLATE_SOURCE"; return; fi
  if [[ -f "$SCRIPT_DIR/plugin-template/plugin.json" ]]; then printf '%s\n' "$SCRIPT_DIR/plugin-template"; return; fi
  TEMP_TEMPLATE_ROOT="$(mktemp -d)"
  local zip="$TEMP_TEMPLATE_ROOT/plugin-template.zip"
  echo 'Local Plugin template not found; downloading latest Release template.' >&2
  command -v curl >/dev/null 2>&1 || { echo 'curl is required to download the Plugin template' >&2; exit 1; }
  curl -fsSL 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/plugin-template.zip' -o "$zip"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$zip" -d "$TEMP_TEMPLATE_ROOT"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$zip" "$TEMP_TEMPLATE_ROOT"
  else
    echo 'unzip or python3 is required to extract the Plugin template' >&2; exit 1
  fi
  [[ -f "$TEMP_TEMPLATE_ROOT/plugin-template/plugin.json" ]] && { printf '%s\n' "$TEMP_TEMPLATE_ROOT/plugin-template"; return; }
  [[ -f "$TEMP_TEMPLATE_ROOT/plugin.json" ]] && { printf '%s\n' "$TEMP_TEMPLATE_ROOT"; return; }
  echo 'Downloaded Plugin template did not contain plugin.json.' >&2; exit 1
}
TEMPLATE="$(resolve_template)"

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
