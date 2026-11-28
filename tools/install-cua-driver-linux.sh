#!/usr/bin/env bash
set -euo pipefail

PIN_FILE=""
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
VERIFY_ONLY=0
SELF_TEST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pin-file) PIN_FILE="$2"; shift 2 ;;
    --data-home) DATA_HOME="$2"; shift 2 ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --self-test) SELF_TEST=1; shift ;;
    -h|--help)
      echo 'Usage: install-cua-driver-linux.sh [--pin-file PATH] [--data-home PATH] [--verify-only] [--self-test]'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -n "$PIN_FILE" ]] || PIN_FILE="$TOOLS_DIR/cua-driver-pin.json"
JSON_FIELD="$TOOLS_DIR/json-field.mjs"
[[ -f "$PIN_FILE" && ! -L "$PIN_FILE" && -f "$JSON_FIELD" && ! -L "$JSON_FIELD" ]] || { echo 'CUA_DRIVER_PIN_METADATA_MISSING' >&2; exit 1; }
[[ "$DATA_HOME" == /* ]] || { echo 'CUA_DRIVER_DATA_HOME_MUST_BE_ABSOLUTE' >&2; exit 1; }
[[ ! -L "$DATA_HOME" ]] || { echo 'CUA_DRIVER_DATA_HOME_SYMLINK_REJECTED' >&2; exit 1; }

VERSION="$(node "$JSON_FIELD" --file "$PIN_FILE" --field version)"
RELEASE_TAG="$(node "$JSON_FIELD" --file "$PIN_FILE" --field releaseTag)"
UPSTREAM_COMMIT="$(node "$JSON_FIELD" --file "$PIN_FILE" --field upstreamCommit)"
SUMS_SHA="$(node "$JSON_FIELD" --file "$PIN_FILE" --field sha256sumsSha256)"
[[ "$VERSION" == 0.38.0 && "$RELEASE_TAG" == "cua-driver-rs-v$VERSION" ]] || { echo 'CUA_DRIVER_PIN_VERSION_INVALID' >&2; exit 1; }
[[ "$UPSTREAM_COMMIT" =~ ^[0-9a-f]{40}$ && "$SUMS_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo 'CUA_DRIVER_PIN_PROVENANCE_INVALID' >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "CUA_DRIVER_UNSUPPORTED_ARCH: $(uname -m)" >&2; exit 1 ;;
esac
PLATFORM_KEY="linux-$ARCH"
ASSET="$(node "$JSON_FIELD" --file "$PIN_FILE" --field "assets.$PLATFORM_KEY.file")"
ASSET_SHA="$(node "$JSON_FIELD" --file "$PIN_FILE" --field "assets.$PLATFORM_KEY.sha256")"
BINARY="$(node "$JSON_FIELD" --file "$PIN_FILE" --field "assets.$PLATFORM_KEY.binary")"
BINARY_SHA="$(node "$JSON_FIELD" --file "$PIN_FILE" --field "assets.$PLATFORM_KEY.binarySha256")"
[[ "$ASSET" == "cua-driver-rs-$VERSION-linux-"*"-binary.tar.gz" && "$BINARY" == cua-driver ]] || { echo 'CUA_DRIVER_PIN_ASSET_INVALID' >&2; exit 1; }
[[ "$ASSET_SHA" =~ ^[0-9a-f]{64}$ && "$BINARY_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo 'CUA_DRIVER_PIN_HASH_INVALID' >&2; exit 1; }

FINAL_DIR="$DATA_HOME/chatgpt-remote-commander/adapters/cua-driver/v$VERSION"
FINAL_EXE="$FINAL_DIR/$BINARY"
META_FILE="$FINAL_DIR/cua-driver-installed.json"
ARCHIVE_RECEIPT="$FINAL_DIR/.verified-archive-sha256"

verify_payload() {
  [[ -d "$FINAL_DIR" && ! -L "$FINAL_DIR" && -f "$FINAL_EXE" && -x "$FINAL_EXE" && ! -L "$FINAL_EXE" && -f "$ARCHIVE_RECEIPT" && ! -L "$ARCHIVE_RECEIPT" ]] || return 1
  local actual_version actual_sha receipt_sha
  actual_sha="$(sha256sum "$FINAL_EXE" 2>/dev/null | awk '{print $1}')"
  receipt_sha="$(tr -d '\r\n ' < "$ARCHIVE_RECEIPT")"
  [[ "$actual_sha" == "$BINARY_SHA" && "$receipt_sha" == "$ASSET_SHA" ]] || return 1
  if actual_version="$("$FINAL_EXE" --version 2>/dev/null)"; then
    :
  else
    printf 'CUA_DRIVER_VERSION_PROBE_FAILED exit=%s; verify native runtime libraries (libX11, libXi, libxkbcommon)\n' "$?" >&2
    return 1
  fi
  [[ "$actual_version" == "cua-driver $VERSION" ]]
}

verify_metadata() {
  [[ -f "$META_FILE" && ! -L "$META_FILE" ]] || return 1
  local meta_version meta_tag meta_commit meta_asset meta_asset_sha meta_binary_sha
  meta_version="$(node "$JSON_FIELD" --file "$META_FILE" --field version 2>/dev/null || true)"
  meta_tag="$(node "$JSON_FIELD" --file "$META_FILE" --field releaseTag 2>/dev/null || true)"
  meta_commit="$(node "$JSON_FIELD" --file "$META_FILE" --field upstreamCommit 2>/dev/null || true)"
  meta_asset="$(node "$JSON_FIELD" --file "$META_FILE" --field asset 2>/dev/null || true)"
  meta_asset_sha="$(node "$JSON_FIELD" --file "$META_FILE" --field assetSha256 2>/dev/null || true)"
  meta_binary_sha="$(node "$JSON_FIELD" --file "$META_FILE" --field binarySha256 2>/dev/null || true)"
  [[ "$meta_version" == "$VERSION" && "$meta_tag" == "$RELEASE_TAG" && \
     "$meta_commit" == "$UPSTREAM_COMMIT" && "$meta_asset" == "$ASSET" && \
     "$meta_asset_sha" == "$ASSET_SHA" && "$meta_binary_sha" == "$BINARY_SHA" ]]
}

write_metadata() {
  local tmp="$META_FILE.tmp-$$"
  [[ ! -e "$tmp" && ! -L "$tmp" ]] || { echo 'CUA_DRIVER_METADATA_STAGE_COLLISION' >&2; return 1; }
  cat > "$tmp" <<EOF
{
  "schema": 1,
  "version": "$VERSION",
  "releaseTag": "$RELEASE_TAG",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "asset": "$ASSET",
  "assetSha256": "$ASSET_SHA",
  "binarySha256": "$BINARY_SHA",
  "verification": "official-archive-receipt-and-binary-sha256"
}
EOF
  chmod 600 "$tmp"
  mv -f -- "$tmp" "$META_FILE"
}

if [[ "$SELF_TEST" == 1 ]]; then
  printf '{"ok":true,"version":"%s","releaseTag":"%s","asset":"%s","assetSha256":"%s","binarySha256":"%s"}\n' \
    "$VERSION" "$RELEASE_TAG" "$ASSET" "$ASSET_SHA" "$BINARY_SHA"
  exit 0
fi

if [[ "$VERIFY_ONLY" == 1 ]]; then
  verify_metadata && verify_payload || { echo 'CUA_DRIVER_EXISTING_PROVENANCE_INVALID' >&2; exit 1; }
  echo "CUA_DRIVER_VERIFY_PASS version=$VERSION path=$FINAL_EXE"
  exit 0
fi

mkdir -p "$(dirname "$FINAL_DIR")"
PARENT="$(dirname "$FINAL_DIR")"
[[ ! -L "$PARENT" ]] || { echo 'CUA_DRIVER_PARENT_SYMLINK_REJECTED' >&2; exit 1; }
if [[ -e "$FINAL_DIR" || -L "$FINAL_DIR" ]]; then
  verify_payload || { echo "CUA_DRIVER_EXISTING_UNVERIFIED_PRESERVED path=$FINAL_DIR" >&2; exit 1; }
  if [[ -e "$META_FILE" || -L "$META_FILE" ]]; then
    verify_metadata || { echo "CUA_DRIVER_EXISTING_METADATA_MISMATCH_PRESERVED path=$META_FILE" >&2; exit 1; }
  else
    write_metadata
    verify_metadata || { echo 'CUA_DRIVER_METADATA_ADOPTION_FAILED' >&2; exit 1; }
    echo "CUA_DRIVER_METADATA_ADOPTED version=$VERSION"
  fi
  echo "CUA_DRIVER_REUSE_PASS version=$VERSION path=$FINAL_EXE"
  exit 0
fi

STAGE="$(mktemp -d "$PARENT/.cua-driver-stage-$VERSION.XXXXXX")"
cleanup(){ rm -rf -- "$STAGE"; }
trap cleanup EXIT
mkdir -p "$STAGE/download" "$STAGE/extract"
BASE="https://github.com/trycua/cua/releases/download/$RELEASE_TAG"
curl --fail --silent --show-error --location --connect-timeout 15 --max-time 180 --retry 3 --retry-delay 2 \
  "$BASE/SHA256SUMS" -o "$STAGE/download/SHA256SUMS"
ACTUAL_SUMS_SHA="$(sha256sum "$STAGE/download/SHA256SUMS" | awk '{print $1}')"
[[ "$ACTUAL_SUMS_SHA" == "$SUMS_SHA" ]] || { echo 'CUA_DRIVER_SHA256SUMS_PIN_MISMATCH' >&2; exit 1; }
EXPECTED_ASSET_SHA="$(awk -v f="$ASSET" '$2==f {print $1}' "$STAGE/download/SHA256SUMS" | head -n1)"
[[ "$EXPECTED_ASSET_SHA" == "$ASSET_SHA" ]] || { echo 'CUA_DRIVER_RELEASE_ASSET_PIN_MISMATCH' >&2; exit 1; }
curl --fail --silent --show-error --location --connect-timeout 15 --max-time 180 --retry 3 --retry-delay 2 \
  "$BASE/$ASSET" -o "$STAGE/download/$ASSET"
ACTUAL_ASSET_SHA="$(sha256sum "$STAGE/download/$ASSET" | awk '{print $1}')"
[[ "$ACTUAL_ASSET_SHA" == "$ASSET_SHA" ]] || { echo 'CUA_DRIVER_ASSET_SHA_MISMATCH' >&2; exit 1; }
tar -xzf "$STAGE/download/$ASSET" -C "$STAGE/extract" --no-same-owner --no-same-permissions
EXTRACTED="$STAGE/extract/$BINARY"
[[ -f "$EXTRACTED" && ! -L "$EXTRACTED" ]] || { echo 'CUA_DRIVER_ARCHIVE_BINARY_MISSING' >&2; exit 1; }
ACTUAL_BINARY_SHA="$(sha256sum "$EXTRACTED" | awk '{print $1}')"
[[ "$ACTUAL_BINARY_SHA" == "$BINARY_SHA" ]] || { echo 'CUA_DRIVER_BINARY_SHA_MISMATCH' >&2; exit 1; }
chmod 700 "$EXTRACTED"
if VERSION_TEXT="$("$EXTRACTED" --version 2>&1)"; then
  :
else
  probe_rc=$?
  printf 'CUA_DRIVER_VERSION_PROBE_FAILED exit=%s; verify native runtime libraries (libX11, libXi, libxkbcommon)\n' "$probe_rc" >&2
  exit "$probe_rc"
fi
[[ "$VERSION_TEXT" == "cua-driver $VERSION" ]] || { echo "CUA_DRIVER_VERSION_MISMATCH: $VERSION_TEXT" >&2; exit 1; }
printf '%s\n' "$ASSET_SHA" > "$STAGE/extract/.verified-archive-sha256"
cat > "$STAGE/extract/cua-driver-installed.json" <<EOF
{
  "schema": 1,
  "version": "$VERSION",
  "releaseTag": "$RELEASE_TAG",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "asset": "$ASSET",
  "assetSha256": "$ASSET_SHA",
  "binarySha256": "$BINARY_SHA",
  "verification": "official-archive-and-binary-sha256"
}
EOF
chmod 600 "$STAGE/extract/cua-driver-installed.json"
mv "$STAGE/extract" "$FINAL_DIR"
trap - EXIT
rm -rf -- "$STAGE"
echo "CUA_DRIVER_INSTALL_PASS version=$VERSION assetSha256=$ASSET_SHA binarySha256=$BINARY_SHA path=$FINAL_EXE"
