#!/bin/sh
# Explicit Linux-only local model launcher. Never starts a model server or changes user services.
set -eu
RC_MODEL_PROVIDER=llamacpp
RC_MODEL_NAME=rc-qwen3-4b:q4km
KEY_FILE="${HOME:?}/.config/rc-local-ai/llamacpp-api-key"
test -f "$KEY_FILE" && test -r "$KEY_FILE" && test "$(stat -c '%a' "$KEY_FILE")" = 600
LLAMA_CPP_API_KEY=$(cat "$KEY_FILE")
test -n "$LLAMA_CPP_API_KEY"
export RC_MODEL_PROVIDER RC_MODEL_NAME LLAMA_CPP_API_KEY
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec /usr/bin/node "$SCRIPT_DIR/adapter.mjs"
