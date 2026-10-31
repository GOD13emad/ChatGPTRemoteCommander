#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
command -v node >/dev/null 2>&1 || { echo 'Node.js 22 or newer is required' >&2; exit 1; }
exec node tools/hybrid-quickstart.mjs --serve "$@"
