#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAR_DIR="$ROOT/var"
CFG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
PROFILE_DIR="$CFG_BASE/tunnel-client"
CRED_DIR="$CFG_BASE/chatgpt-remote-commander/credentials"
INTERVAL="${REMOTE_COMMANDER_SUPERVISOR_INTERVAL:-5}"
mkdir -p "$VAR_DIR" "$CRED_DIR"
chmod 700 "$CRED_DIR" 2>/dev/null || true

log() {
  printf '%s %s\n' "$(date --iso-8601=seconds 2>/dev/null || date)" "$*" >> "$VAR_DIR/autostart.log"
}

exec 9>"$VAR_DIR/autostart-linux.lock"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || exit 0
fi

mcp_healthy() {
  curl -fsS --max-time 2 http://127.0.0.1:47831/health 2>/dev/null | grep -q '"ok"[[:space:]]*:[[:space:]]*true'
}

find_tunnel() {
  local f
  f="$(find "$ROOT/tools" -type f -name tunnel-client 2>/dev/null | sort -r | head -n1)"
  if [[ -n "$f" ]]; then printf '%s\n' "$f"; return 0; fi
  command -v tunnel-client
}
start_mcp() {
  mcp_healthy && return 0
  (
    cd "$ROOT"
    nohup npm start --silent >> "$VAR_DIR/mcp-autostart.out.log" 2>> "$VAR_DIR/mcp-autostart.err.log" &
  )
  for _ in $(seq 1 30); do
    sleep 0.5
    if mcp_healthy; then log 'MCP_STARTED'; return 0; fi
  done
  log 'MCP_START_TIMEOUT'
  return 1
}

profile_matches() {
  local file="$1"
  grep -q 'http://127\.0\.0\.1:47831/mcp' "$file"
}

cred_path() {
  local profile="$1"
  local safe
  safe="$(printf '%s' "$profile" | sed 's/[^A-Za-z0-9._-]/_/g')"
  printf '%s/%s.key\n' "$CRED_DIR" "$safe"
}

tunnel_running() {
  local profile="$1"
  pgrep -af 'tunnel-client' 2>/dev/null | grep -E "run[[:space:]]+--profile[[:space:]]+$profile([[:space:]]|$)" >/dev/null 2>&1
}
start_tunnel() {
  local profile="$1" cred="$2" exe log_file
  [[ -f "$cred" ]] || { log "CREDENTIAL_MISSING profile=$profile"; return 0; }
  tunnel_running "$profile" && return 0
  chmod 600 "$cred" 2>/dev/null || true
  exe="$(find_tunnel)" || { log 'TUNNEL_CLIENT_MISSING'; return 1; }
  log_file="$VAR_DIR/tunnel-$(printf '%s' "$profile" | sed 's/[^A-Za-z0-9._-]/_/g').log"
  (
    export CONTROL_PLANE_API_KEY="$(cat "$cred")"
    unset OPENAI_API_KEY || true
    nohup "$exe" run --profile "$profile" --log.file "$log_file" >/dev/null 2>&1 &
  )
  log "TUNNEL_STARTED profile=$profile"
}

log "SUPERVISOR_STARTED pid=$$ root=$ROOT"
while true; do
  if start_mcp; then
    if [[ -d "$PROFILE_DIR" ]]; then
      while IFS= read -r -d '' file; do
        profile_matches "$file" || continue
        profile="$(basename "$file" .yaml)"
        start_tunnel "$profile" "$(cred_path "$profile")" || true
      done < <(find "$PROFILE_DIR" -maxdepth 1 -type f -name '*.yaml' -print0 2>/dev/null)
    fi
  fi
  sleep "$INTERVAL"
done
