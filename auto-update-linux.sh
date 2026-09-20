#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/.local/share/ChatGPTRemoteCommander"
SOURCE_REF=""
EXPECTED_COMMIT=""
FORCE=0
POWER_MODE=0
STANDARD_MODE=0
NO_PROMOTE=0
SELF_TEST=0
DRAIN_TIMEOUT=60
DISABLE_CAPS=()
ENABLE_CAPS=()
REPO_URL="${REMOTE_COMMANDER_REPO_URL:-https://github.com/GOD13emad/ChatGPTRemoteCommander.git}"
CURL_CONNECT_TIMEOUT="${REMOTE_COMMANDER_CURL_CONNECT_TIMEOUT:-15}"
CURL_MAX_TIME="${REMOTE_COMMANDER_CURL_MAX_TIME:-180}"
STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/chatgpt-remote-commander"
RELEASE_ROOT="$STATE_ROOT/releases"
ROUTING_ROOT="$STATE_ROOT/routing"
RUNTIME_ROOT="$STATE_ROOT/runtimes"
BACKUP_ROOT="$STATE_ROOT/update-backups"
LOG_DIR="$STATE_ROOT/update-logs"
RESULT_FILE="$STATE_ROOT/last-update.json"
PROFILE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/tunnel-client"

usage(){
  cat <<'USAGE'
Usage: auto-update-linux.sh [options]
  --install-dir PATH
  --source-ref REF
  --expected-commit SHA
  --force
  --power-mode | --standard-mode
  --disable-capability CAP   Repeatable explicit opt-out
  --enable-capability CAP    Repeatable explicit opt-in
  --no-promote
  --self-test
  --drain-timeout SECONDS
USAGE
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2;;
    --source-ref) SOURCE_REF="$2"; shift 2;;
    --expected-commit) EXPECTED_COMMIT="$2"; shift 2;;
    --force) FORCE=1; shift;;
    --power-mode) POWER_MODE=1; shift;;
    --standard-mode) STANDARD_MODE=1; shift;;
    --disable-capability) DISABLE_CAPS+=("$2"); shift 2;;
    --enable-capability) ENABLE_CAPS+=("$2"); shift 2;;
    --no-promote) NO_PROMOTE=1; shift;;
    --self-test) SELF_TEST=1; shift;;
    --drain-timeout) DRAIN_TIMEOUT="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2;;
  esac
