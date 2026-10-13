#!/bin/sh
# Explicit Linux-only local model launcher. Never starts Ollama or changes user services.
set -eu
RC_MODEL_PROVIDER=ollama
RC_MODEL_NAME=rc-qwen3-4b:q4km
export RC_MODEL_PROVIDER RC_MODEL_NAME
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec /usr/bin/node "$SCRIPT_DIR/adapter.mjs"
