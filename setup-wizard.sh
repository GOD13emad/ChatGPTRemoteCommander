#!/usr/bin/env bash
set -euo pipefail
MODE="standard"
MODE_SET=0
GUI=0
SKIP_PREREQS=0
SKIP_INSTALL=0
SKIP_CONNECT=0
SKIP_PLUGIN=0
TUNNEL_ID=""
APP_ID=""
PROFILE="chatgpt-remote-commander"
DEVICE_NAME="${HOSTNAME:-$(hostname 2>/dev/null || echo device)}"
PLUGIN_OUTPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --power-mode) MODE="power"; MODE_SET=1; shift ;;
    --standard-mode) MODE="standard"; MODE_SET=1; shift ;;
    --gui-control) GUI=1; shift ;;
    --skip-prerequisites) SKIP_PREREQS=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --skip-connect) SKIP_CONNECT=1; shift ;;
    --skip-plugin) SKIP_PLUGIN=1; shift ;;
    --tunnel-id) TUNNEL_ID="$2"; shift 2 ;;
    --app-id) APP_ID="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --device-name) DEVICE_NAME="$2"; shift 2 ;;
    --plugin-output-directory) PLUGIN_OUTPUT="$2"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: setup-wizard.sh [--standard-mode|--power-mode] [--gui-control]
  [--skip-prerequisites] [--skip-install] [--skip-connect] [--skip-plugin]
  [--tunnel-id ID] [--app-id ID] [--profile NAME] [--device-name NAME]
  [--plugin-output-directory DIR]
EOF
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ "$MODE_SET" -eq 0 && -t 0 ]]; then
  echo 'Choose installation mode:'
  echo '  1) Standard — restricted project/file access'
  echo '  2) Full / Power — trusted-machine shell/filesystem/process access'
  echo '  3) Full / Power + GUI — also enable guarded desktop control'
  read -r -p 'Mode [1]: ' choice
  case "${choice:-1}" in
    2) MODE="power" ;;
    3) MODE="power"; GUI=1 ;;
    *) MODE="standard" ;;
  esac
fi
[[ "$GUI" -eq 0 || "$MODE" == "power" ]] || { echo '--gui-control requires --power-mode' >&2; exit 2; }

STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/chatgpt-remote-commander"
INSTALL_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/ChatGPTRemoteCommander"
WIZARD_STATE="$STATE_ROOT/onboarding"
mkdir -p "$WIZARD_STATE"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || pwd)"
TMP=""

cleanup(){ [[ -z "$TMP" ]] || rm -rf "$TMP"; }
trap cleanup EXIT

resolve_installer(){
  if [[ -f "$SCRIPT_DIR/install.sh" ]]; then printf '%s\n' "$SCRIPT_DIR/install.sh"; return; fi
  TMP="$(mktemp -d)"
  local base='https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download'
  command -v curl >/dev/null 2>&1 || { echo 'curl is required' >&2; exit 1; }
  curl -fsSL --connect-timeout 15 --max-time 180 "$base/install.sh" -o "$TMP/install.sh"
  curl -fsSL --connect-timeout 15 --max-time 180 "$base/SHA256SUMS.txt" -o "$TMP/SHA256SUMS.txt"
  local expected actual
  expected="$(awk '$2=="install.sh"{print $1;exit}' "$TMP/SHA256SUMS.txt")"
  [[ -n "$expected" ]] || { echo 'Latest checksum manifest does not list install.sh.' >&2; exit 1; }
  actual="$(sha256sum "$TMP/install.sh" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || { echo 'Downloaded install.sh checksum mismatch.' >&2; exit 1; }
  chmod +x "$TMP/install.sh"
  printf '%s\n' "$TMP/install.sh"
}

echo "Remote Commander setup wizard — device=$DEVICE_NAME profile=$PROFILE mode=$MODE"
if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  INSTALLER="$(resolve_installer)"
  args=(--start-server)
  [[ "$SKIP_PREREQS" -eq 1 ]] || args+=(--install-prerequisites)
  [[ "$MODE" == "power" ]] && args+=(--power-mode)
  "$INSTALLER" "${args[@]}"
fi
[[ -f "$INSTALL_ROOT/package.json" ]] || { echo "Installed Remote Commander not found at $INSTALL_ROOT" >&2; exit 1; }

HEALTH="$(curl -fsS --max-time 4 http://127.0.0.1:47831/health)"
HEALTH="$HEALTH" node --input-type=module <<'NODE'
const j=JSON.parse(process.env.HEALTH); if(!j.ok) process.exit(2);
NODE

