#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
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
if command -v flock >/dev/null 2>&1; then flock -n 9 || exit 0; fi

profile_valid() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; }

find_tunnel() {
  local manifest rel expected candidate actual
  manifest="$ROOT/tools/tunnel-client.active.json"
  [[ -f "$manifest" ]] || { log 'TNL_MANIFEST_MISSING'; return 1; }
  rel="$(sed -nE 's/.*"relativePath"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$manifest" | head -n1)"
  expected="$(sed -nE 's/.*"sha256"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$manifest" | head -n1)"
  [[ -n "$rel" && -n "$expected" ]] || { log 'TNL_MANIFEST_INVALID'; return 1; }
  candidate="$(readlink -f "$ROOT/$rel")"
  case "$candidate" in "$ROOT"/*) ;; *) log 'TNL_PATH_ESCAPE'; return 1 ;; esac
  [[ -x "$candidate" ]] || { log 'TNL_CLIENT_MISSING'; return 1; }
  actual="$(sha256sum "$candidate" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || { log 'TNL_HASH_MISMATCH'; return 1; }
  printf '%s\n' "$candidate"
}

expected_version() { sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$ROOT/package.json" | head -n1; }
expected_instance() { printf '%s' "$ROOT" | sha256sum | awk '{print substr($1,1,24)}'; }
expected_config_hash() {
  local cfg="$ROOT/config.json"
  [[ -f "$ROOT/config.local.json" ]] && cfg="$ROOT/config.local.json"
  sha256sum "$cfg" | awk '{print $1}'
}

mcp_health_json() { curl -fsS --max-time 2 http://127.0.0.1:47831/health 2>/dev/null || true; }
mcp_healthy() {
  local h version instance cfg
  h="$(mcp_health_json)"
  version="$(expected_version)"; instance="$(expected_instance)"; cfg="$(expected_config_hash)"
  [[ "$h" == *'"ok":true'* && "$h" == *"\"version\":\"$version\""* && "$h" == *"\"instanceId\":\"$instance\""* && "$h" == *"\"configSha256\":\"$cfg\""* ]]
}

port_47831_listening() {
  if command -v ss >/dev/null 2>&1; then ss -ltnH 'sport = :47831' 2>/dev/null | grep -q .
  elif command -v netstat >/dev/null 2>&1; then netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '[:.]47831$'
  else return 1; fi
}

start_mcp() {
  mcp_healthy && return 0
  if port_47831_listening; then log 'MCP_PORT_OR_IDENTITY_CONFLICT'; return 1; fi
  (cd "$ROOT"; nohup npm start --silent >> "$VAR_DIR/mcp-autostart.out.log" 2>> "$VAR_DIR/mcp-autostart.err.log" &)
  for _ in $(seq 1 30); do sleep 0.5; if mcp_healthy; then log 'MCP_STARTED'; return 0; fi; done
  log 'MCP_START_TIMEOUT'; return 1
}

profile_matches() { grep -q 'http://127\.0\.0\.1:47831/mcp' "$1"; }
profile_port() { sed -nE 's/.*listen_addr:[[:space:]]*"?127\.0\.0\.1:([0-9]+).*/\1/p' "$1" | head -n1; }
cred_path() { printf '%s/%s.key\n' "$CRED_DIR" "$1"; }

tunnel_pid() {
  local profile="$1" exe="$2" pid proc_exe args
  while read -r pid args; do
    [[ -n "$pid" ]] || continue
    proc_exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
    [[ "$proc_exe" == "$exe" ]] || continue
    if [[ "$args" =~ run[[:space:]]+--profile[[:space:]]+"?$profile"?([[:space:]]|$) ]]; then printf '%s\n' "$pid"; return 0; fi
  done < <(ps -eo pid=,args=)
  return 1
}

tunnel_ready() { [[ "$(curl -fsS --max-time 2 "http://127.0.0.1:$1/readyz" 2>/dev/null || true)" == 'ready' ]]; }

start_tunnel() {
  local profile="$1" cred="$2" port="$3" exe="$4" log_file pid
  [[ -f "$cred" ]] || { log "CREDENTIAL_MISSING profile=$profile"; return 0; }
  chmod 600 "$cred" 2>/dev/null || true
  log_file="$VAR_DIR/tunnel-$profile.log"
  (
    export CONTROL_PLANE_API_KEY="$(cat "$cred")"
    unset OPENAI_API_KEY || true
    nohup "$exe" run --profile "$profile" --log.file "$log_file" >/dev/null 2>&1 &
    echo $! > "$VAR_DIR/tunnel-$profile.pid.tmp"
  )
  pid="$(cat "$VAR_DIR/tunnel-$profile.pid.tmp" 2>/dev/null || true)"
  rm -f "$VAR_DIR/tunnel-$profile.pid.tmp"
  for _ in $(seq 1 30); do
    sleep 0.5
    if tunnel_ready "$port"; then log "TUNNEL_STARTED profile=$profile pid=$pid"; return 0; fi
    [[ -z "$pid" || -d "/proc/$pid" ]] || { log "TUNNEL_EXITED profile=$profile"; return 1; }
  done
  [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  log "TUNNEL_READY_TIMEOUT profile=$profile"
  return 1
}

declare -A NOT_READY_SINCE
log "SUPERVISOR_STARTED pid=$$ instance=$(expected_instance)"
while true; do
  if start_mcp; then
    EXE="$(find_tunnel 2>/dev/null || true)"
    if [[ -n "$EXE" && -d "$PROFILE_DIR" ]]; then
      while IFS= read -r -d '' file; do
        profile_matches "$file" || continue
        profile="$(basename "$file" .yaml)"
        profile_valid "$profile" || { log "PROFILE_REJECTED profile=$profile"; continue; }
        port="$(profile_port "$file")"
        [[ "$port" =~ ^[0-9]+$ && "$port" -gt 0 ]] || { log "PROFILE_PORT_INVALID profile=$profile"; continue; }
        cred="$(cred_path "$profile")"
        [[ -f "$cred" ]] || { log "CREDENTIAL_MISSING profile=$profile"; continue; }
        pid="$(tunnel_pid "$profile" "$EXE" 2>/dev/null || true)"
        if [[ -n "$pid" ]] && tunnel_ready "$port"; then unset 'NOT_READY_SINCE[$profile]'; continue; fi
        if [[ -n "$pid" ]]; then
          now="$(date +%s)"; since="${NOT_READY_SINCE[$profile]:-$now}"; NOT_READY_SINCE[$profile]="$since"
          if (( now - since < 30 )); then continue; fi
          log "TUNNEL_STUCK_RESTART profile=$profile pid=$pid"
          kill "$pid" 2>/dev/null || true
          unset 'NOT_READY_SINCE[$profile]'
        fi
        start_tunnel "$profile" "$cred" "$port" "$EXE" || true
      done < <(find "$PROFILE_DIR" -maxdepth 1 -type f -name '*.yaml' -print0 2>/dev/null)
    fi
  fi
  sleep "$INTERVAL"
done
