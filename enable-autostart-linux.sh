#!/usr/bin/env bash
set -euo pipefail

PROFILE="chatgpt-remote-commander"
TUNNEL_ID=""
HEALTH_PORT=0
NO_START=0
SUCCESS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --tunnel-id) TUNNEL_ID="$2"; shift 2 ;;
    --health-port) HEALTH_PORT="$2"; shift 2 ;;
    --no-start) NO_START=1; shift ;;
    -h|--help) echo "Usage: $0 [--profile NAME] [--tunnel-id ID] [--health-port PORT] [--no-start]"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$PROFILE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || { echo 'Invalid profile name.' >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
PROFILE_DIR="$CFG_BASE/tunnel-client"
PROFILE_FILE="$PROFILE_DIR/$PROFILE.yaml"
CRED_DIR="$CFG_BASE/chatgpt-remote-commander/credentials"
CRED_FILE="$CRED_DIR/$PROFILE.key"
MCP_URL='http://127.0.0.1:47831/mcp'

find_tunnel() {
  local manifest rel expected candidate actual
  manifest="$ROOT/tools/tunnel-client.active.json"
  [[ -f "$manifest" ]] || { echo 'Pinned tunnel-client manifest missing; rerun install.sh.' >&2; return 1; }
  rel="$(sed -nE 's/.*"relativePath"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$manifest" | head -n1)"
  expected="$(sed -nE 's/.*"sha256"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$manifest" | head -n1)"
  [[ -n "$rel" && -n "$expected" ]] || { echo 'Invalid tunnel-client manifest.' >&2; return 1; }
  candidate="$(readlink -f "$ROOT/$rel")"
  case "$candidate" in "$ROOT"/*) ;; *) echo 'Pinned tunnel-client path escapes install root.' >&2; return 1 ;; esac
  [[ -x "$candidate" ]] || { echo 'Pinned tunnel-client executable missing.' >&2; return 1; }
  actual="$(sha256sum "$candidate" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || { echo 'Pinned tunnel-client hash mismatch.' >&2; return 1; }
  printf '%s\n' "$candidate"
}

free_port() {
  local p
  for p in $(seq 47832 47931); do
    if ! (echo >/dev/tcp/127.0.0.1/$p) >/dev/null 2>&1; then printf '%s\n' "$p"; return 0; fi
  done
  return 1
}

mcp_healthy() {
  curl -fsS --max-time 2 http://127.0.0.1:47831/health 2>/dev/null | grep -q '"ok"[[:space:]]*:[[:space:]]*true'
}

ensure_mcp() {
  mcp_healthy && return 0
  mkdir -p "$ROOT/var"
  (cd "$ROOT"; nohup npm start --silent >> "$ROOT/var/mcp-connect.out.log" 2>> "$ROOT/var/mcp-connect.err.log" &)
  for _ in $(seq 1 30); do
    sleep 0.5
    if mcp_healthy; then echo 'MCP was not running; it has been started automatically.'; return 0; fi
  done
  echo 'Remote Commander MCP did not become healthy on 127.0.0.1:47831.' >&2
  return 1
}

read_profile_port() {
  sed -nE 's/.*listen_addr:[[:space:]]*"?127\.0\.0\.1:([0-9]+).*/\1/p' "$1" | head -n1
}

read_profile_tunnel() {
  grep -oE 'tunnel_[A-Za-z0-9_-]+' "$1" | head -n1 || true
}

ensure_mcp
TUNNEL_EXE="$(find_tunnel)"
mkdir -p "$PROFILE_DIR" "$CRED_DIR"
chmod 700 "$CRED_DIR"

PROFILE_EXISTS=0
PROFILE_CREATED=0
[[ -f "$PROFILE_FILE" ]] && PROFILE_EXISTS=1

if [[ "$PROFILE_EXISTS" -eq 1 ]]; then
  grep -q 'http://127\.0\.0\.1:47831/mcp' "$PROFILE_FILE" || { echo 'Existing profile targets a different MCP.' >&2; exit 1; }
  EXISTING_PORT="$(read_profile_port "$PROFILE_FILE")"
  [[ -n "$EXISTING_PORT" ]] || { echo 'Existing profile health port is invalid.' >&2; exit 1; }
  if [[ "$HEALTH_PORT" -ne 0 && "$HEALTH_PORT" -ne "$EXISTING_PORT" ]]; then echo 'Requested health port does not match existing profile.' >&2; exit 1; fi
  HEALTH_PORT="$EXISTING_PORT"
  EXISTING_TUNNEL="$(read_profile_tunnel "$PROFILE_FILE")"
  if [[ -n "$TUNNEL_ID" ]]; then
    [[ -n "$EXISTING_TUNNEL" ]] || { echo 'Existing profile tunnel ID cannot be verified.' >&2; exit 1; }
    [[ "$TUNNEL_ID" == "$EXISTING_TUNNEL" ]] || { echo 'Requested tunnel ID does not match existing profile.' >&2; exit 1; }
  fi
