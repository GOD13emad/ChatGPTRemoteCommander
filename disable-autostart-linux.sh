#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE=""
REMOVE_CREDENTIAL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --remove-credential) REMOVE_CREDENTIAL=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

CFG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
RUNTIME_BIN="$ROOT/.runtime/node-current/bin"
[[ -x "$RUNTIME_BIN/node" ]] && export PATH="$RUNTIME_BIN:$PATH"
STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/chatgpt-remote-commander"
ROUTE="$STATE_ROOT/routing/default.json"
ROUTER_RUNTIME="$STATE_ROOT/routing/default.runtime.json"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now chatgpt-remote-commander.service >/dev/null 2>&1 || true
  rm -f "$CFG_BASE/systemd/user/chatgpt-remote-commander.service"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
if command -v crontab >/dev/null 2>&1; then
  (crontab -l 2>/dev/null | grep -v 'autostart-linux.sh' || true) | crontab - || true
fi

pkill -f "$ROOT/autostart-linux.sh" 2>/dev/null || true

kill_owned_pid() {
  local pid="${1:-}" expected_cwd="${2:-}" needle="${3:-}" cwd cmd i
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ -z "$expected_cwd" || "$cwd" == "$(readlink -f "$expected_cwd" 2>/dev/null || true)" ]] || return 1
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ -z "$needle" || "$cmd" == *"$needle"* ]] || return 1
  kill "$pid" 2>/dev/null || return 1
  for i in $(seq 1 40); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  return 1
}

if command -v node >/dev/null 2>&1 && [[ -f "$ROUTE" ]]; then
  route_line="$(node "$ROOT/tools/router-state.mjs" --state "$ROUTE" --tsv 2>/dev/null || true)"
  routed_cfg="$(printf '%s\n' "$route_line" | cut -f7)"
  routed_project="$(printf '%s\n' "$route_line" | cut -f8)"
  if [[ -n "$routed_cfg" && -f "$routed_cfg" ]]; then
    marker="$(node "$ROOT/tools/json-field.mjs" --file "$routed_cfg" --field runtimeState 2>/dev/null || true)"
    if [[ -n "$marker" && -f "$marker" ]]; then
      backend_pid="$(node "$ROOT/tools/json-field.mjs" --file "$marker" --field pid 2>/dev/null || true)"
      kill_owned_pid "$backend_pid" "$routed_project" "src/server-v0.3.mjs" || true
    fi
  fi
  if [[ -n "$routed_project" && -f "$ROUTER_RUNTIME" ]]; then
    router_pid="$(node "$ROOT/tools/json-field.mjs" --file "$ROUTER_RUNTIME" --field pid 2>/dev/null || true)"
    router_state="$(node "$ROOT/tools/json-field.mjs" --file "$ROUTER_RUNTIME" --field stateFile 2>/dev/null || true)"
    if [[ "$(readlink -f "$router_state" 2>/dev/null || true)" == "$(readlink -f "$ROUTE")" ]]; then
      kill_owned_pid "$router_pid" "$routed_project" "stable-router.mjs" || true
    fi
  fi
fi

while read -r pid args; do
  [[ -n "${pid:-}" ]] || continue
  if [[ "$args" == *"$ROOT/tools/"* && "$args" == *"tunnel-client"* && "$args" == *"run --profile"* ]]; then
    kill "$pid" 2>/dev/null || true
  fi
done < <(ps -eo pid=,args=)

while read -r pid args; do
  [[ -n "${pid:-}" ]] || continue
  if [[ "$args" == *"node"* && "$args" == *"src/server-v0.3.mjs"* ]]; then
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [[ "$cwd" == "$(readlink -f "$ROOT")" ]] && kill "$pid" 2>/dev/null || true
  fi
done < <(ps -eo pid=,args=)

credential_state=kept
if [[ "$REMOVE_CREDENTIAL" -eq 1 ]]; then
  [[ -n "$PROFILE" ]] || { echo '--profile is required with --remove-credential' >&2; exit 2; }
  safe="$(printf '%s' "$PROFILE" | sed 's/[^A-Za-z0-9._-]/_/g')"
  rm -f "$CFG_BASE/chatgpt-remote-commander/credentials/$safe.key"
  credential_state=removed
fi

echo "AUTOSTART_DISABLED credential=$credential_state"
