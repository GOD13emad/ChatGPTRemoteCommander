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
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now chatgpt-remote-commander.service >/dev/null 2>&1 || true
  rm -f "$CFG_BASE/systemd/user/chatgpt-remote-commander.service"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
if command -v crontab >/dev/null 2>&1; then
  (crontab -l 2>/dev/null | grep -v 'autostart-linux.sh' || true) | crontab - || true
fi

pkill -f "$ROOT/autostart-linux.sh" 2>/dev/null || true

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
