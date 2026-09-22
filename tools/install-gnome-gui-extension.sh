#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID='chatgpt-remote-commander@god13emad'
SRC="$ROOT/gnome-extension/$UUID"
DST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/chatgpt-remote-commander"
TOKEN="$CFG/gui-extension-token"
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
rm -rf "$DST.tmp"
mkdir -p "$DST.tmp"
cp -a "$SRC/." "$DST.tmp/"
rm -rf "$DST.prev"
if [[ -e "$DST" ]]; then mv "$DST" "$DST.prev"; fi
mv "$DST.tmp" "$DST"
# Register for the next GNOME session without restarting/logging out the current session.
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
echo "GNOME_GUI_EXTENSION_INSTALLED path=$DST"
if gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/ChatGPTRemoteCommander 2>/dev/null |
    grep -q 'interface org.gnome.Shell.Extensions.ChatGPTRemoteCommander'; then
  echo "GNOME_GUI_EXTENSION_ACTIVE"
else
  echo "GNOME_GUI_EXTENSION_SESSION_RELOAD_REQUIRED"
fi