done
[[ "$POWER_MODE" == 0 || "$STANDARD_MODE" == 0 ]] || { echo 'power/standard modes are mutually exclusive' >&2; exit 2; }
[[ -z "$SOURCE_REF" || "$SOURCE_REF" =~ ^[A-Za-z0-9._/-]{1,128}$ ]] || { echo 'invalid source ref' >&2; exit 2; }
[[ -z "$EXPECTED_COMMIT" || "$EXPECTED_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || { echo 'invalid expected commit' >&2; exit 2; }
[[ "$DRAIN_TIMEOUT" =~ ^[1-9][0-9]{0,2}$ ]] || { echo 'invalid drain timeout' >&2; exit 2; }

INSTALL_DIR="$(cd "$INSTALL_DIR" 2>/dev/null && pwd -P || printf '%s' "$INSTALL_DIR")"
mkdir -p "$RELEASE_ROOT" "$ROUTING_ROOT" "$RUNTIME_ROOT" "$BACKUP_ROOT" "$LOG_DIR"

log(){ printf '%s %s\n' "$(date --iso-8601=seconds 2>/dev/null || date)" "$*" >> "$LOG_DIR/auto-update.log"; [[ "$SELF_TEST" == 1 ]] || printf '%s\n' "$*"; }
curl_fetch(){ curl --fail --silent --show-error --location --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" "$@"; }
json_field(){ node "$1/tools/json-field.mjs" --file "$2" --field "$3" 2>/dev/null || true; }
route_tsv(){ node "$1/tools/router-state.mjs" --state "$2" --tsv; }

wait_health(){
  local port="$1" version="$2" sha="$3" profile="$4" i body
  for i in $(seq 1 80); do
    body="$(curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null || true)"
    if [[ "$body" == *'"ok":true'* && "$body" == *"\"version\":\"$version\""* && "$body" == *"\"configSha256\":\"$sha\""* && "$body" == *"\"profile\":\"$profile\""* ]]; then return 0; fi
    sleep 0.25
  done
  return 1
}
start_backend(){
  local project="$1" cfg="$2" log_file="$3"
  mkdir -p "$(dirname "$log_file")"
  (cd "$project"; REMOTE_COMMANDER_CONFIG="$cfg" nohup node src/server-v0.3.mjs >>"$log_file" 2>&1 & echo $!)
}
stop_pid(){ local pid="$1"; kill "$pid" 2>/dev/null || true; for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.1; done; kill -9 "$pid" 2>/dev/null || true; }
run_gate(){ local project="$1" name="$2"; shift 2; log "GATE_START $name"; (cd "$project"; "$@"); log "GATE_PASS $name"; }

latest_ref(){
  if [[ -n "$SOURCE_REF" ]]; then printf '%s\n' "$SOURCE_REF"; return; fi
  local body tag
  body="$(curl_fetch -H 'User-Agent: ChatGPTRemoteCommander-Updater' https://api.github.com/repos/GOD13emad/ChatGPTRemoteCommander/releases/latest)"
  tag="$(printf '%s' "$body" | sed -nE 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n1)"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'latest release tag invalid' >&2; return 1; }
  printf '%s\n' "$tag"
}

stage_release(){
  local ref="$1" tmp resolved version final head
  tmp="$RELEASE_ROOT/stage-$(printf '%s' "$ref" | tr -c 'A-Za-z0-9._-' '_')-$$"
  rm -rf "$tmp"; mkdir -p "$tmp"
  git -C "$tmp" init >/dev/null
  git -C "$tmp" remote add origin "$REPO_URL"
  git -C "$tmp" fetch --depth 1 --no-tags origin "$ref"
  resolved="$(git -C "$tmp" rev-parse 'FETCH_HEAD^{commit}')"
  [[ "$resolved" =~ ^[0-9a-f]{40}$ ]] || { echo 'stage commit invalid' >&2; return 1; }
  if [[ -n "$EXPECTED_COMMIT" && "${resolved,,}" != "${EXPECTED_COMMIT,,}" ]]; then echo 'stage expected commit mismatch' >&2; return 1; fi
  git -C "$tmp" checkout --detach "$resolved" >/dev/null
  version="$(node "$tmp/tools/json-field.mjs" --file "$tmp/package.json" --field version)"
  if [[ "$ref" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ && "${BASH_REMATCH[1]}" != "$version" ]]; then echo 'stage tag/version mismatch' >&2; return 1; fi
  final="$RELEASE_ROOT/v${version}-${resolved:0:12}"
  if [[ -d "$final" ]]; then
    head="$(git -C "$final" rev-parse HEAD 2>/dev/null || true)"
    [[ "$head" == "$resolved" ]] || { echo 'release directory collision' >&2; return 1; }
    rm -rf "$tmp"
  else
    mv "$tmp" "$final"
  fi
  printf '%s\t%s\t%s\n' "$resolved" "$version" "$final"
}

active_config(){
  local helper="$1" route="$ROUTING_ROOT/default.json"
  if [[ -f "$route" ]]; then
    local p g port v c sha cfg project
    IFS=$'\t' read -r p g port v c sha cfg project < <(route_tsv "$helper" "$route")
    [[ -f "$cfg" ]] && { printf '%s\n' "$cfg"; return; }
  fi
  [[ -f "$INSTALL_DIR/config.local.json" ]] && printf '%s\n' "$INSTALL_DIR/config.local.json" || printf '%s\n' "$INSTALL_DIR/config.json"
}

tunnels_ready(){
  [[ -d "$PROFILE_DIR" ]] || return 0
  local file raw hp
  while IFS= read -r -d '' file; do
    raw="$(cat "$file")"
    [[ "$raw" == *'http://127.0.0.1:47831/mcp'* ]] || continue
    hp="$(printf '%s' "$raw" | sed -nE 's/.*listen_addr:[[:space:]]*["'\'']?127\.0\.0\.1:([0-9]+).*/\1/p' | head -n1)"
    [[ -n "$hp" ]] || continue
    [[ "$(curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:$hp/readyz" 2>/dev/null || true)" == ready ]] || return 1
  done < <(find "$PROFILE_DIR" -maxdepth 1 -type f -name '*.yaml' -print0 2>/dev/null)
}

stop_owned_from_config(){
  local helper="$1" cfg="$2" expected_project="${3:-}" marker pid project cwd
  marker="$(json_field "$helper" "$cfg" runtimeState)"
  [[ -n "$marker" ]] || marker="$INSTALL_DIR/var/mcp-runtime.json"
  [[ -f "$marker" ]] || return 0
  pid="$(json_field "$helper" "$marker" pid)"
  project="$(json_field "$helper" "$marker" projectDir)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 0
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ -z "$expected_project" || "$cwd" == "$(readlink -f "$expected_project")" || "$project" == "$expected_project" ]] || { echo 'owned backend identity mismatch' >&2; return 1; }
  stop_pid "$pid"
}

