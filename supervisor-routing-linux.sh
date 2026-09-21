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

router_source_sha() {
  sha256sum "$ROOT/src/stable-router.mjs" | awk '{print $1}'
}

router_status_body() {
  curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:47831/router/status 2>/dev/null || true
}

router_any_ready() {
  local body
  body="$(router_status_body)"
  [[ "$body" == *'"router":true'* ]]
}

router_ready() {
  local body expected
  body="$(router_status_body)"
  expected="$(router_source_sha)"
  [[ "$body" == *'"router":true'* && "$body" == *"\"sourceSha256\":\"$expected\""* ]]
}

stop_owned_router_default() {
  local runtime="$ROUTING_ROOT/default.runtime.json" route="$ROUTING_ROOT/default.json"
  local pid port host state_file cmd i
  [[ -f "$runtime" && -f "$route" ]] || return 1
  pid="$(node "$ROOT/tools/json-field.mjs" --file "$runtime" --field pid 2>/dev/null || true)"
  port="$(node "$ROOT/tools/json-field.mjs" --file "$runtime" --field port 2>/dev/null || true)"
  host="$(node "$ROOT/tools/json-field.mjs" --file "$runtime" --field host 2>/dev/null || true)"
  state_file="$(node "$ROOT/tools/json-field.mjs" --file "$runtime" --field stateFile 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ && "$port" == 47831 && "$host" == 127.0.0.1 ]] || return 1
  [[ "$(readlink -f "$state_file" 2>/dev/null || true)" == "$(readlink -f "$route")" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 0
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmd" == *"stable-router.mjs"* ]] || return 1
  kill "$pid" 2>/dev/null || return 1
  for i in $(seq 1 40); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null || true
  for i in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  return 1
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
  local route="$ROUTING_ROOT/default.json"
  local router="$ROOT/src/stable-router.mjs"
  [[ -f "$router" ]] || return 1
  if router_any_ready; then
    local old_pid expected current
    old_pid="$(node "$ROOT/tools/json-field.mjs" --file "$ROUTING_ROOT/default.runtime.json" --field pid 2>/dev/null || true)"
    expected="$(router_source_sha)"
    current="$(node "$ROOT/tools/json-field.mjs" --file "$ROUTING_ROOT/default.runtime.json" --field sourceSha256 2>/dev/null || true)"
    log "ROUTER_SOURCE_ACTIVATION_DEFERRED oldPid=$old_pid currentSha=$current expectedSha=$expected"
    return 0
  elif mcp_healthy; then
    log 'ROUTER_CANONICAL_PORT_OCCUPIED_BY_DIRECT_MCP'
    return 1
  fi
  nohup node "$router" --listen-port 47831 --state-file "$route" \
    --runtime-file "$ROUTING_ROOT/default.runtime.json" \
    >>"$STATE_ROOT/router.out.log" 2>>"$STATE_ROOT/router.err.log" &
  for _ in $(seq 1 60); do
    sleep 0.25
    if router_ready; then
      log "ROUTER_READY pid=$! sourceSha=$(router_source_sha)"
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
