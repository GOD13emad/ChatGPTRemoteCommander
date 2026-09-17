#!/usr/bin/env bash
set -euo pipefail
PROFILE="${1:-}"
CFG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now chatgpt-remote-commander.service >/dev/null 2>&1 || true
  rm -f "$CFG_BASE/systemd/user/chatgpt-remote-commander.service"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
if command -v crontab >/dev/null 2>&1; then
  (crontab -l 2>/dev/null | grep -v 'autostart-linux.sh' || true) | crontab - || true
fi
pkill -f 'autostart-linux.sh' 2>/dev/null || true
if [[ -n "$PROFILE" ]]; then
  safe="$(printf '%s' "$PROFILE" | sed 's/[^A-Za-z0-9._-]/_/g')"
  rm -f "$CFG_BASE/chatgpt-remote-commander/credentials/$safe.key"
fi
echo 'AUTOSTART_DISABLED'