start_router(){
  local project="$1" route="$2" log_file="$3"
  (cd "$project"; nohup node src/stable-router.mjs --listen-port 47831 --state-file "$route" --runtime-file "$ROUTING_ROOT/default.runtime.json" >>"$log_file" 2>&1 & echo $!)
}
wait_router(){
  for _ in $(seq 1 80); do
    curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:47831/router/status 2>/dev/null | grep -q '"router":true' && return 0
    sleep 0.25
  done
  return 1
}

recycle_supervisor(){
  local had=0 pid
  if command -v systemctl >/dev/null 2>&1 && systemctl --user is-enabled chatgpt-remote-commander.service >/dev/null 2>&1; then
    systemctl --user daemon-reload
    systemctl --user restart chatgpt-remote-commander.service
    log 'SUPERVISOR_RECYCLE_PASS mode=systemd'
    return 0
  fi
  while read -r pid; do
    [[ -n "$pid" && "$pid" != "$$" ]] || continue
    had=1; kill "$pid" 2>/dev/null || true
  done < <(pgrep -f "/bin/bash $INSTALL_DIR/autostart-linux.sh|bash $INSTALL_DIR/autostart-linux.sh" 2>/dev/null || true)
  if [[ "$had" == 1 ]]; then
    nohup /bin/bash "$INSTALL_DIR/autostart-linux.sh" >>"$INSTALL_DIR/var/autostart-launch.log" 2>&1 &
    log "SUPERVISOR_RECYCLE_PASS mode=process pid=$!"
  fi
}

promote_control(){
  local commit="$1" ref="$2" dirty resolved
  dirty="$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=no)"
  [[ -z "$dirty" ]] || { echo 'control tracked dirty' >&2; return 1; }
  git -C "$INSTALL_DIR" fetch --no-tags origin "$ref"
  resolved="$(git -C "$INSTALL_DIR" rev-parse 'FETCH_HEAD^{commit}')"
  [[ "$resolved" == "$commit" ]] || { echo 'control commit mismatch' >&2; return 1; }
  git -C "$INSTALL_DIR" checkout --detach --force "$commit" >/dev/null
}

cleanup_releases(){
  local route="$ROUTING_ROOT/default.json" active="" d
  [[ -f "$route" ]] && active="$(route_tsv "$INSTALL_DIR" "$route" 2>/dev/null | awk -F '\t' '{print $8}')"
  for d in "$RELEASE_ROOT"/v*; do
    [[ -d "$d" ]] || continue
    [[ -n "$active" && "$(readlink -f "$d")" == "$(readlink -f "$active")" ]] || rm -rf "$d"
  done
}

mkdir -p "$INSTALL_DIR/var"
exec 9>"$STATE_ROOT/auto-update.lock"
if command -v flock >/dev/null 2>&1; then flock -n 9 || { log 'AUTO_UPDATE_ALREADY_RUNNING'; exit 0; }; fi

if [[ "$SELF_TEST" == 1 ]]; then
  printf '{"ok":true,"installDir":"%s","stateRoot":"%s"}\n' "$INSTALL_DIR" "$STATE_ROOT"
  exit 0
fi

REF="$(latest_ref)"
IFS=$'\t' read -r COMMIT VERSION STAGE_DIR < <(stage_release "$REF")
ACTIVE_CFG="$(active_config "$STAGE_DIR")"
AUTO_ENABLED="$(json_field "$STAGE_DIR" "$ACTIVE_CFG" autoUpdate.enabled)"
if [[ "$FORCE" != 1 && "$AUTO_ENABLED" != true ]]; then log 'AUTO_UPDATE_DISABLED'; exit 0; fi

ROUTE="$ROUTING_ROOT/default.json"
if [[ "$FORCE" != 1 && -f "$ROUTE" ]]; then
  IFS=$'\t' read -r _ _ _ _ ACTIVE_COMMIT _ _ _ < <(route_tsv "$STAGE_DIR" "$ROUTE")
  if [[ "$ACTIVE_COMMIT" == "$COMMIT" ]]; then
    CONTROL="$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || true)"
    if [[ "$CONTROL" != "$COMMIT" ]]; then
      LIVE_WF="$(json_field "$STAGE_DIR" "$ACTIVE_CFG" durableWorkflows.directory)"
      [[ -z "$LIVE_WF" ]] || node "$STAGE_DIR/tools/finalize-workflow-schema.mjs" --directory "$LIVE_WF"
      promote_control "$COMMIT" "$REF"
      recycle_supervisor
      cleanup_releases
      log "AUTO_UPDATE_MAINTENANCE_PASS version=$VERSION"
      exit 0
    fi
    cleanup_releases
    log "AUTO_UPDATE_CURRENT version=$VERSION"
    exit 0
  fi
