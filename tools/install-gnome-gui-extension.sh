#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID='chatgpt-remote-commander@god13emad'
SRC="$ROOT/gnome-extension/$UUID"
DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/chatgpt-remote-commander"
TOKEN="$CFG/gui-extension-token"
BRIDGE_PATH='/org/gnome/Shell/Extensions/ChatGPTRemoteCommander'
BRIDGE_IFACE='org.gnome.Shell.Extensions.ChatGPTRemoteCommander'

bridge_active(){
  gdbus introspect --session --dest org.gnome.Shell --object-path "$BRIDGE_PATH" 2>/dev/null |
    grep -q "interface $BRIDGE_IFACE"
}
extension_active(){
  command -v gnome-extensions >/dev/null 2>&1 &&
    gnome-extensions list --active 2>/dev/null | grep -Fxq "$UUID"
}
wait_bridge(){
  local i
  for i in $(seq 1 30); do
    bridge_active && return 0
    sleep 0.1
  done
  return 1
}
same_tree(){
  [[ -d "$DST" ]] && diff -qr -- "$SRC" "$DST" >/dev/null 2>&1
}

if [[ "${XDG_CURRENT_DESKTOP:-}" != *GNOME* ]] && ! pgrep -x gnome-shell >/dev/null 2>&1; then
  echo "GNOME_GUI_EXTENSION_SKIP desktop=${XDG_CURRENT_DESKTOP:-unknown}"
  exit 0
fi

mkdir -p "$CFG" "$(dirname "$DST")"
chmod 700 "$CFG"
if [[ ! -s "$TOKEN" ]]; then
  umask 077
  python3 - <<'PY' >"$TOKEN"
import secrets
print(secrets.token_hex(32))
PY
fi
chmod 600 "$TOKEN"

changed=true
if same_tree; then
  changed=false
  echo "GNOME_GUI_EXTENSION_UNCHANGED path=$DST"
else
  was_active=false
  if bridge_active || extension_active; then was_active=true; fi
  if [[ "$was_active" == true ]] && command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      bridge_active || break
      sleep 0.1
    done
  fi

  rm -rf "$DST.tmp"
  mkdir -p "$DST.tmp"
  cp -a "$SRC/." "$DST.tmp/"
  rm -rf "$DST.prev"
  if [[ -e "$DST" ]]; then mv "$DST" "$DST.prev"; fi
  mv "$DST.tmp" "$DST"
  echo "GNOME_GUI_EXTENSION_INSTALLED path=$DST"
fi

# Persist enablement for the current and future GNOME sessions.
python3 - "$UUID" <<'PYSET'
import gi, sys
gi.require_version('Gio','2.0')
from gi.repository import Gio
uuid=sys.argv[1]
settings=Gio.Settings.new('org.gnome.shell')
enabled=list(settings.get_strv('enabled-extensions'))
if uuid not in enabled:
    enabled.append(uuid)
    if not settings.set_strv('enabled-extensions', enabled):
        raise SystemExit('GNOME_GUI_EXTENSION_ENABLE_SETTING_FAILED')
    Gio.Settings.sync()
PYSET

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
fi

# GNOME's enable command is a no-op when the extension is already marked enabled.
# If the live bridge is still absent, force one bounded disable/enable cycle so a
# newly replaced or previously enabled-but-inactive extension can load now.
if ! wait_bridge && command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
  sleep 0.1
  gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
  wait_bridge || true
fi

if bridge_active; then
  echo "GNOME_GUI_EXTENSION_ACTIVE changed=$changed"
else
  echo "GNOME_GUI_EXTENSION_SESSION_RELOAD_REQUIRED changed=$changed"
fi
