#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$ROOT/.runtime/node-current/bin/node" ]]; then
  export PATH="$ROOT/.runtime/node-current/bin:$PATH"
fi
cd "$ROOT"
exec npm start
