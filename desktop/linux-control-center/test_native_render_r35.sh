#!/usr/bin/env bash
# CI-only synthetic GTK4/Adwaita X11 smoke. No owner data, profiles or backend.
set -euo pipefail
[[ "${CI:-}" == true && -n "${GITHUB_WORKSPACE:-}" && -n "${RUNNER_TEMP:-}" ]] || { echo "CI_ONLY" >&2; exit 61; }
root="${GITHUB_WORKSPACE}/desktop/linux-control-center"
output="${GITHUB_WORKSPACE}/dist/ui-preview-r35"
[[ -f "$root/preview_fixture.py" && -f "$root/dashboard_ui.py" && ! -e "$output" ]] || { echo "SOURCE_OR_OUTPUT_CONFLICT" >&2; exit 62; }
mkdir -p "$output"
export RC_R35_PREVIEW_DIR="$output"
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x900x24' bash -euo pipefail -c '
  export GDK_BACKEND=x11 GSETTINGS_BACKEND=memory GTK_A11Y=none NO_AT_BRIDGE=1
  /usr/bin/python3 -B "$GITHUB_WORKSPACE/desktop/linux-control-center/preview_fixture.py" > "$RC_R35_PREVIEW_DIR/gtk.log" 2>&1 &
  pid=$!
  trap "kill $pid 2>/dev/null || true" EXIT
  sleep 5
  # R39: collect X11 facts before asserting, not an alternative PASS.
  echo "R39_APP_PROCESS:" > "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"
  ps -o pid=,stat=,etime=,args= -p "$pid" >> "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt" 2>&1 || true
  echo "R39_WINDOW_TREE:" >> "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"
  xwininfo -root -tree >> "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt" 2>&1 || true
  echo "R39_ALL_VISIBLE_WINDOW_NAMES:" >> "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"
  xdotool search --onlyvisible --name ".*" 2>/dev/null |
    while read -r id; do printf "%s: " "$id"; xdotool getwindowname "$id" 2>/dev/null || true; done >> "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt" || true
  echo "R39_GTK_LOG:" >> "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"
  cat "$RC_R35_PREVIEW_DIR/gtk.log" >> "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"
  # Root image is diagnostics only; later assertions must still pass.
  xwd -root -silent -out "$RC_R35_PREVIEW_DIR/debug-root.xwd" 2>/dev/null || true
  if [[ -s "$RC_R35_PREVIEW_DIR/debug-root.xwd" ]]; then
    convert "$RC_R35_PREVIEW_DIR/debug-root.xwd" "$RC_R35_PREVIEW_DIR/debug-root.png" || true
  fi
  if ! kill -0 "$pid" 2>/dev/null; then cat "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"; echo "GTK_DIED_BEFORE_CAPTURE" >&2; exit 65; fi
  winid="$(xdotool search --name "Remote Commander" | head -n 1 || true)"
  if [[ -z "$winid" ]]; then cat "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"; echo "GTK_NATIVE_WINDOW_MISSING" >&2; exit 66; fi
  grep -q "^R36_NATIVE_STACK_PAGES=4_VISIBLE=4$" "$RC_R35_PREVIEW_DIR/gtk.log" || { cat "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"; echo "SIDEBAR_FOUR_PAGES_NOT_ACCEPTED" >&2; exit 69; }
  grep -q "^R43_NATIVE_NAV_BUTTONS=4_ROUTING_PASS$" "$RC_R35_PREVIEW_DIR/gtk.log" || { cat "$RC_R35_PREVIEW_DIR/x11-diagnostic.txt"; echo "R43_NAV_BUTTON_INTERACTION_NOT_ACCEPTED" >&2; exit 70; }
  xdotool getwindowgeometry --shell "$winid" > "$RC_R35_PREVIEW_DIR/window.txt"
  xwd -root -silent -out "$RC_R35_PREVIEW_DIR/preview.xwd"
  test -s "$RC_R35_PREVIEW_DIR/preview.xwd"
  echo "NATIVE_GTK_WINDOW_OPEN_SYNTHETIC_PASS"
'
convert "$output/preview.xwd" "$output/preview.png"
test "$(stat -c '%s' "$output/preview.png")" -gt 15000
colors="$(identify -format '%k' "$output/preview.png")"
[[ "$colors" =~ ^[0-9]+$ ]] || exit 67
((colors > 120)) || { echo "SCREENSHOT_EMPTY colors=$colors" >&2; exit 68; }
sha="$(sha256sum "$output/preview.png" | cut -d ' ' -f 1)"
printf '{"schema":1,"revision":"R35","status":"PASS_SYNTHETIC_GTK4_ADWAITA_X11_RENDER_ONLY","captureSHA256":"%s","uniqueColors":%s,"userProfileTouched":false,"nativeOwnerAcceptance":false}\n' "$sha" "$colors" >"$output/PREVIEW_R35.json"
echo "R35_SYNTHETIC_X11_RENDER_PASS sha256=$sha colors=$colors"
