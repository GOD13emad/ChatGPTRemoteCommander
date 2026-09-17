#!/usr/bin/env bash
set -euo pipefail
PROFILE="chatgpt-remote-commander"
TUNNEL_ID=""
HEALTH_PORT=0
NO_START=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --tunnel-id) TUNNEL_ID="$2"; shift 2 ;;
    --health-port) HEALTH_PORT="$2"; shift 2 ;;
    --no-start) NO_START=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--profile NAME] [--tunnel-id ID] [--health-port PORT] [--no-start]"
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
PROFILE_DIR="$CFG_BASE/tunnel-client"
PROFILE_FILE="$PROFILE_DIR/$PROFILE.yaml"
CRED_DIR="$CFG_BASE/chatgpt-remote-commander/credentials"
SAFE_PROFILE="$(printf '%s' "$PROFILE" | sed 's/[^A-Za-z0-9._-]/_/g')"
CRED_FILE="$CRED_DIR/$SAFE_PROFILE.key"
MCP_URL='http://127.0.0.1:47831/mcp'
find_tunnel() {
  local f
  f="$(find "$ROOT/tools" -type f -name tunnel-client 2>/dev/null | sort -r | head -n1)"
  if [[ -n "$f" ]]; then printf '%s\n' "$f"; return 0; fi
  command -v tunnel-client
}

free_port() {
  local p
  for p in $(seq 47832 47931); do
    if ! (echo >/dev/tcp/127.0.0.1/$p) >/dev/null 2>&1; then
      printf '%s\n' "$p"; return 0
    fi
  done
  return 1
}

curl -fsS --max-time 3 http://127.0.0.1:47831/health | grep -q '"ok"' || {
  echo 'ChatGPT Remote Commander MCP is not healthy on 127.0.0.1:47831.' >&2
  exit 1
}

TUNNEL_EXE="$(find_tunnel)" || { echo 'tunnel-client not found; run install.sh first.' >&2; exit 1; }
mkdir -p "$CRED_DIR"
chmod 700 "$CRED_DIR"

if [[ ! -f "$PROFILE_FILE" ]]; then
  [[ -n "$TUNNEL_ID" ]] || { read -r -p 'Paste OpenAI tunnel_id: ' TUNNEL_ID; }
  [[ "$TUNNEL_ID" =~ ^tunnel_[A-Za-z0-9_-]+$ ]] || { echo 'Invalid tunnel_id format.' >&2; exit 1; }
  [[ "$HEALTH_PORT" -ne 0 ]] || HEALTH_PORT="$(free_port)"
fi
read -r -s -p 'Paste Runtime API key once (stored in a user-only local file): ' RUNTIME_KEY
echo
[[ -n "$RUNTIME_KEY" ]] || { echo 'Runtime API key is empty.' >&2; exit 1; }
printf '%s' "$RUNTIME_KEY" > "$CRED_FILE"
chmod 600 "$CRED_FILE"

export CONTROL_PLANE_API_KEY="$RUNTIME_KEY"
unset OPENAI_API_KEY || true
if [[ ! -f "$PROFILE_FILE" ]]; then
  "$TUNNEL_EXE" init --sample sample_mcp_remote_no_auth --profile "$PROFILE" \
    --tunnel-id "$TUNNEL_ID" --mcp-server-url "$MCP_URL" \
    --health-listen-addr "127.0.0.1:$HEALTH_PORT" --force
fi
"$TUNNEL_EXE" doctor --profile "$PROFILE" --explain
unset CONTROL_PLANE_API_KEY
RUNTIME_KEY=''

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
  if [[ "$NO_START" -ne 1 ]]; then
    nohup /bin/bash "$ROOT/autostart-linux.sh" >> "$ROOT/var/autostart-launch.log" 2>&1 &
  fi
else
  echo 'Warning: neither systemd user services nor crontab is available; starting supervisor now but boot autostart could not be registered.' >&2
  if [[ "$NO_START" -ne 1 ]]; then
    nohup /bin/bash "$ROOT/autostart-linux.sh" >> "$ROOT/var/autostart-launch.log" 2>&1 &
  fi
fi

echo
echo "AUTOSTART_ENROLL_PASS profile=$PROFILE credential=$CRED_FILE registered=$REGISTERED"
echo 'Future logins do not require the Tunnel ID, health port, or Runtime API key.'
echo 'Linux credential fallback is a local chmod-600 file outside the repository.'