fi

run_gate "$STAGE_DIR" check npm run check
run_gate "$STAGE_DIR" test npm test
run_gate "$STAGE_DIR" audit npm run audit

PORT="$(node "$STAGE_DIR/tools/find-free-port.mjs" --start 48831 --end 51999)"
STATE_DIR="$RUNTIME_ROOT/$COMMIT/default"
mkdir -p "$STATE_DIR" "$BACKUP_ROOT/$COMMIT/default"
cp -f "$ACTIVE_CFG" "$BACKUP_ROOT/$COMMIT/default/config.before.json"
LIVE_WF="$(json_field "$STAGE_DIR" "$ACTIVE_CFG" durableWorkflows.directory)"
[[ -n "$LIVE_WF" ]] || LIVE_WF="$STATE_ROOT/instances/default/workflows"
SHADOW_WF="$BACKUP_ROOT/$COMMIT/default/workflow-shadow"
node "$STAGE_DIR/tools/copy-workflow-store.mjs" --source-dir "$LIVE_WF" --dest-dir "$SHADOW_WF"

MODE=preserve
[[ "$POWER_MODE" == 1 ]] && MODE=full
[[ "$STANDARD_MODE" == 1 ]] && MODE=standard
build_cfg(){
  local output="$1" wf="$2"
  local args=("$STAGE_DIR/tools/build-candidate-config.mjs" --default "$STAGE_DIR/config.json" --existing "$ACTIVE_CFG" --output "$output" --profile-id default --port "$PORT" --state-dir "$STATE_DIR" --workflow-dir "$wf" --mode "$MODE")
  local c
  for c in "${DISABLE_CAPS[@]}"; do args+=(--disable-capability "$c"); done
  for c in "${ENABLE_CAPS[@]}"; do args+=(--enable-capability "$c"); done
  node "${args[@]}"
}

DIAG_CFG="$STATE_DIR/diagnostic-config.json"
build_cfg "$DIAG_CFG" "$SHADOW_WF" >/dev/null
DIAG_SHA="$(sha256sum "$DIAG_CFG" | awk '{print $1}')"
CANDIDATE_PID="$(start_backend "$STAGE_DIR" "$DIAG_CFG" "$STATE_DIR/diagnostic.log")"
wait_health "$PORT" "$VERSION" "$DIAG_SHA" default || { stop_pid "$CANDIDATE_PID"; echo 'diagnostic health failed' >&2; exit 1; }
node "$STAGE_DIR/tools/doctor.mjs" --url "http://127.0.0.1:$PORT/mcp" --expected-version "$VERSION" --config "$DIAG_CFG" --json
node "$STAGE_DIR/tools/hardware-selftest.mjs" --url "http://127.0.0.1:$PORT/mcp" --config "$DIAG_CFG" --expected-version "$VERSION"
stop_pid "$CANDIDATE_PID"

FINAL_CFG="$STATE_DIR/config.json"
build_cfg "$FINAL_CFG" "$LIVE_WF" >/dev/null
FINAL_SHA="$(sha256sum "$FINAL_CFG" | awk '{print $1}')"
CANDIDATE_PID="$(start_backend "$STAGE_DIR" "$FINAL_CFG" "$STATE_DIR/server.log")"
wait_health "$PORT" "$VERSION" "$FINAL_SHA" default || { stop_pid "$CANDIDATE_PID"; echo 'final candidate health failed' >&2; exit 1; }
node "$STAGE_DIR/tools/doctor.mjs" --url "http://127.0.0.1:$PORT/mcp" --expected-version "$VERSION" --config "$FINAL_CFG" --json
node "$STAGE_DIR/tools/hardware-selftest.mjs" --url "http://127.0.0.1:$PORT/mcp" --config "$FINAL_CFG" --expected-version "$VERSION"

if [[ "$NO_PROMOTE" == 1 ]]; then stop_pid "$CANDIDATE_PID"; log 'AUTO_UPDATE_CANDIDATE_PASS'; exit 0; fi

