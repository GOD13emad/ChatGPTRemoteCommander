#!/usr/bin/env bash
# Sourced by autostart-linux.sh. Provides routed backend recovery and auto-update scheduling.

STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/chatgpt-remote-commander"
ROUTING_ROOT="$STATE_ROOT/routing"
NEXT_UPDATE_FILE="$STATE_ROOT/next-update-epoch"
mkdir -p "$ROUTING_ROOT"

route_read_default() {
  local route="$ROUTING_ROOT/default.json"
  [[ -f "$route" ]] || return 1
  node "$ROOT/tools/router-state.mjs" --state "$route" --tsv
}

health_matches() {
  local port="$1" sha="$2" profile="$3" body
  body="$(curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null || true)"
  [[ "$body" == *'"ok":true'* && "$body" == *"\"configSha256\":\"$sha\""* && "$body" == *"\"profile\":\"$profile\""* ]]
}

router_ready() {
  curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:47831/router/status 2>/dev/null | grep -q '"router":true'
}

start_routed_backend() {
  local profile="$1" port="$2" sha="$3" cfg="$4" project="$5"
  health_matches "$port" "$sha" "$profile" && return 0
  mkdir -p "$STATE_ROOT/backend-logs"
  (
    cd "$project"
    REMOTE_COMMANDER_CONFIG="$cfg" nohup node src/server-v0.3.mjs \
      >>"$STATE_ROOT/backend-logs/$profile.out.log" 2>>"$STATE_ROOT/backend-logs/$profile.err.log" &
  )
  for _ in $(seq 1 60); do
    sleep 0.25
    if health_matches "$port" "$sha" "$profile"; then
      log "ROUTED_BACKEND_READY profile=$profile port=$port"
      return 0
    fi
  done
  log "ROUTED_BACKEND_START_TIMEOUT profile=$profile port=$port"
  return 1
}

start_router_default() {
  router_ready && return 0
  if mcp_healthy; then
    log 'ROUTER_CANONICAL_PORT_OCCUPIED_BY_DIRECT_MCP'
    return 1
  fi
  local route="$ROUTING_ROOT/default.json"
  local router="$ROOT/src/stable-router.mjs"
  [[ -f "$router" ]] || return 1
  nohup node "$router" --listen-port 47831 --state-file "$route" \
    --runtime-file "$ROUTING_ROOT/default.runtime.json" \
    >>"$STATE_ROOT/router.out.log" 2>>"$STATE_ROOT/router.err.log" &
  for _ in $(seq 1 60); do
    sleep 0.25
    if router_ready; then
      log "ROUTER_READY pid=$!"
      return 0
    fi
  done
  log 'ROUTER_START_TIMEOUT'
  return 1
}

ensure_routed_default() {
  local line profile generation port version commit sha cfg project
  line="$(route_read_default 2>/dev/null)" || return 1
  IFS=$'\t' read -r profile generation port version commit sha cfg project <<<"$line"
  [[ "$profile" == default && "$port" =~ ^[0-9]+$ && -f "$cfg" && -d "$project" ]] || {
    log 'ROUTE_STATE_INVALID profile=default'
    return 1
  }
  start_routed_backend "$profile" "$port" "$sha" "$cfg" "$project" || return 1
  start_router_default || return 1
  health_matches 47831 "$sha" default || return 1
  return 0
}

active_primary_config() {
  local line profile generation port version commit sha cfg project
  if line="$(route_read_default 2>/dev/null)"; then
    IFS=$'\t' read -r profile generation port version commit sha cfg project <<<"$line"
    [[ -f "$cfg" ]] && { printf '%s\n' "$cfg"; return; }
  fi
  [[ -f "$ROOT/config.local.json" ]] && printf '%s\n' "$ROOT/config.local.json" || printf '%s\n' "$ROOT/config.json"
}

start_auto_update_if_due() {
  local cfg enabled interval now next script
  cfg="$(active_primary_config)"
  enabled="$(node "$ROOT/tools/json-field.mjs" --file "$cfg" --field autoUpdate.enabled 2>/dev/null || true)"
  [[ "$enabled" == true ]] || return 0
  interval="$(node "$ROOT/tools/json-field.mjs" --file "$cfg" --field autoUpdate.intervalMinutes 2>/dev/null || echo 15)"
  [[ "$interval" =~ ^[0-9]+$ && "$interval" -ge 1 ]] || interval=15
  now="$(date +%s)"
  next=0
  [[ -f "$NEXT_UPDATE_FILE" ]] && next="$(cat "$NEXT_UPDATE_FILE" 2>/dev/null || echo 0)"
  [[ "$next" =~ ^[0-9]+$ ]] || next=0
  (( now >= next )) || return 0
  printf '%s\n' "$((now + interval*60))" > "$NEXT_UPDATE_FILE"
  script="$ROOT/auto-update-linux.sh"
  [[ -x "$script" ]] || { log 'AUTO_UPDATE_SCRIPT_MISSING_OR_NOT_EXECUTABLE'; return 0; }
  nohup /bin/bash "$script" --install-dir "$ROOT" >>"$STATE_ROOT/auto-update-launch.log" 2>&1 &
  log "AUTO_UPDATE_CHECK_STARTED pid=$! next=$((now + interval*60))"
}
