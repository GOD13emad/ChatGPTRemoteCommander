#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/.local/share/ChatGPTRemoteCommander"
SELF_TEST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --self-test) SELF_TEST=1; shift ;;
    -h|--help)
      echo 'Usage: install-tunnel-client-linux.sh [--install-dir PATH] [--self-test]'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN_FILE="$TOOLS_DIR/tunnel-client-pin.json"
JSON_FIELD="$TOOLS_DIR/json-field.mjs"
[[ -f "$PIN_FILE" && -f "$JSON_FIELD" ]] || { echo 'Tunnel-client pin metadata is missing.' >&2; exit 1; }

VERSION="$(node "$JSON_FIELD" --file "$PIN_FILE" --field version)"
RELEASE_TAG="$(node "$JSON_FIELD" --file "$PIN_FILE" --field releaseTag)"
UPSTREAM_COMMIT="$(node "$JSON_FIELD" --file "$PIN_FILE" --field upstreamCommit)"
SUMS_SHA="$(node "$JSON_FIELD" --file "$PIN_FILE" --field sha256sumsSha256)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid tunnel-client pinned version.' >&2; exit 1; }
[[ "$RELEASE_TAG" == "v$VERSION" ]] || { echo 'Tunnel-client release tag/version mismatch.' >&2; exit 1; }
[[ "$UPSTREAM_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid tunnel-client upstream commit pin.' >&2; exit 1; }
[[ "$SUMS_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid tunnel-client checksum-manifest pin.' >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported tunnel-client architecture: $(uname -m)" >&2; exit 1 ;;
esac

ASSET="tunnel-client-v${VERSION}-linux-${ARCH}.zip"
BASE="https://github.com/openai/tunnel-client/releases/download/${RELEASE_TAG}"
FINAL_DIR="$INSTALL_DIR/tools/tunnel-client-v${VERSION}-linux-${ARCH}"
FINAL_EXE="$FINAL_DIR/tunnel-client"
VAR_DIR="$INSTALL_DIR/var"
META_FILE="$VAR_DIR/tunnel-client-installed.json"

if [[ "$SELF_TEST" == 1 ]]; then
  printf '{"ok":true,"version":"%s","tag":"%s","asset":"%s","manifestSha256":"%s"}\n' "$VERSION" "$RELEASE_TAG" "$ASSET" "$SUMS_SHA"
  exit 0
fi

for cmd in node curl sha256sum unzip; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "$cmd is required for tunnel-client installation." >&2; exit 1; }
done
mkdir -p "$INSTALL_DIR/tools" "$VAR_DIR"

verify_existing() {
  [[ -x "$FINAL_EXE" ]] || return 1
  local actual
  actual="$("$FINAL_EXE" --version 2>/dev/null || true)"
  [[ "$actual" == "$VERSION+$UPSTREAM_COMMIT"* ]]
}

if [[ -e "$FINAL_DIR" ]]; then
  verify_existing || { echo "Existing pinned tunnel-client is incomplete or has the wrong version: $FINAL_DIR" >&2; exit 1; }
  echo "TUNNEL_CLIENT_INSTALL_REUSE version=$VERSION path=$FINAL_EXE"
  exit 0
fi

TMP="$(mktemp -d "${VAR_DIR}/tunnel-install-${VERSION}.XXXXXX")"
STAGE="${FINAL_DIR}.stage-$$"
cleanup(){
  rm -rf "$TMP" "$STAGE"
}
trap cleanup EXIT

curl --fail --silent --show-error --location --connect-timeout 15 --max-time 180 "$BASE/SHA256SUMS.txt" -o "$TMP/SHA256SUMS.txt"
ACTUAL_SUMS_SHA="$(sha256sum "$TMP/SHA256SUMS.txt" | awk '{print $1}')"
[[ "$ACTUAL_SUMS_SHA" == "$SUMS_SHA" ]] || { echo 'Tunnel-client SHA256SUMS pin mismatch.' >&2; exit 1; }

EXPECTED_ASSET_SHA="$(awk -v f="$ASSET" '$2==f {print $1}' "$TMP/SHA256SUMS.txt" | head -n1)"
[[ "$EXPECTED_ASSET_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "Pinned tunnel-client asset is absent from SHA256SUMS: $ASSET" >&2; exit 1; }

curl --fail --silent --show-error --location --connect-timeout 15 --max-time 180 "$BASE/$ASSET" -o "$TMP/$ASSET"
ACTUAL_ASSET_SHA="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"
[[ "$ACTUAL_ASSET_SHA" == "$EXPECTED_ASSET_SHA" ]] || { echo 'Tunnel-client asset SHA-256 mismatch.' >&2; exit 1; }

mkdir -p "$STAGE"
unzip -q "$TMP/$ASSET" -d "$STAGE"
chmod +x "$STAGE/tunnel-client" "$STAGE/cloudflared" 2>/dev/null || true
[[ -x "$STAGE/tunnel-client" ]] || { echo 'Tunnel-client archive did not contain an executable tunnel-client.' >&2; exit 1; }
VERSION_TEXT="$("$STAGE/tunnel-client" --version 2>&1)"
[[ "$VERSION_TEXT" == "$VERSION+$UPSTREAM_COMMIT"* ]] || { echo "Tunnel-client binary provenance mismatch: $VERSION_TEXT" >&2; exit 1; }
BINARY_SHA="$(sha256sum "$STAGE/tunnel-client" | awk '{print $1}')"

mv "$STAGE" "$FINAL_DIR"
TMP_META="$META_FILE.tmp-$$"
cat > "$TMP_META" <<EOF
{
  "schema": 1,
  "version": "$VERSION",
  "releaseTag": "$RELEASE_TAG",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "asset": "$ASSET",
  "assetSha256": "$ACTUAL_ASSET_SHA",
  "binarySha256": "$BINARY_SHA"
}
EOF
mv "$TMP_META" "$META_FILE"
trap - EXIT
rm -rf "$TMP"

echo "TUNNEL_CLIENT_INSTALL_PASS version=$VERSION assetSha256=$ACTUAL_ASSET_SHA binarySha256=$BINARY_SHA path=$FINAL_EXE"