CUTOVER_COMMITTED=0
ROUTE_BACKUP="$BACKUP_ROOT/$COMMIT/default/route.before.json"
INITIAL_MIGRATION=0
OLD_CFG=""
OLD_PROJECT=""
OLD_PORT=""
ROUTER_PID=""
rollback(){
  local rc=$?
  if [[ "$CUTOVER_COMMITTED" == 0 ]]; then
    stop_pid "$CANDIDATE_PID" || true
    if [[ "$INITIAL_MIGRATION" == 1 ]]; then
      [[ -z "$ROUTER_PID" ]] || stop_pid "$ROUTER_PID" || true
      rm -f "$ROUTE"
      if [[ -n "$OLD_CFG" && -f "$OLD_CFG" ]]; then
        OLD_PID="$(start_backend "$INSTALL_DIR" "$OLD_CFG" "$INSTALL_DIR/var/mcp-rollback.log")"
        log "AUTO_UPDATE_ROLLBACK_DIRECT pid=$OLD_PID"
      fi
    elif [[ -f "$ROUTE_BACKUP" ]]; then
      cp -f "$ROUTE_BACKUP" "$ROUTE"
    fi
  else
    log 'AUTO_UPDATE_POST_COMMIT_MAINTENANCE_REQUIRED'
  fi
  exit "$rc"
}
trap rollback ERR

if [[ -f "$ROUTE" ]]; then
  cp -f "$ROUTE" "$ROUTE_BACKUP"
  IFS=$'\t' read -r _ _ OLD_PORT _ _ _ OLD_CFG OLD_PROJECT < <(route_tsv "$STAGE_DIR" "$ROUTE")
  GENERATION="$(json_field "$STAGE_DIR" "$ROUTE" generation)"
  node "$STAGE_DIR/tools/router-switch.mjs" --state "$ROUTE" --expected-generation "$GENERATION" --profile default --port "$PORT" --version "$VERSION" --commit "$COMMIT" --config-sha "$FINAL_SHA" --config-path "$FINAL_CFG" --project-dir "$STAGE_DIR"
else
  INITIAL_MIGRATION=1
  OLD_CFG="$ACTIVE_CFG"; OLD_PROJECT="$INSTALL_DIR"
  stop_owned_from_config "$STAGE_DIR" "$OLD_CFG" "$INSTALL_DIR"
  node "$STAGE_DIR/tools/router-init.mjs" --state "$ROUTE" --profile default --port "$PORT" --version "$VERSION" --commit "$COMMIT" --config-sha "$FINAL_SHA" --config-path "$FINAL_CFG" --project-dir "$STAGE_DIR"
  ROUTER_PID="$(start_router "$STAGE_DIR" "$ROUTE" "$STATE_ROOT/router.log")"
  wait_router || { echo 'router startup failed' >&2; false; }
fi

node "$STAGE_DIR/tools/doctor.mjs" --url http://127.0.0.1:47831/mcp --expected-version "$VERSION" --config "$FINAL_CFG" --json
node "$STAGE_DIR/tools/hardware-selftest.mjs" --url http://127.0.0.1:47831/mcp --config "$FINAL_CFG" --expected-version "$VERSION"
tunnels_ready || { echo 'tunnel readiness failed' >&2; false; }
CUTOVER_COMMITTED=1
trap - ERR
log "CUTOVER_COMMIT version=$VERSION commit=$COMMIT"

if [[ -n "$OLD_PORT" ]]; then
  deadline=$(( $(date +%s) + DRAIN_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    n="$(node "$STAGE_DIR/tools/router-status.mjs" --url http://127.0.0.1:47831/router/status --port "$OLD_PORT" 2>/dev/null || echo 1)"
    [[ "$n" == 0 ]] && break
    sleep 0.25
  done
  n="$(node "$STAGE_DIR/tools/router-status.mjs" --url http://127.0.0.1:47831/router/status --port "$OLD_PORT")"
  [[ "$n" == 0 ]] || { log 'DRAIN_TIMEOUT_POST_COMMIT'; exit 3; }
  [[ -z "$OLD_CFG" ]] || stop_owned_from_config "$STAGE_DIR" "$OLD_CFG" "$OLD_PROJECT"
fi

node "$STAGE_DIR/tools/finalize-workflow-schema.mjs" --directory "$LIVE_WF"
promote_control "$COMMIT" "$REF"
recycle_supervisor
cleanup_releases
log "AUTO_UPDATE_PASS version=$VERSION commit=$COMMIT"
