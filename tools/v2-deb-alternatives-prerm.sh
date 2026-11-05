#!/bin/sh
# FPM/electron-builder v26 deb.fpm --before-remove candidate.
# dpkg calls prerm before removing package files. Remove only our registered
# alternative while its exact binary still exists, to avoid postrm warnings.
# Never remove another application's alternative or any profile/state data.
set -eu
if [ "$#" -ne 1 ]; then exit 0; fi
case "$1" in remove|upgrade) ;; *) exit 0 ;; esac
if ! command -v update-alternatives >/dev/null 2>&1; then exit 0; fi
if update-alternatives --query commander-v2 2>/dev/null |
   grep -Fxq 'Alternative: /opt/Commander V2/commander-v2'; then
  update-alternatives --remove commander-v2 '/opt/Commander V2/commander-v2'
fi
exit 0
