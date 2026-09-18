#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REMOTE_COMMANDER_REPO_URL:-https://github.com/GOD13emad/ChatGPTRemoteCommander.git}"
INSTALL_DIR="${HOME}/.local/share/ChatGPTRemoteCommander"
POWER_MODE=0
STANDARD_MODE=0
MODE_SPECIFIED=0
START_SERVER=0
INSTALL_PREREQS=0
TUNNEL_VERSION="0.0.14"
SOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v0.5.0}"
EXPECTED_COMMIT="${REMOTE_COMMANDER_EXPECTED_COMMIT:-}"

usage() {
  cat <<'EOF'
Usage: install.sh [options]
  --install-dir PATH        Install/update directory
  --install-prerequisites   Install basic OS packages and portable Node 22+ if needed
  --power-mode              Enable local Full-Control policy
  --standard-mode           Explicitly disable Power Mode
  --source-ref REF          Install exact tag/branch/commit (default: v0.5.0)
  --expected-commit SHA     Refuse if REF does not resolve to this exact commit
  --start-server            Start MCP server with nohup after validation
  -h, --help                Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --install-prerequisites) INSTALL_PREREQS=1; shift ;;
    --power-mode) POWER_MODE=1; STANDARD_MODE=0; MODE_SPECIFIED=1; shift ;;
    --standard-mode) STANDARD_MODE=1; POWER_MODE=0; MODE_SPECIFIED=1; shift ;;
    --source-ref) SOURCE_REF="$2"; shift 2 ;;
    --expected-commit) EXPECTED_COMMIT="$2"; shift 2 ;;
    --start-server) START_SERVER=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done
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
  [[ -n "$SOURCE_REF" && "$SOURCE_REF" != -* && "$SOURCE_REF" != *..* && "$SOURCE_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || {
    echo "Invalid --source-ref" >&2; exit 2;
  }
  [[ -z "$EXPECTED_COMMIT" || "$EXPECTED_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || { echo "Invalid --expected-commit" >&2; exit 2; }
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" diff --quiet || { echo "Tracked working-tree changes detected; refusing overwrite." >&2; exit 1; }
    git -C "$INSTALL_DIR" diff --cached --quiet || { echo "Staged changes detected; refusing overwrite." >&2; exit 1; }
  elif [[ -e "$INSTALL_DIR" ]]; then
    echo "Install directory exists but is not a Git repository: $INSTALL_DIR" >&2
    exit 1
  else
    git clone --depth 1 --no-checkout "$REPO_URL" "$INSTALL_DIR"
  fi

  local target
  if [[ "$SOURCE_REF" =~ ^[0-9a-fA-F]{40}$ ]]; then
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$SOURCE_REF"
    target="$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)"
  elif [[ "$SOURCE_REF" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-A-Za-z0-9.]*)?$ ]]; then
    git -C "$INSTALL_DIR" fetch --force --depth 1 origin "refs/tags/$SOURCE_REF:refs/tags/$SOURCE_REF"
    target="$(git -C "$INSTALL_DIR" rev-parse "refs/tags/$SOURCE_REF^{commit}")"
  else
    git -C "$INSTALL_DIR" fetch --force --depth 1 origin "+refs/heads/$SOURCE_REF:refs/remotes/origin/$SOURCE_REF"
    target="$(git -C "$INSTALL_DIR" rev-parse "refs/remotes/origin/$SOURCE_REF^{commit}")"
  fi
  [[ "$target" =~ ^[0-9a-fA-F]{40}$ ]] || { echo "Could not resolve pinned source" >&2; exit 1; }
  if [[ -n "$EXPECTED_COMMIT" && "${target,,}" != "${EXPECTED_COMMIT,,}" ]]; then echo "Pinned source mismatch: ref $SOURCE_REF resolved to $target but release expects $EXPECTED_COMMIT" >&2; exit 1; fi
  git -C "$INSTALL_DIR" checkout --detach --force "$target"
  [[ "$(git -C "$INSTALL_DIR" rev-parse HEAD)" == "$target" ]] || { echo "Pinned source mismatch" >&2; exit 1; }
  echo "Pinned source installed: ref=$SOURCE_REF commit=$target"
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
  local machine arch asset dir tmp extract expected_archive actual_archive verified_exe verified_exe_hash installed_hash base
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported tunnel-client architecture: $machine" >&2; exit 1 ;;
  esac
  dir="$INSTALL_DIR/tools/tunnel-client-v$TUNNEL_VERSION-linux-$arch"
  asset="tunnel-client-v$TUNNEL_VERSION-linux-$arch.zip"
  tmp="$(mktemp -d)"
  extract="$tmp/verified"
  mkdir -p "$extract"
  base="https://github.com/openai/tunnel-client/releases/download/v$TUNNEL_VERSION"

  curl -fsSL "$base/SHA256SUMS.txt" -o "$tmp/SHA256SUMS.txt"
  curl -fsSL "$base/$asset" -o "$tmp/$asset"
  expected_archive="$(awk -v f="$asset" '$2==f {print $1}' "$tmp/SHA256SUMS.txt")"
  [[ -n "$expected_archive" ]] || { echo "Missing tunnel-client checksum" >&2; rm -rf "$tmp"; exit 1; }
  actual_archive="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  [[ "$actual_archive" == "$expected_archive" ]] || { echo "tunnel-client archive SHA-256 verification failed" >&2; rm -rf "$tmp"; exit 1; }

  unzip -q "$tmp/$asset" -d "$extract"
  verified_exe="$extract/tunnel-client"
  [[ -f "$verified_exe" ]] || { echo "tunnel-client missing from verified archive" >&2; rm -rf "$tmp"; exit 1; }
  verified_exe_hash="$(sha256sum "$verified_exe" | awk '{print $1}')"

  if [[ -x "$dir/tunnel-client" ]]; then
    installed_hash="$(sha256sum "$dir/tunnel-client" | awk '{print $1}')"
  else
    installed_hash=""
  fi
  if [[ "$installed_hash" != "$verified_exe_hash" ]]; then
    rm -rf "$dir"
    mkdir -p "$(dirname "$dir")"
    mv "$extract" "$dir"
    chmod +x "$dir/tunnel-client" "$dir/cloudflared" 2>/dev/null || true
  fi

  installed_hash="$(sha256sum "$dir/tunnel-client" | awk '{print $1}')"
  [[ "$installed_hash" == "$verified_exe_hash" ]] || { echo "Installed tunnel-client does not match verified release archive" >&2; rm -rf "$tmp"; exit 1; }
  printf '{"version":"%s","relativePath":"%s","sha256":"%s","archiveSha256":"%s"}\n' "$TUNNEL_VERSION" "tools/tunnel-client-v$TUNNEL_VERSION-linux-$arch/tunnel-client" "$verified_exe_hash" "$expected_archive" > "$INSTALL_DIR/tools/tunnel-client.active.json.tmp"
  mv "$INSTALL_DIR/tools/tunnel-client.active.json.tmp" "$INSTALL_DIR/tools/tunnel-client.active.json"
  rm -rf "$tmp"
  echo "Official OpenAI tunnel-client verified from release archive and pinned: $dir/tunnel-client"
}

