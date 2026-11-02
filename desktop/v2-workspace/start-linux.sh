#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required." >&2
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
echo "Launching owner-local Commander V2 Workspace…"
exec node server.mjs
