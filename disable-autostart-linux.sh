#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
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
PROFILE_DIR="$CFG_BASE/tunnel-client"
CRED_DIR="$CFG_BASE/chatgpt-remote-commander/credentials"

profile_valid() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; }

find_tunnel() {
  local manifest rel expected candidate actual
  manifest="$ROOT/tools/tunnel-client.active.json"
  [[ -f "$manifest" ]] || return 1
  rel="$(sed -nE 's/.*"relativePath"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$manifest" | head -n1)"
  expected="$(sed -nE 's/.*"sha256"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$manifest" | head -n1)"
  candidate="$(readlink -f "$ROOT/$rel" 2>/dev/null || true)"
  [[ -n "$candidate" && -x "$candidate" ]] || return 1
  case "$candidate" in "$ROOT"/*) ;; *) return 1 ;; esac
  actual="$(sha256sum "$candidate" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || return 1
  printf '%s\n' "$candidate"
}

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now chatgpt-remote-commander.service >/dev/null 2>&1 || true
  unit="$CFG_BASE/systemd/user/chatgpt-remote-commander.service"
  if [[ -f "$unit" ]] && grep -Fq "$ROOT/autostart-linux.sh" "$unit"; then rm -f "$unit"; fi
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
if command -v crontab >/dev/null 2>&1; then
  (crontab -l 2>/dev/null | grep -Fv "$ROOT/autostart-linux.sh" || true) | crontab - || true
fi

while read -r pid args; do
  [[ -n "${pid:-}" ]] || continue
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  if [[ "$cwd" == "$ROOT" && "$args" == *"autostart-linux.sh"* ]]; then kill "$pid" 2>/dev/null || true; fi
done < <(ps -eo pid=,args=)

TUNNELS_STOPPED=0
EXE="$(find_tunnel 2>/dev/null || true)"
if [[ -n "$EXE" && -d "$PROFILE_DIR" ]]; then
  while IFS= read -r -d '' file; do
    grep -q 'http://127\.0\.0\.1:47831/mcp' "$file" || continue
    profile="$(basename "$file" .yaml)"
    profile_valid "$profile" || continue
    while read -r pid args; do
      [[ -n "$pid" ]] || continue
      proc_exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
      [[ "$proc_exe" == "$EXE" ]] || continue
      if [[ "$args" =~ run[[:space:]]+--profile[[:space:]]+"?$profile"?([[:space:]]|$) ]]; then
        kill "$pid" 2>/dev/null || true; TUNNELS_STOPPED=$((TUNNELS_STOPPED+1))
      fi
    done < <(ps -eo pid=,args=)
  done < <(find "$PROFILE_DIR" -maxdepth 1 -type f -name '*.yaml' -print0 2>/dev/null)
fi

MCP_STOPPED=0
health="$(curl -fsS --max-time 2 http://127.0.0.1:47831/health 2>/dev/null || true)"
expected_instance="$(printf '%s' "$ROOT" | sha256sum | awk '{print substr($1,1,24)}')"
if [[ "$health" == *"\"instanceId\":\"$expected_instance\""* ]]; then
  while read -r pid args; do
    [[ -n "$pid" ]] || continue
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [[ "$cwd" == "$ROOT" && "$args" == *"src/server-v0.3.mjs"* ]]; then kill "$pid" 2>/dev/null || true; MCP_STOPPED=1; fi
  done < <(ps -eo pid=,args=)
fi

credential_state=kept
if [[ "$REMOVE_CREDENTIAL" -eq 1 ]]; then
  [[ -n "$PROFILE" ]] || { echo '--profile is required with --remove-credential' >&2; exit 2; }
  profile_valid "$PROFILE" || { echo 'Invalid profile name' >&2; exit 2; }
  rm -f "$CRED_DIR/$PROFILE.key"
  credential_state=removed
fi

echo "AUTOSTART_DISABLED tunnels=$TUNNELS_STOPPED mcpStopped=$MCP_STOPPED credential=$credential_state"
