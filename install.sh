#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REMOTE_COMMANDER_REPO_URL:-https://github.com/GOD13emad/ChatGPTRemoteCommander.git}"
INSTALL_DIR="${HOME}/.local/share/ChatGPTRemoteCommander"
POWER_MODE=0
START_SERVER=0
INSTALL_PREREQS=0
TUNNEL_VERSION="0.0.14"
SOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v0.5.2}"

usage() {
  cat <<'USAGE'
Usage: install.sh [options]
  --install-dir PATH        Install/update directory
  --install-prerequisites   Install basic OS packages and portable Node 22+ if needed
  --power-mode              Enable local Full-Control policy
  --start-server            Start MCP server with nohup after validation
  --source-ref REF          Git ref to install (default: v0.5.2)
  -h, --help                Show help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --install-prerequisites) INSTALL_PREREQS=1; shift ;;
    --power-mode) POWER_MODE=1; shift ;;
    --start-server) START_SERVER=1; shift ;;
    --source-ref) SOURCE_REF="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done
[[ "$SOURCE_REF" =~ ^[A-Za-z0-9._/-]{1,128}$ ]] || { echo "Invalid --source-ref" >&2; exit 2; }
need() { command -v "$1" >/dev/null 2>&1; }

install_os_packages() {
  [[ "$INSTALL_PREREQS" == "1" ]] || return 0
  local sudo_cmd=""
  if [[ "$(id -u)" != "0" ]]; then
    need sudo || { echo "sudo is required to install OS packages" >&2; exit 1; }
    sudo_cmd="sudo"
  fi
  if need apt-get; then
    $sudo_cmd apt-get update
    $sudo_cmd apt-get install -y git curl unzip tar xz-utils ca-certificates
  elif need dnf; then
    $sudo_cmd dnf install -y git curl unzip tar xz ca-certificates
  elif need pacman; then
    $sudo_cmd pacman -Sy --needed --noconfirm git curl unzip tar xz ca-certificates
  else
    echo "Unsupported package manager. Install git curl unzip tar xz manually." >&2
    exit 1
  fi
}

install_source() {
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    local dirty resolved current
    dirty="$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=no)"
    [[ -z "$dirty" ]] || { echo "Tracked local changes exist in InstallDir; refusing update." >&2; exit 1; }
    git -C "$INSTALL_DIR" fetch --no-tags origin "$SOURCE_REF"
    resolved="$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)"
    current="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
    if [[ "$current" != "$resolved" ]]; then
      git -C "$INSTALL_DIR" merge-base --is-ancestor "$current" "$resolved" || {
        echo "Refusing non-fast-forward update or downgrade." >&2; exit 1;
      }
      git -C "$INSTALL_DIR" checkout --detach "$resolved"
    fi
  elif [[ -e "$INSTALL_DIR" ]]; then
    echo "Install directory exists but is not a Git repository: $INSTALL_DIR" >&2
    exit 1
  else
    mkdir -p "$INSTALL_DIR"
    git -C "$INSTALL_DIR" init
    git -C "$INSTALL_DIR" remote add origin "$REPO_URL"
    git -C "$INSTALL_DIR" fetch --depth 1 --no-tags origin "$SOURCE_REF"
    git -C "$INSTALL_DIR" checkout --detach FETCH_HEAD
  fi
  echo "Source ref: $SOURCE_REF"
  echo "Source commit: $(git -C "$INSTALL_DIR" rev-parse HEAD)"
}
node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