write_local_config() {
  local workspace="$HOME/source/repos"
  local cfg="$INSTALL_DIR/config.local.json"
  local public_cfg="$INSTALL_DIR/config.json"
  local backup_dir="$INSTALL_DIR/var/config-backups"
  local mode=preserve
  mkdir -p "$workspace" "$backup_dir"
  if [[ "$MODE_SPECIFIED" -eq 1 ]]; then
    [[ "$POWER_MODE" -eq 1 ]] && mode=power || mode=standard
  elif [[ ! -f "$cfg" ]]; then
    mode=standard
  fi
  if [[ -f "$cfg" && "$mode" != preserve ]]; then
    cp "$cfg" "$backup_dir/config.local.$(date +%Y%m%d-%H%M%S).json"
  fi
  result="$(node "$INSTALL_DIR/tools/merge-config.mjs" --config "$cfg" --public "$public_cfg" --mode "$mode" --workspace "$workspace" --platform linux)"
  echo "Local policy result: $result"
}

validate_installation() {
  cd "$INSTALL_DIR"
  npm run check
  npm test
  npm run audit
}

runtime_config_path() {
  [[ -f "$INSTALL_DIR/config.local.json" ]] && printf '%s\n' "$INSTALL_DIR/config.local.json" || printf '%s\n' "$INSTALL_DIR/config.json"
}
expected_version() { sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$INSTALL_DIR/package.json" | head -n1; }
expected_instance() { readlink -f "$INSTALL_DIR" | tr -d '\n' | sha256sum | awk '{print substr($1,1,24)}'; }
expected_config_hash() { sha256sum "$(runtime_config_path)" | awk '{print $1}'; }

health_matches() {
  local h="$1" v i c
  v="$(expected_version)"; i="$(expected_instance)"; c="$(expected_config_hash)"
  [[ "$h" == *'"ok":true'* && "$h" == *"\"version\":\"$v\""* && "$h" == *"\"instanceId\":\"$i\""* && "$h" == *"\"configSha256\":\"$c\""* ]]
}

port_47831_listening() {
  if command -v ss >/dev/null 2>&1; then ss -ltnH 'sport = :47831' 2>/dev/null | grep -q .
  elif command -v netstat >/dev/null 2>&1; then netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '[:.]47831$'
  else return 1; fi
}

owned_mcp_pids() {
  local pid args cwd
  while read -r pid args; do
    [[ -n "$pid" ]] || continue
    [[ "$args" == *"src/server-v0.3.mjs"* ]] || continue
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [[ "$cwd" == "$(readlink -f "$INSTALL_DIR")" ]] && printf '%s\n' "$pid"
  done < <(ps -eo pid=,args=)
}

write_runtime_state() {
  mkdir -p "$INSTALL_DIR/var"
  local state="$INSTALL_DIR/var/runtime-state.json"
  local tmp="$INSTALL_DIR/var/runtime-state.json.tmp.$$"
  local root ref commit version instance cfg
  root="$(readlink -f "$INSTALL_DIR")"; ref="$SOURCE_REF"; commit="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
  version="$(expected_version)"; instance="$(expected_instance)"; cfg="$(expected_config_hash)"
  node -e 'const fs=require("fs"); const [p,root,ref,commit,version,instance,cfg]=process.argv.slice(1); fs.writeFileSync(p, JSON.stringify({installRoot:root,sourceRef:ref,sourceCommit:commit,packageVersion:version,instanceId:instance,configSha256:cfg,updatedAt:new Date().toISOString()},null,2)+"\n")' "$tmp" "$root" "$ref" "$commit" "$version" "$instance" "$cfg"
  mv "$tmp" "$state"
}

start_server() {
  [[ "$START_SERVER" == "1" ]] || return 0
  mkdir -p "$INSTALL_DIR/var"
  local health pids pid
  health="$(curl -fsS --max-time 2 http://127.0.0.1:47831/health 2>/dev/null || true)"
  if health_matches "$health"; then echo 'MCP server already matches version/config identity.'; return 0; fi
  if [[ -n "$health" ]] || port_47831_listening; then
    pids="$(owned_mcp_pids)"
    [[ -n "$pids" ]] || { echo 'Port 47831 is occupied by a different or unowned runtime; refusing to stop it.' >&2; exit 1; }
    while read -r pid; do [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; done <<< "$pids"
  fi
  (cd "$INSTALL_DIR"; nohup ./run-server.sh > var/server.log 2>&1 & echo $! > var/server.pid)
  for _ in $(seq 1 60); do
    sleep 0.25
    health="$(curl -fsS --max-time 2 http://127.0.0.1:47831/health 2>/dev/null || true)"
    if health_matches "$health"; then echo 'MCP server started with expected version/config identity.'; return 0; fi
  done
  echo "Server failed to reach expected identity; see $INSTALL_DIR/var/server.log" >&2
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
write_runtime_state
start_server

echo
echo "INSTALL_PASS"
echo "Installed at: $INSTALL_DIR"
echo "Mode: $(node "$INSTALL_DIR/tools/config-mode.mjs" "$(runtime_config_path)")"
echo "Device: $(hostname)"
echo "Source: ref=$SOURCE_REF commit=$(git -C "$INSTALL_DIR" rev-parse HEAD) expected=${EXPECTED_COMMIT:-not-stamped}"
echo
echo "Next: create a distinct OpenAI Secure MCP Tunnel for this computer, then run once:"
echo "  $INSTALL_DIR/enable-autostart-linux.sh"
echo "For additional ChatGPT accounts on this same computer, run it again with a different --profile."
echo "The script auto-selects a free health port and stores the Runtime API key in a user-only local credential file outside the repository."