else
  [[ -n "$TUNNEL_ID" ]] || read -r -p 'Paste OpenAI tunnel_id: ' TUNNEL_ID
  [[ "$TUNNEL_ID" =~ ^tunnel_[A-Za-z0-9_-]+$ ]] || { echo 'Invalid tunnel_id format.' >&2; exit 1; }
  [[ "$HEALTH_PORT" -ne 0 ]] || HEALTH_PORT="$(free_port)"
fi

NEW_CRED=0
if [[ -f "$CRED_FILE" ]]; then
  RUNTIME_KEY="$(cat "$CRED_FILE")"
  echo "Reusing existing local credential for profile $PROFILE."
else
  NEW_CRED=1
  read -r -s -p 'Paste Runtime API key once (saved only after validation succeeds): ' RUNTIME_KEY
  echo
fi
[[ -n "$RUNTIME_KEY" ]] || { echo 'Runtime API key is empty.' >&2; exit 1; }

cleanup() {
  unset CONTROL_PLANE_API_KEY RUNTIME_KEY || true
  if [[ "$PROFILE_CREATED" -eq 1 && "$SUCCESS" -ne 1 ]]; then rm -f "$PROFILE_FILE"; fi
}
trap cleanup EXIT
export CONTROL_PLANE_API_KEY="$RUNTIME_KEY"
unset OPENAI_API_KEY || true

if [[ "$PROFILE_EXISTS" -eq 0 ]]; then
  "$TUNNEL_EXE" init --sample sample_mcp_remote_no_auth --profile "$PROFILE" --tunnel-id "$TUNNEL_ID" --mcp-server-url "$MCP_URL" --health-listen-addr "127.0.0.1:$HEALTH_PORT" --force
  PROFILE_CREATED=1
  CREATED_PORT="$(read_profile_port "$PROFILE_FILE")"
  [[ "$CREATED_PORT" == "$HEALTH_PORT" ]] || { echo 'Created profile health port mismatch.' >&2; exit 1; }
  CREATED_TUNNEL="$(read_profile_tunnel "$PROFILE_FILE")"
  if [[ -n "$CREATED_TUNNEL" ]]; then [[ "$CREATED_TUNNEL" == "$TUNNEL_ID" ]] || { echo 'Created profile tunnel ID mismatch.' >&2; exit 1; }; fi
fi

READY=0
if [[ "$(curl -fsS --max-time 2 "http://127.0.0.1:$HEALTH_PORT/readyz" 2>/dev/null || true)" == 'ready' ]]; then READY=1; fi
if [[ "$READY" -eq 1 ]]; then
  echo "Existing tunnel profile $PROFILE is already ready on health port $HEALTH_PORT; doctor bind check skipped."
else
  "$TUNNEL_EXE" doctor --profile "$PROFILE" --explain
fi

if [[ "$NEW_CRED" -eq 1 ]]; then
  umask 077
  TEMP_CRED="$CRED_FILE.tmp.$$"
  printf '%s' "$RUNTIME_KEY" > "$TEMP_CRED"
  chmod 600 "$TEMP_CRED"
  mv "$TEMP_CRED" "$CRED_FILE"
  echo "Credential committed after successful validation for profile $PROFILE."
fi

SUCCESS=1
unset CONTROL_PLANE_API_KEY RUNTIME_KEY
trap - EXIT

chmod +x "$ROOT/autostart-linux.sh"
UNIT_DIR="$CFG_BASE/systemd/user"
UNIT_FILE="$UNIT_DIR/chatgpt-remote-commander.service"
REGISTERED=0
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=ChatGPT Remote Commander supervisor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash $ROOT/autostart-linux.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable chatgpt-remote-commander.service >/dev/null
  [[ "$NO_START" -eq 1 ]] || systemctl --user restart chatgpt-remote-commander.service
  REGISTERED=1
elif command -v crontab >/dev/null 2>&1; then
  LINE="@reboot /bin/bash '$ROOT/autostart-linux.sh' >> '$ROOT/var/autostart-launch.log' 2>&1 &"
  { crontab -l 2>/dev/null | grep -v 'autostart-linux.sh' || true; echo "$LINE"; } | crontab -
  REGISTERED=1
  [[ "$NO_START" -eq 1 ]] || nohup /bin/bash "$ROOT/autostart-linux.sh" >> "$ROOT/var/autostart-launch.log" 2>&1 &
else
  echo 'Warning: no systemd user service or crontab; supervisor can only be started for this session.' >&2
  [[ "$NO_START" -eq 1 ]] || nohup /bin/bash "$ROOT/autostart-linux.sh" >> "$ROOT/var/autostart-launch.log" 2>&1 &
fi

echo
echo "AUTOSTART_ENROLL_PASS profile=$PROFILE healthPort=$HEALTH_PORT credential=$CRED_FILE registered=$REGISTERED"
echo 'Future logins do not require the Tunnel ID, health port, or Runtime API key.'