install_portable_node() {
  local current=0
  if need node; then current="$(node_major)"; fi
  if [[ "$current" -ge 22 ]]; then return 0; fi
  [[ "$INSTALL_PREREQS" == "1" ]] || {
    echo "Node.js 22+ is required. Re-run with --install-prerequisites or install Node 22+." >&2
    exit 1
  }
  local machine node_arch
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) echo "Unsupported Linux architecture for portable Node: $machine" >&2; exit 1 ;;
  esac
  local index version asset base tmp expected actual
  index="$(curl -fsSL https://nodejs.org/dist/index.json)"
  version="$(printf '%s' "$index" | grep -oE '"version"[[:space:]]*:[[:space:]]*"v22\.[^"]+"' | head -n1 | sed -E 's/.*"(v22\.[^"]+)"/\1/')"
  [[ -n "$version" ]] || { echo "Could not resolve latest Node 22 release" >&2; exit 1; }
  asset="node-${version}-linux-${node_arch}.tar.xz"
  base="https://nodejs.org/dist/${version}"
  tmp="$(mktemp -d)"
  curl -fsSL "$base/$asset" -o "$tmp/$asset"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  expected="$(awk -v f="$asset" '$2==f {print $1}' "$tmp/SHASUMS256.txt")"
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  [[ -n "$expected" && "$actual" == "$expected" ]] || { echo "Node SHA-256 verification failed" >&2; exit 1; }
  mkdir -p "$INSTALL_DIR/.runtime"
  rm -rf "$INSTALL_DIR/.runtime/node-${version}-linux-${node_arch}" "$INSTALL_DIR/.runtime/node-current"
  tar -xJf "$tmp/$asset" -C "$INSTALL_DIR/.runtime"
  ln -s "node-${version}-linux-${node_arch}" "$INSTALL_DIR/.runtime/node-current"
  rm -rf "$tmp"
  export PATH="$INSTALL_DIR/.runtime/node-current/bin:$PATH"
  echo "Portable Node installed: $(node --version)"
}

ensure_node_path() {
  if [[ -x "$INSTALL_DIR/.runtime/node-current/bin/node" ]]; then
    export PATH="$INSTALL_DIR/.runtime/node-current/bin:$PATH"
  fi
  local major
  major="$(node_major)"
  [[ "$major" -ge 22 ]] || { echo "Node.js 22+ not available" >&2; exit 1; }
  need npm || { echo "npm is required" >&2; exit 1; }
}

install_tunnel_client() {
  local machine arch asset dir tmp sums expected actual
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported tunnel-client architecture: $machine" >&2; exit 1 ;;
  esac
  dir="$INSTALL_DIR/tools/tunnel-client-v${TUNNEL_VERSION}-linux-${arch}"
  if [[ -x "$dir/tunnel-client" ]]; then return 0; fi
  asset="tunnel-client-v${TUNNEL_VERSION}-linux-${arch}.zip"
  tmp="$(mktemp -d)"
  local base="https://github.com/openai/tunnel-client/releases/download/v${TUNNEL_VERSION}"
  curl -fsSL "$base/$asset" -o "$tmp/$asset"
  curl -fsSL "$base/SHA256SUMS.txt" -o "$tmp/SHA256SUMS.txt"
  expected="$(awk -v f="$asset" '$2==f {print $1}' "$tmp/SHA256SUMS.txt")"
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  [[ -n "$expected" && "$actual" == "$expected" ]] || { echo "tunnel-client SHA-256 verification failed" >&2; exit 1; }
  rm -rf "$dir"
  mkdir -p "$dir"
  unzip -q "$tmp/$asset" -d "$dir"
  chmod +x "$dir/tunnel-client" "$dir/cloudflared" 2>/dev/null || true
  "$dir/tunnel-client" --version
  rm -rf "$tmp"
  echo "Official OpenAI tunnel-client installed and verified: $dir/tunnel-client"
}

write_local_config() {
  local workspace="$HOME/source/repos"
  mkdir -p "$workspace"
  local cfg="$INSTALL_DIR/config.local.json"
  if [[ -f "$cfg" && "$POWER_MODE" != "1" ]]; then
    echo "Preserving existing local config: $cfg"
    return 0
  fi
  if [[ -f "$cfg" ]]; then cp "$cfg" "$cfg.bak.$(date +%Y%m%d%H%M%S)"; fi
  local enabled=false full=false shell=false process_control=false
  if [[ "$POWER_MODE" == "1" ]]; then enabled=true; full=true; shell=true; process_control=true; fi
  cat > "$cfg" <<EOF_CFG
{
  "deviceName": "$(hostname)",
  "host": "127.0.0.1",
  "port": 47831,
  "allowedRoots": ["$workspace"],
  "allowedPrograms": ["git", "node", "npm", "npx", "python3", "python", "dotnet", "cmake", "ninja"],
  "maxReadBytes": 524288,
  "maxWriteBytes": 524288,
  "maxCommandMs": 120000,
  "auditLog": "var/audit.jsonl",
  "powerMode": {
    "enabled": $enabled,
    "fullFilesystem": $full,
    "allowShell": $shell,
    "allowProcessControl": $process_control,
    "allowPermanentDelete": false,
    "backupRoot": "$HOME/.chatgpt-remote-commander/backups",
    "maxFileBytes": 33554432,
    "maxCommandMs": 600000,
    "maxOutputBytes": 4194304,
    "maxTerminalBufferBytes": 8388608,
    "blockedShellPatterns": [
      "shutdown", "Restart-Computer", "Stop-Computer", "logoff", "ExitWindowsEx",
      "reboot", "poweroff", "halt", "systemctl.*reboot", "systemctl.*poweroff", "init 0", "init 6"
    ]
  }
}
EOF_CFG
  if [[ "$POWER_MODE" == "1" ]]; then
    echo "Power Mode enabled locally; permanent delete stays OFF."
  else
    echo "Standard local policy created; Power Mode is OFF."
  fi
}

