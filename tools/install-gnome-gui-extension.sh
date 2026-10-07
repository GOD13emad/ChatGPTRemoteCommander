#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID='chatgpt-remote-commander-linux-safe-v2@god13emad'
SAFE_FALLBACK_UUID='chatgpt-remote-commander-linux-safe@god13emad'
UNSAFE_LEGACY_UUID='chatgpt-remote-commander@god13emad'
SAFE_FALLBACK_EXTENSION_SHA256='084c6c1244b25b4a714b0978d7f59b0b02fa8dbce45a962bff6cda6d18a17caa'
SAFE_FALLBACK_METADATA_SHA256='71375ff9ff21387355de83275be8a4b42361626208bcc120e7e41e6ffb08688e'
SRC="$ROOT/gnome-extension/$UUID"
EXT_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DST="$EXT_ROOT/$UUID"
SAFE_FALLBACK_DST="$EXT_ROOT/$SAFE_FALLBACK_UUID"
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
extension_known(){
  command -v gnome-extensions >/dev/null 2>&1 &&
    gnome-extensions info "$1" >/dev/null 2>&1
}
extension_active(){
  command -v gnome-extensions >/dev/null 2>&1 &&
    gnome-extensions list --active 2>/dev/null | grep -Fxq "$1"
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
persist_enabled(){
  python3 - "$1" <<'PY'
import gi,sys
gi.require_version('Gio','2.0')
from gi.repository import Gio
u=sys.argv[1]; s=Gio.Settings.new('org.gnome.shell')
enabled=list(s.get_strv('enabled-extensions'))
disabled=[x for x in s.get_strv('disabled-extensions') if x!=u]
if u not in enabled: enabled.append(u)
s.set_strv('enabled-extensions',enabled)
s.set_strv('disabled-extensions',disabled)
Gio.Settings.sync()
PY
}
persist_disabled(){
  python3 - "$1" <<'PY'
import gi,sys
gi.require_version('Gio','2.0')
from gi.repository import Gio
u=sys.argv[1]; s=Gio.Settings.new('org.gnome.shell')
enabled=[x for x in s.get_strv('enabled-extensions') if x!=u]
disabled=list(s.get_strv('disabled-extensions'))
if u not in disabled: disabled.append(u)
s.set_strv('enabled-extensions',enabled)
s.set_strv('disabled-extensions',disabled)
Gio.Settings.sync()
PY
}
safe_fallback_hash_ok(){
  [[ -f "$SAFE_FALLBACK_DST/extension.js" && -f "$SAFE_FALLBACK_DST/metadata.json" ]] || return 1
  [[ "$(sha256sum "$SAFE_FALLBACK_DST/extension.js" | awk '{print $1}')" == "$SAFE_FALLBACK_EXTENSION_SHA256" ]] || return 1
  [[ "$(sha256sum "$SAFE_FALLBACK_DST/metadata.json" | awk '{print $1}')" == "$SAFE_FALLBACK_METADATA_SHA256" ]] || return 1
}
restore_safe_fallback(){
  safe_fallback_hash_ok && return 0
  [[ ! -e "$SAFE_FALLBACK_DST" ]] || return 1
  local candidate
  candidate="$(find "$QUARANTINE" -maxdepth 1 -mindepth 1 -type d -name "$SAFE_FALLBACK_UUID.*" -print 2>/dev/null | sort -r | head -n1 || true)"
  [[ -n "$candidate" && -f "$candidate/extension.js" && -f "$candidate/metadata.json" ]] || return 1
  [[ "$(sha256sum "$candidate/extension.js" | awk '{print $1}')" == "$SAFE_FALLBACK_EXTENSION_SHA256" ]] || return 1
  [[ "$(sha256sum "$candidate/metadata.json" | awk '{print $1}')" == "$SAFE_FALLBACK_METADATA_SHA256" ]] || return 1
  cp -a "$candidate" "$SAFE_FALLBACK_DST"
  safe_fallback_hash_ok
}
activate_safe_fallback(){
  restore_safe_fallback || return 1
  extension_known "$SAFE_FALLBACK_UUID" || return 1
  persist_disabled "$UUID"
  persist_enabled "$SAFE_FALLBACK_UUID"
  gnome-extensions enable "$SAFE_FALLBACK_UUID" >/dev/null 2>&1 || return 1
  wait_bridge || return 1
  echo "GNOME_GUI_EXTENSION_FALLBACK_ACTIVE uuid=$SAFE_FALLBACK_UUID v2Pending=true"
  return 0
}
retire_safe_fallback(){
  if [[ -e "$SAFE_FALLBACK_DST" ]]; then
    gnome-extensions disable "$SAFE_FALLBACK_UUID" >/dev/null 2>&1 || true
    persist_disabled "$SAFE_FALLBACK_UUID"
    mv "$SAFE_FALLBACK_DST" "$QUARANTINE/$SAFE_FALLBACK_UUID.$(date +%Y%m%d_%H%M%S)"
  fi
}

if [[ "${XDG_CURRENT_DESKTOP:-}" != *GNOME* ]] && ! pgrep -x gnome-shell >/dev/null 2>&1; then
  echo "GNOME_GUI_EXTENSION_SKIP desktop=${XDG_CURRENT_DESKTOP:-unknown}"
  exit 0
fi

mkdir -p "$CFG" "$EXT_ROOT" "$QUARANTINE"

UNSAFE_LEGACY_DST="$EXT_ROOT/$UNSAFE_LEGACY_UUID"
if [[ -d "$UNSAFE_LEGACY_DST" ]]; then
  gnome-extensions disable "$UNSAFE_LEGACY_UUID" >/dev/null 2>&1 || true
  persist_disabled "$UNSAFE_LEGACY_UUID"
  mv "$UNSAFE_LEGACY_DST" "$QUARANTINE/$UNSAFE_LEGACY_UUID.$(date +%Y%m%d_%H%M%S)"
fi

if [[ -e "$DST.prev" ]]; then
  mv "$DST.prev" "$QUARANTINE/$UUID.prev.$(date +%Y%m%d_%H%M%S)"
fi
chmod 700 "$CFG"
if [[ ! -s "$TOKEN" ]]; then
  umask 077
  python3 - <<'PY' >"$TOKEN"
import secrets
print(secrets.token_hex(32))
PY
fi
chmod 600 "$TOKEN"

fresh_install=false
[[ -e "$DST" ]] || fresh_install=true
v2_known_before=false
extension_known "$UUID" && v2_known_before=true
changed=true
if same_tree; then
  changed=false
  echo "GNOME_GUI_EXTENSION_UNCHANGED path=$DST"
else
  if extension_active "$UUID"; then
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      bridge_active || break
      sleep 0.1
    done
  fi
  rm -rf "$DST.tmp"
  mkdir -p "$DST.tmp"
  cp -a "$SRC/." "$DST.tmp/"
  if [[ -e "$DST" ]]; then
    mv "$DST" "$QUARANTINE/$UUID.$(date +%Y%m%d_%H%M%S)"
  fi
  mv "$DST.tmp" "$DST"
  echo "GNOME_GUI_EXTENSION_INSTALLED path=$DST"
fi

if [[ -e "$GLOBAL_STOP" ]]; then
  persist_disabled "$UUID"
  persist_disabled "$SAFE_FALLBACK_UUID"
  gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
  gnome-extensions disable "$SAFE_FALLBACK_UUID" >/dev/null 2>&1 || true
  echo "GNOME_GUI_EXTENSION_HELD_BY_GLOBAL_STOP changed=$changed"
  exit 0
fi

if [[ "$v2_known_before" == true && "$changed" == false ]]; then
  if extension_active "$SAFE_FALLBACK_UUID"; then
    gnome-extensions disable "$SAFE_FALLBACK_UUID" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      bridge_active || break
      sleep 0.1
    done
  fi
  persist_enabled "$UUID"
  gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
  if wait_bridge; then
    retire_safe_fallback
    echo "GNOME_GUI_EXTENSION_ACTIVE changed=false fresh=$fresh_install uuid=$UUID"
    exit 0
  fi
fi

if activate_safe_fallback; then
  exit 0
fi

persist_enabled "$UUID"
persist_disabled "$SAFE_FALLBACK_UUID"
echo "GNOME_GUI_EXTENSION_SESSION_RELOAD_REQUIRED changed=$changed fresh=$fresh_install reason=new-uuid-not-discoverable"
