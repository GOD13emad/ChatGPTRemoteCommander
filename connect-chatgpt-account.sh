#!/usr/bin/env bash
set -euo pipefail

PROFILE=""
HEALTH_PORT="0"
TUNNEL_ID=""
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

usage() { echo "Usage: $0 --profile NAME [--health-port PORT] [--tunnel-id tunnel_...]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --health-port) HEALTH_PORT="$2"; shift 2 ;;
    --tunnel-id) TUNNEL_ID="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done
[[ -n "$PROFILE" ]] || { echo '--profile is required' >&2; exit 2; }

args=(--profile "$PROFILE" --health-port "$HEALTH_PORT")
[[ -n "$TUNNEL_ID" ]] && args+=(--tunnel-id "$TUNNEL_ID")

echo 'Persistent multi-account enrollment is active; foreground duplicate tunnels are not started.'
"$ROOT/enable-autostart-linux.sh" "${args[@]}"
echo
echo "ACCOUNT_CONNECT_PASS profile=$PROFILE mode=persistent-autostart"
echo 'The background supervisor manages this account tunnel.'