validate_installation() {
  cd "$INSTALL_DIR"
  npm run check
  npm test
  npm run audit
}

start_server() {
  [[ "$START_SERVER" == "1" ]] || return 0
  cd "$INSTALL_DIR"
  mkdir -p var
  local expected current health pid cwd
  expected="$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json | head -n1)"
  health="$(curl -fsS http://127.0.0.1:47831/health 2>/dev/null || true)"
  current="$(printf '%s' "$health" | sed -nE 's/.*"version":"([^"]+)".*/\1/p')"
  if [[ -n "$current" && "$current" == "$expected" ]]; then
    echo "MCP server is already healthy at version $expected."
    return 0
  fi
  if [[ -n "$current" && "$current" != "$expected" ]]; then
    echo "Updating running MCP from version $current to $expected..."
    for pid in $(pgrep -f 'node .*src/server-v0\.3\.mjs' 2>/dev/null || true); do
      cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
      if [[ "$cwd" == "$(readlink -f "$INSTALL_DIR")" ]]; then
        kill "$pid" 2>/dev/null || true
      fi
    done
    for _ in $(seq 1 40); do
      sleep 0.25
      health="$(curl -fsS http://127.0.0.1:47831/health 2>/dev/null || true)"
      current="$(printf '%s' "$health" | sed -nE 's/.*"version":"([^"]+)".*/\1/p')"
      if [[ "$current" == "$expected" ]]; then
        echo "Supervisor restarted MCP at version $expected."
        return 0
      fi
    done
  fi
  nohup ./run-server.sh > var/server.log 2>&1 &
  echo $! > var/server.pid
  for _ in $(seq 1 40); do
    sleep 0.25
    health="$(curl -fsS http://127.0.0.1:47831/health 2>/dev/null || true)"
    current="$(printf '%s' "$health" | sed -nE 's/.*"version":"([^"]+)".*/\1/p')"
    if [[ "$current" == "$expected" ]]; then
      echo "MCP server started at version $expected: http://127.0.0.1:47831/mcp"
      return 0
    fi
  done
  echo "Server failed to reach expected version $expected; see $INSTALL_DIR/var/server.log" >&2
  exit 1
}
[[ "$(uname -s)" == "Linux" ]] || { echo "This installer supports Linux only. Use install.ps1 on Windows." >&2; exit 1; }
install_os_packages
for cmd in git curl unzip tar sha256sum; do
  need "$cmd" || { echo "$cmd is required; re-run with --install-prerequisites." >&2; exit 1; }
done
install_source
install_portable_node
ensure_node_path
install_tunnel_client
write_local_config
chmod +x "$INSTALL_DIR/install.sh" "$INSTALL_DIR/connect-chatgpt-account.sh" "$INSTALL_DIR/run-server.sh" \
  "$INSTALL_DIR/autostart-linux.sh" "$INSTALL_DIR/enable-autostart-linux.sh" "$INSTALL_DIR/disable-autostart-linux.sh"
validate_installation
start_server

echo
echo "INSTALL_PASS"
echo "Installed at: $INSTALL_DIR"
echo "Source ref: $SOURCE_REF"
echo "Source commit: $(git -C "$INSTALL_DIR" rev-parse HEAD)"
echo "Mode: $( [[ "$POWER_MODE" == "1" ]] && echo POWER || echo STANDARD )"
echo "Device: $(hostname)"
echo
echo "Next: create a distinct OpenAI Secure MCP Tunnel for this computer, then run once:"
echo "  $INSTALL_DIR/enable-autostart-linux.sh"
echo "For additional ChatGPT accounts on this same computer, run it again with a different --profile."
echo "The script auto-selects a free health port and stores the Runtime API key in a user-only local credential file outside the repository."
