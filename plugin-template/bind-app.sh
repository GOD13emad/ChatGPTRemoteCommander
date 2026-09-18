#!/usr/bin/env bash
set -euo pipefail
APP_ID="${1:-}"
[[ "$APP_ID" =~ ^(asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+$ ]] || {
  echo 'App ID must start with asdk_app_, connector_, or templated_apps_.' >&2
  exit 2
}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
APP_ID="$APP_ID" node --input-type=module <<'NODE'
import fs from 'node:fs';
const id=process.env.APP_ID;
const manifest=JSON.parse(fs.readFileSync('plugin.json','utf8'));
manifest.extensions ??= {};
manifest.extensions['com.openai'] ??= {};
manifest.extensions['com.openai'].apps='./.app.json';
const app={apps:{'remote-commander':{id,required:true}}};
fs.writeFileSync('.app.json',JSON.stringify(app,null,2)+'\n');
fs.writeFileSync('plugin.json',JSON.stringify(manifest,null,2)+'\n');
console.log('PLUGIN_APP_BOUND id='+id);
NODE
