#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID='chatgpt-remote-commander-linux-safe@god13emad'
LEGACY_UUID='chatgpt-remote-commander@god13emad'
SRC="$ROOT/gnome-extension/$UUID"
DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/chatgpt-remote-commander"
TOKEN="$CFG/gui-extension-token"
BRIDGE_PATH='/org/gnome/Shell/Extensions/ChatGPTRemoteCommander'
BRIDGE_IFACE='org.gnome.Shell.Extensions.ChatGPTRemoteCommander'
STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/chatgpt-remote-commander"
GLOBAL_STOP="$STATE_ROOT/GUI_STOP"
QUARANTINE="$STATE_ROOT/gnome-extension-quarantine"

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

mkdir -p "$CFG" "$(dirname "$DST")" "$QUARANTINE"
fresh_install=false
[[ -e "$DST" ]] || fresh_install=true
# Disable and quarantine the legacy UUID. A new UUID guarantees a fresh GJS module
# in the current shell process and prevents stale cached input code from reloading.
LEGACY_DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$LEGACY_UUID"
if [[ -d "$LEGACY_DST" ]]; then
  if command -v gnome-extensions >/dev/null 2>&1; then gnome-extensions disable "$LEGACY_UUID" >/dev/null 2>&1 || true; fi
  python3 - "$LEGACY_UUID" <<'PYLEGACY'
import gi,sys
gi.require_version('Gio','2.0')
from gi.repository import Gio
uuid=sys.argv[1]; settings=Gio.Settings.new('org.gnome.shell')
enabled=[x for x in settings.get_strv('enabled-extensions') if x != uuid]
settings.set_strv('enabled-extensions',enabled); Gio.Settings.sync()
PYLEGACY
  mv "$LEGACY_DST" "$QUARANTINE/$LEGACY_UUID.$(date +%Y%m%d_%H%M%S)"
fi
# Never leave backup extension directories in GNOME's live scan root.
if [[ -e "$DST.prev" ]]; then mv "$DST.prev" "$QUARANTINE/$UUID.prev.$(date +%Y%m%d_%H%M%S)"; fi
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
  if [[ -e "$DST" ]]; then mv "$DST" "$QUARANTINE/$UUID.$(date +%Y%m%d_%H%M%S)"; fi
  mv "$DST.tmp" "$DST"
  echo "GNOME_GUI_EXTENSION_INSTALLED path=$DST"
fi

# Persist enablement only when the global emergency stop is absent.
if [[ -e "$GLOBAL_STOP" ]]; then
  python3 - "$UUID" <<'PYSET'
import gi, sys
gi.require_version('Gio','2.0')
from gi.repository import Gio
uuid=sys.argv[1]
settings=Gio.Settings.new('org.gnome.shell')
enabled=[x for x in settings.get_strv('enabled-extensions') if x != uuid]
settings.set_strv('enabled-extensions', enabled); Gio.Settings.sync()
PYSET
  if command -v gnome-extensions >/dev/null 2>&1; then gnome-extensions disable "$UUID" >/dev/null 2>&1 || true; fi
  echo "GNOME_GUI_EXTENSION_HELD_BY_GLOBAL_STOP changed=$changed"
  exit 0
fi

python3 - "$UUID" <<'PYSET'
import gi, sys
gi.require_version('Gio','2.0')
from gi.repository import Gio
uuid=sys.argv[1]
settings=Gio.Settings.new('org.gnome.shell')
enabled=list(settings.get_strv('enabled-extensions'))
if uuid not in enabled:
    enabled.append(uuid)
    if not settings.set_strv('enabled-extensions', enabled): raise SystemExit('GNOME_GUI_EXTENSION_ENABLE_SETTING_FAILED')
    Gio.Settings.sync()
PYSET
# GJS ES modules can remain cached for the lifetime of GNOME Shell. When the
# extension tree changed, a disable/enable cycle can instantiate stale code from
# the same shell process. Never hot-reenable changed code; persist enablement for
# the next Shell/session load and fail closed until then.
if [[ "$changed" == true && "$fresh_install" != true ]]; then
  echo "GNOME_GUI_EXTENSION_SESSION_RELOAD_REQUIRED changed=true fresh=false reason=gjs-module-cache"
  exit 0
fi
if command -v gnome-extensions >/dev/null 2>&1; then gnome-extensions enable "$UUID" >/dev/null 2>&1 || true; fi
if ! wait_bridge && command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
  sleep 0.1
  gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
  wait_bridge || true
fi

if bridge_active; then
  echo "GNOME_GUI_EXTENSION_ACTIVE changed=$changed fresh=$fresh_install"
else
  echo "GNOME_GUI_EXTENSION_SESSION_RELOAD_REQUIRED changed=$changed fresh=$fresh_install"
fi
