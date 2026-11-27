#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/.local/share/ChatGPTRemoteCommander"
SELF_TEST=0
VERIFY_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --self-test) SELF_TEST=1; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    -h|--help)
      echo 'Usage: install-tunnel-client-linux.sh [--install-dir PATH] [--self-test] [--verify-only]'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIN_FILE="$TOOLS_DIR/tunnel-client-pin.json"
JSON_FIELD="$TOOLS_DIR/json-field.mjs"
[[ -f "$PIN_FILE" && ! -L "$PIN_FILE" && -f "$JSON_FIELD" && ! -L "$JSON_FIELD" ]] || { echo 'Tunnel-client pin metadata is missing.' >&2; exit 1; }

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
PLATFORM_KEY="linux-$ARCH"
ASSET="$(node "$JSON_FIELD" --file "$PIN_FILE" --field "assets.$PLATFORM_KEY.file")"
ASSET_SHA="$(node "$JSON_FIELD" --file "$PIN_FILE" --field "assets.$PLATFORM_KEY.sha256")"
BINARY_SHA="$(node "$JSON_FIELD" --file "$PIN_FILE" --field "assets.$PLATFORM_KEY.binarySha256")"
CLOUDFLARED_SHA="$(node "$JSON_FIELD" --file "$PIN_FILE" --field "assets.$PLATFORM_KEY.cloudflaredSha256")"
[[ "$ASSET" == "tunnel-client-v$VERSION-linux-$ARCH.zip" ]] || { echo 'Tunnel-client pinned asset name mismatch.' >&2; exit 1; }
[[ "$ASSET_SHA" =~ ^[0-9a-f]{64}$ && "$BINARY_SHA" =~ ^[0-9a-f]{64}$ && "$CLOUDFLARED_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo 'Tunnel-client pinned asset/binary hash invalid.' >&2; exit 1; }

BASE="https://github.com/openai/tunnel-client/releases/download/$RELEASE_TAG"
FINAL_DIR="$INSTALL_DIR/tools/tunnel-client-v$VERSION-linux-$ARCH"
FINAL_EXE="$FINAL_DIR/tunnel-client"
CLOUDFLARED_EXE="$FINAL_DIR/cloudflared"
VAR_DIR="$INSTALL_DIR/var"
META_FILE="$VAR_DIR/tunnel-client-installed.json"
LEGACY_META_FILE="$VAR_DIR/tunnel-client.json"
ARCHIVE_RECEIPT="$FINAL_DIR/.verified-archive-sha256"
BINARY_RECEIPT="$FINAL_DIR/.verified-binary-sha256"

verify_binary_set() {
  [[ -d "$FINAL_DIR" && ! -L "$FINAL_DIR" && -x "$FINAL_EXE" && ! -L "$FINAL_EXE" && -x "$CLOUDFLARED_EXE" && ! -L "$CLOUDFLARED_EXE" ]] || return 1
  local actual_version actual_binary actual_cloudflared
  actual_binary="$(sha256sum "$FINAL_EXE" 2>/dev/null | awk '{print $1}')"
  actual_cloudflared="$(sha256sum "$CLOUDFLARED_EXE" 2>/dev/null | awk '{print $1}')"
  [[ "$actual_binary" == "$BINARY_SHA" && "$actual_cloudflared" == "$CLOUDFLARED_SHA" ]] || return 1
  actual_version="$("$FINAL_EXE" --version 2>/dev/null || true)"
  [[ "$actual_version" == "$VERSION+$UPSTREAM_COMMIT"* ]]
}

legacy_metadata_matches() {
  [[ -f "$META_FILE" && ! -L "$META_FILE" ]] || return 0
  local meta_version meta_tag meta_commit meta_asset meta_asset_sha meta_binary_sha
  meta_version="$(node "$JSON_FIELD" --file "$META_FILE" --field version 2>/dev/null || true)"
  meta_tag="$(node "$JSON_FIELD" --file "$META_FILE" --field releaseTag 2>/dev/null || true)"
  meta_commit="$(node "$JSON_FIELD" --file "$META_FILE" --field upstreamCommit 2>/dev/null || true)"
  meta_asset="$(node "$JSON_FIELD" --file "$META_FILE" --field asset 2>/dev/null || true)"
  meta_asset_sha="$(node "$JSON_FIELD" --file "$META_FILE" --field assetSha256 2>/dev/null || true)"
  meta_binary_sha="$(node "$JSON_FIELD" --file "$META_FILE" --field binarySha256 2>/dev/null || true)"
  [[ "$meta_version" == "$VERSION" && "$meta_tag" == "$RELEASE_TAG" && "$meta_commit" == "$UPSTREAM_COMMIT" && \
     "$meta_asset" == "$ASSET" && "$meta_asset_sha" == "$ASSET_SHA" && "$meta_binary_sha" == "$BINARY_SHA" ]]
}

verify_metadata() {
  [[ -f "$META_FILE" && ! -L "$META_FILE" ]] || return 1
  local meta_version meta_tag meta_commit meta_asset meta_asset_sha meta_binary_sha meta_cloudflared_sha verification receipt
  meta_version="$(node "$JSON_FIELD" --file "$META_FILE" --field version 2>/dev/null || true)"
  meta_tag="$(node "$JSON_FIELD" --file "$META_FILE" --field releaseTag 2>/dev/null || true)"
  meta_commit="$(node "$JSON_FIELD" --file "$META_FILE" --field upstreamCommit 2>/dev/null || true)"
  meta_asset="$(node "$JSON_FIELD" --file "$META_FILE" --field asset 2>/dev/null || true)"
  meta_asset_sha="$(node "$JSON_FIELD" --file "$META_FILE" --field assetSha256 2>/dev/null || true)"
  meta_binary_sha="$(node "$JSON_FIELD" --file "$META_FILE" --field binarySha256 2>/dev/null || true)"
  meta_cloudflared_sha="$(node "$JSON_FIELD" --file "$META_FILE" --field cloudflaredSha256 2>/dev/null || true)"
  verification="$(node "$JSON_FIELD" --file "$META_FILE" --field verification 2>/dev/null || true)"
  [[ "$meta_version" == "$VERSION" && "$meta_tag" == "$RELEASE_TAG" && "$meta_commit" == "$UPSTREAM_COMMIT" && \
     "$meta_asset" == "$ASSET" && "$meta_asset_sha" == "$ASSET_SHA" && "$meta_binary_sha" == "$BINARY_SHA" && \
     "$meta_cloudflared_sha" == "$CLOUDFLARED_SHA" ]] || return 1
  if [[ -f "$ARCHIVE_RECEIPT" && ! -L "$ARCHIVE_RECEIPT" ]]; then
    receipt="$(tr -d '\r\n ' < "$ARCHIVE_RECEIPT")"
    [[ "$receipt" == "$ASSET_SHA" && "$verification" == archive-and-binary-set-sha256 ]]
  elif [[ -f "$BINARY_RECEIPT" && ! -L "$BINARY_RECEIPT" ]]; then
    receipt="$(tr -d '\r\n ' < "$BINARY_RECEIPT")"
    [[ "$receipt" == "$BINARY_SHA:$CLOUDFLARED_SHA" && "$verification" == binary-set-sha256 ]]
  else
    return 1
  fi
}

write_metadata() {
  mkdir -p "$VAR_DIR"
  local verification
  if [[ -f "$ARCHIVE_RECEIPT" ]]; then verification=archive-and-binary-set-sha256
  else verification=binary-set-sha256; fi
  local tmp="$META_FILE.tmp-$$"
  [[ ! -e "$tmp" && ! -L "$tmp" ]] || { echo 'TUNNEL_CLIENT_METADATA_STAGE_COLLISION' >&2; return 1; }
  cat > "$tmp" <<EOF
{
  "schema": 1,
  "version": "$VERSION",
  "releaseTag": "$RELEASE_TAG",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "asset": "$ASSET",
  "assetSha256": "$ASSET_SHA",
  "binarySha256": "$BINARY_SHA",
  "cloudflaredSha256": "$CLOUDFLARED_SHA",
  "verification": "$verification"
}
EOF
  chmod 600 "$tmp"
  mv -f -- "$tmp" "$META_FILE"
}

if [[ "$SELF_TEST" == 1 ]]; then
  printf '{"ok":true,"version":"%s","tag":"%s","asset":"%s","assetSha256":"%s","binarySha256":"%s","cloudflaredSha256":"%s"}\n' \
    "$VERSION" "$RELEASE_TAG" "$ASSET" "$ASSET_SHA" "$BINARY_SHA" "$CLOUDFLARED_SHA"
  exit 0
fi

if [[ "$VERIFY_ONLY" == 1 ]]; then
  verify_binary_set && verify_metadata || { echo 'TUNNEL_CLIENT_EXISTING_PROVENANCE_INVALID' >&2; exit 1; }
  echo "TUNNEL_CLIENT_VERIFY_PASS version=$VERSION path=$FINAL_EXE"
  exit 0
fi

for cmd in node curl sha256sum unzip; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "$cmd is required for tunnel-client installation." >&2; exit 1; }
done
mkdir -p "$INSTALL_DIR/tools" "$VAR_DIR"
if [[ -e "$FINAL_DIR" || -L "$FINAL_DIR" ]]; then
  verify_binary_set || { echo "TUNNEL_CLIENT_EXISTING_UNVERIFIED_PRESERVED path=$FINAL_DIR" >&2; exit 1; }
  legacy_metadata_matches || { echo "TUNNEL_CLIENT_EXISTING_METADATA_MISMATCH_PRESERVED path=$META_FILE" >&2; exit 1; }
  if [[ -e "$ARCHIVE_RECEIPT" || -L "$ARCHIVE_RECEIPT" ]]; then
    [[ -f "$ARCHIVE_RECEIPT" && ! -L "$ARCHIVE_RECEIPT" && "$(tr -d '\r\n ' < "$ARCHIVE_RECEIPT")" == "$ASSET_SHA" ]] || {
      echo "TUNNEL_CLIENT_EXISTING_ARCHIVE_RECEIPT_MISMATCH_PRESERVED path=$ARCHIVE_RECEIPT" >&2; exit 1;
    }
  elif [[ -e "$BINARY_RECEIPT" || -L "$BINARY_RECEIPT" ]]; then
    [[ -f "$BINARY_RECEIPT" && ! -L "$BINARY_RECEIPT" && "$(tr -d '\r\n ' < "$BINARY_RECEIPT")" == "$BINARY_SHA:$CLOUDFLARED_SHA" ]] || {
      echo "TUNNEL_CLIENT_EXISTING_BINARY_RECEIPT_MISMATCH_PRESERVED path=$BINARY_RECEIPT" >&2; exit 1;
    }
  else
    printf '%s\n' "$BINARY_SHA:$CLOUDFLARED_SHA" > "$BINARY_RECEIPT"
    chmod 600 "$BINARY_RECEIPT"
  fi
  write_metadata
  verify_metadata || { echo 'TUNNEL_CLIENT_METADATA_ADOPTION_FAILED' >&2; exit 1; }
  echo "TUNNEL_CLIENT_INSTALL_REUSE version=$VERSION path=$FINAL_EXE"
  exit 0
fi

curl_release_fetch() {
  local url="$1" output="$2"
  # Release GETs are idempotent. Retry only curl's transient-error class
  # (including HTTP 408/429/500/502/503/504) plus connection-refused,
  # while keeping the existing timeout and mandatory SHA/provenance checks.
  curl --fail --silent --show-error --location \
    --connect-timeout 15 --max-time 180 \
    --retry 4 --retry-delay 2 --retry-max-time 90 --retry-connrefused \
    "$url" -o "$output"
}

TMP="$(mktemp -d "${VAR_DIR}/tunnel-install-${VERSION}.XXXXXX")"
STAGE="${FINAL_DIR}.stage-$$"
cleanup(){
  rm -rf -- "$TMP" "$STAGE"
}
trap cleanup EXIT

curl_release_fetch "$BASE/SHA256SUMS.txt" "$TMP/SHA256SUMS.txt"
ACTUAL_SUMS_SHA="$(sha256sum "$TMP/SHA256SUMS.txt" | awk '{print $1}')"
[[ "$ACTUAL_SUMS_SHA" == "$SUMS_SHA" ]] || { echo 'Tunnel-client SHA256SUMS pin mismatch.' >&2; exit 1; }
EXPECTED_ASSET_SHA="$(awk -v f="$ASSET" '$2==f {print $1}' "$TMP/SHA256SUMS.txt" | head -n1)"
[[ "$EXPECTED_ASSET_SHA" == "$ASSET_SHA" ]] || { echo "Pinned tunnel-client asset is absent from SHA256SUMS: $ASSET" >&2; exit 1; }

curl_release_fetch "$BASE/$ASSET" "$TMP/$ASSET"
ACTUAL_ASSET_SHA="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"
[[ "$ACTUAL_ASSET_SHA" == "$EXPECTED_ASSET_SHA" ]] || { echo 'Tunnel-client asset SHA-256 mismatch.' >&2; exit 1; }

mkdir -p "$STAGE"
unzip -q "$TMP/$ASSET" -d "$STAGE"
chmod +x "$STAGE/tunnel-client" "$STAGE/cloudflared" 2>/dev/null || true
[[ -x "$STAGE/tunnel-client" && ! -L "$STAGE/tunnel-client" && -x "$STAGE/cloudflared" && ! -L "$STAGE/cloudflared" ]] || {
  echo 'Tunnel-client archive did not contain both executable tunnel-client and cloudflared.' >&2; exit 1;
}
BINARY_ACTUAL_SHA="$(sha256sum "$STAGE/tunnel-client" | awk '{print $1}')"
CLOUDFLARED_ACTUAL_SHA="$(sha256sum "$STAGE/cloudflared" | awk '{print $1}')"
[[ "$BINARY_ACTUAL_SHA" == "$BINARY_SHA" && "$CLOUDFLARED_ACTUAL_SHA" == "$CLOUDFLARED_SHA" ]] || {
  echo 'Tunnel-client binary-set SHA-256 mismatch.' >&2; exit 1;
}

VERSION_TEXT="$("$STAGE/tunnel-client" --version 2>&1)"
[[ "$VERSION_TEXT" == "$VERSION+$UPSTREAM_COMMIT"* ]] || { echo "Tunnel-client binary provenance mismatch: $VERSION_TEXT" >&2; exit 1; }

printf '%s\n' "$ASSET_SHA" > "$STAGE/.verified-archive-sha256"
mkdir -p "$VAR_DIR"
TMP_META="$META_FILE.tmp-$$"
cat > "$TMP_META" <<EOF
{
  "schema": 1,
  "version": "$VERSION",
  "releaseTag": "$RELEASE_TAG",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "asset": "$ASSET",
  "assetSha256": "$ASSET_SHA",
  "binarySha256": "$BINARY_SHA",
  "cloudflaredSha256": "$CLOUDFLARED_SHA",
  "verification": "archive-and-binary-set-sha256"
}
EOF
chmod 600 "$TMP_META"
mv "$STAGE" "$FINAL_DIR"
mv "$TMP_META" "$META_FILE"
trap - EXIT
rm -rf "$TMP"
echo "TUNNEL_CLIENT_INSTALL_PASS version=$VERSION assetSha256=$ASSET_SHA binarySha256=$BINARY_SHA cloudflaredSha256=$CLOUDFLARED_SHA path=$FINAL_EXE"