if [[ "$SKIP_CONNECT" -eq 0 ]]; then
  connect="$INSTALL_ROOT/enable-autostart-linux.sh"
  [[ -x "$connect" || -f "$connect" ]] || { echo 'Installed enable-autostart-linux.sh is missing.' >&2; exit 1; }
  echo
  echo 'Tunnel enrollment follows. Runtime API key entry stays in the local hidden prompt and is never written into the Plugin ZIP.'
  args=(--profile "$PROFILE")
  [[ -z "$TUNNEL_ID" ]] || args+=(--tunnel-id "$TUNNEL_ID")
  bash "$connect" "${args[@]}"
fi

PROFILE_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/tunnel-client/$PROFILE.yaml"
HEALTH_PORT=0
if [[ -f "$PROFILE_FILE" ]]; then
  HEALTH_PORT="$(sed -nE 's/.*listen_addr:[[:space:]]*"?127\.0\.0\.1:([0-9]+).*/\1/p' "$PROFILE_FILE" | head -n1)"
  HEALTH_PORT="${HEALTH_PORT:-0}"
fi
TUNNEL_READY=false
if [[ "$HEALTH_PORT" -gt 0 ]] && [[ "$(curl -fsS --max-time 3 "http://127.0.0.1:$HEALTH_PORT/readyz" 2>/dev/null || true)" == "ready" ]]; then
  TUNNEL_READY=true
fi

PLUGIN_STATUS="SKIPPED"
PLUGIN_JSON=""
if [[ "$SKIP_PLUGIN" -eq 0 ]]; then
  echo
  echo "Suggested ChatGPT custom app name: Remote Commander · $DEVICE_NAME"
  echo 'Create/verify the custom app with Connection=Tunnel, run Scan Tools, then use its exact App ID.'
  if [[ -z "$APP_ID" && -t 0 ]]; then
    read -r -p 'Paste the registered App ID (asdk_app_/connector_/templated_apps_ or plugin_ technical id), or press Enter to finish later: ' APP_ID
  fi
  if [[ -n "$APP_ID" ]]; then
    builder="$INSTALL_ROOT/build-device-plugin.sh"
    [[ -f "$builder" ]] || { echo 'Installed build-device-plugin.sh is missing; update Remote Commander.' >&2; exit 1; }
    args=(--app-id "$APP_ID" --device-name "$DEVICE_NAME" --profile "$PROFILE")
    [[ -z "$PLUGIN_OUTPUT" ]] || args+=(--output-directory "$PLUGIN_OUTPUT")
    PLUGIN_JSON="$(bash "$builder" "${args[@]}" | tee /dev/stderr | awk '/^\{/{line=$0} END{print line}')"
    PLUGIN_STATUS="READY"
  else
    PLUGIN_STATUS="WAITING_APP_ID"
  fi
fi

VERSION="$(HEALTH="$HEALTH" node --input-type=module <<'NODE'
const j=JSON.parse(process.env.HEALTH); process.stdout.write(String(j.version||''));
NODE
)"
PLUGIN_STATUS="$PLUGIN_STATUS" PLUGIN_JSON="$PLUGIN_JSON" VERSION="$VERSION" DEVICE_NAME="$DEVICE_NAME" PROFILE="$PROFILE" MODE="$MODE" TUNNEL_READY="$TUNNEL_READY" node --input-type=module - "$WIZARD_STATE/latest.json" <<'NODE'
import fs from 'node:fs';
const plugin=process.env.PLUGIN_JSON ? JSON.parse(process.env.PLUGIN_JSON) : null;
const state={
  schema:1,
  completedAt:new Date().toISOString(),
  platform:'linux',
  deviceName:process.env.DEVICE_NAME,
  profile:process.env.PROFILE,
  mode:process.env.MODE==='power'?'FULL_POWER':'STANDARD',
  version:process.env.VERSION,
  mcpHealthy:true,
  tunnelReady:process.env.TUNNEL_READY==='true',
  pluginStatus:process.env.PLUGIN_STATUS,
  pluginName:plugin?.pluginName??null,
  pluginZip:plugin?.zip??null,
  pluginSha256:plugin?.zipSha256??null,
  secretsPersistedInWizardState:false,
  rebootPerformed:false
};
fs.writeFileSync(process.argv[2],JSON.stringify(state,null,2)+'\n');
NODE

echo
echo "SETUP_MACHINE_PASS version=$VERSION mcp=true tunnel=$TUNNEL_READY mode=${MODE^^}"
if [[ "$PLUGIN_STATUS" == "READY" ]]; then
  echo 'SETUP_FINAL_PASS plugin ZIP generated.'
elif [[ "$PLUGIN_STATUS" == "WAITING_APP_ID" ]]; then
  echo 'SETUP_WAITING_APP_ID machine/tunnel are ready. After ChatGPT creates/scans the custom app, rerun with --skip-install --skip-connect --app-id "<APP_ID>".'
fi
