#!/usr/bin/env bash
# Build one native dpkg-managed Commander installation shared by Linux profiles.
# This is a source QA artifact, NOT a signed Stable release or permission grant.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
OUT="$ROOT/dist/installer/Remote-Commander-Linux-amd64.deb"
NODE_VERSION=22.23.3
NODE_ASSET="node-v$NODE_VERSION-linux-x64.tar.xz"
NODE_SHA256=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de
PACKAGE_DIR=/usr/lib/chatgpt-remote-commander
for executable in git node curl tar sha256sum dpkg-deb python3; do
  command -v "$executable" >/dev/null || { echo "Missing native package build prerequisite $executable" >&2; exit 2; }
done
test "$(uname -s)" = Linux && test "$(uname -m)" = x86_64 || {
  echo 'NATIVE_LINUX_PACKAGE_REQUIRES_LINUX_AMD64' >&2; exit 2;
}
test -z "$(git -C "$ROOT" status --porcelain)" || {
  echo 'NATIVE_LINUX_PACKAGE_REQUIRES_CLEAN_SOURCE' >&2; exit 3;
}
HEAD="$(git -C "$ROOT" rev-parse HEAD^{commit})"
EPOCH="$(git -C "$ROOT" show -s --format=%ct HEAD)"
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
if [[ "$VERSION" != 0.12.0-dev.1 ]]; then
  echo 'NATIVE_LINUX_QA_VERSION_NOT_APPROVED' >&2; exit 4
fi
node - "$ROOT/docs/release-train-0.12.json" "$VERSION" <<'NODE'
const fs=require('node:fs'),data=JSON.parse(fs.readFileSync(process.argv[2]));
if(data.train!=='0.12'||data.sourceVersion!==process.argv[3]
   ||data.status!=='INTEGRATION_CANDIDATE_NOT_FINAL'||data.channel!=='development'
   ||data.isStable!==false||data.publishApproved!==false
   ||data.autoupdateApproved!==false||data.installedPromotionApproved!==false
   ||data.releaseTag!==null)process.exit(1);
NODE
[[ ! -e "$OUT" && ! -L "$OUT" ]] || {
  echo 'NATIVE_LINUX_PACKAGE_OUTPUT_ALREADY_EXISTS' >&2; exit 5;
}
STAGE="$(mktemp -d /tmp/commander-v012-dpkg-build-XXXXXX)"
cleanup(){ rm -rf -- "$STAGE"; }
trap cleanup EXIT INT TERM
DEB="$STAGE/pkg"
APP="$DEB$PACKAGE_DIR/app"
RUNTIME="$DEB$PACKAGE_DIR/runtime"
mkdir -p "$APP" "$RUNTIME" "$DEB/DEBIAN" \
  "$DEB/usr/lib/systemd/user" \
  "$DEB/usr/share/doc/chatgpt-remote-commander"
git -C "$ROOT" archive --format=tar "$HEAD" | tar -xf - -C "$APP"
test "$(node -p 'require(process.argv[1]).version' "$APP/package.json")" = "$VERSION"
BASE="https://nodejs.org/dist/v$NODE_VERSION"
curl --fail --silent --show-error --location --retry 2 \
  --connect-timeout 6 --max-time 75 "$BASE/SHASUMS256.txt" -o "$STAGE/SHASUMS256.txt"
actual_manifest_line="$(grep -E "^[a-f0-9]{64}  $NODE_ASSET$" "$STAGE/SHASUMS256.txt")"
test "$actual_manifest_line" = "$NODE_SHA256  $NODE_ASSET" || {
  echo 'NODE_OFFICIAL_MANIFEST_PIN_MISMATCH' >&2; exit 6;
}
curl --fail --silent --show-error --location --retry 2 \
  --connect-timeout 6 --max-time 180 "$BASE/$NODE_ASSET" -o "$STAGE/$NODE_ASSET"
printf '%s  %s\n' "$NODE_SHA256" "$STAGE/$NODE_ASSET" | sha256sum -c --status || {
  echo 'NODE_RUNTIME_SHA_MISMATCH' >&2; exit 7;
}
tar -xJf "$STAGE/$NODE_ASSET" --strip-components=2 -C "$RUNTIME" \
  "node-v$NODE_VERSION-linux-x64/bin/node"
tar -xJf "$STAGE/$NODE_ASSET" --strip-components=1 -C "$RUNTIME" \
  "node-v$NODE_VERSION-linux-x64/LICENSE"
chmod 755 "$RUNTIME/node"
test "$("$RUNTIME/node" --version)" = "v$NODE_VERSION"
cat > "$DEB/DEBIAN/control" <<EOF
Package: chatgpt-remote-commander
Version: 0.12.0~dev1-1
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Remote Commander maintainers
Depends: libc6 (>= 2.31), ca-certificates
Description: Single native Remote Commander application core (V0.12 QA)
 One dpkg-owned immutable code and Node runtime for all local profiles.
 Native owner admission, authenticated G1/J01 and fleet approval are
 required before any privileged profile is activated.
EOF
cat > "$DEB/usr/lib/systemd/user/chatgpt-remote-commander@.service" <<'USERUNIT'
[Unit]
Description=Remote Commander shared native core for owner profile %i
After=network-online.target
ConditionPathExists=%h/.local/state/chatgpt-remote-commander/profiles/%i/config.json
[Service]
Type=simple
Environment=REMOTE_COMMANDER_CONFIG=%h/.local/state/chatgpt-remote-commander/profiles/%i/config.json
Environment=COMMANDER_ONE_REQUIRE_TRUSTED_INGRESS=1
WorkingDirectory=%h
ExecStartPre=/usr/lib/chatgpt-remote-commander/runtime/node /usr/lib/chatgpt-remote-commander/native-config-preflight.mjs
ExecStart=/usr/lib/chatgpt-remote-commander/runtime/node /usr/lib/chatgpt-remote-commander/app/src/server-v0.3.mjs
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
UMask=0077
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
USERUNIT
cat > "$DEB$PACKAGE_DIR/native-config-preflight.mjs" <<'PREFLIGHT'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const fail=code=>{throw Error(code)};
const file=process.env.REMOTE_COMMANDER_CONFIG;
if(process.env.COMMANDER_ONE_REQUIRE_TRUSTED_INGRESS!=='1')fail('NATIVE_G1_TRUSTED_INGRESS_REQUIRED');
if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)
  fail('NATIVE_PROFILE_CONFIG_REQUIRED');
const home=fs.realpathSync(os.homedir());
const profiles=path.join(home,'.local','state','chatgpt-remote-commander','profiles');
const relative=path.relative(profiles,file);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative)
  ||path.basename(file)!=='config.json')
  fail('NATIVE_PROFILE_CONFIG_LOCATION_INVALID');
const profile=path.basename(path.dirname(file));
if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile))
  fail('NATIVE_PROFILE_ID_INVALID');
const uid=process.getuid?.();
const parent=path.dirname(file);
const parentStat=fs.lstatSync(parent);
const configStat=fs.lstatSync(file);
if(parentStat.isSymbolicLink()||!parentStat.isDirectory()||parentStat.uid!==uid
  ||(parentStat.mode&0o077)!==0)
  fail('NATIVE_PROFILE_DIRECTORY_NOT_PRIVATE');
if(configStat.isSymbolicLink()||!configStat.isFile()||configStat.uid!==uid
  ||(configStat.mode&0o077)!==0||fs.realpathSync(file)!==file)
  fail('NATIVE_PROFILE_CONFIG_NOT_PRIVATE');
const c=JSON.parse(fs.readFileSync(file,'utf8'));
if(c.instance?.profile!==profile)fail('NATIVE_PROFILE_ID_MISMATCH');
if(!Number.isSafeInteger(c.port)||c.port<1024||c.port>65535)
  fail('NATIVE_PROFILE_PORT_INVALID');
if(!['127.0.0.1','::1'].includes(c.host))
  fail('NATIVE_LOOPBACK_REQUIRED');
const managed='/usr/lib/chatgpt-remote-commander';
function outsideManaged(p,key){
  if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p)
    fail('NATIVE_MUTABLE_STATE_PATH_REQUIRED_'+key);
  const rel=path.relative(managed,p);
  if(rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel)))
    fail('NATIVE_MUTABLE_STATE_INSIDE_MANAGED_CODE_'+key);
}
for(const key of ['runtimeState','auditLog'])outsideManaged(c[key],key);
for(const [section,key] of [['durableDelivery','directory'],['asyncOperations','stateDir']]){
  const value=c[section]?.[key];
  if(value!==undefined)outsideManaged(value,section+'_'+key);
}
console.log('NATIVE_PROFILE_CONFIG_PREFLIGHT_PASS');
PREFLIGHT
cat > "$DEB/usr/share/doc/chatgpt-remote-commander/README.txt" <<'DOC'
One shared, dpkg-managed Remote Commander Core for all owner profiles.

Profile config: ~/.local/state/chatgpt-remote-commander/profiles/PROFILE/config.json
The included systemd USER template starts the same immutable Core for a profile:
  systemctl --user daemon-reload
  systemctl --user enable --now chatgpt-remote-commander@PROFILE.service

The package does not migrate credentials/configuration, stop old services, enable
any service, grant FULL_POWER, or approve G1/J01. Keep existing profile services
running until each replacement has an authenticated canary and rollback proof.
DOC
cat > "$DEB/usr/share/doc/chatgpt-remote-commander/release-identity.txt" <<EOF
version=$VERSION
sourceCommit=$HEAD
sourceTree=$(git -C "$ROOT" rev-parse HEAD^{tree})
nativePackage=amd64
installation=dpkg-managed-single-codebase
serviceAutoStart=false
publisherProvenance=not-accepted
releasePromotion=NoPromote
profileIsolation=systemd-user-instance-per-owner
autoStart=false
EOF
# One deterministic code installation. All user profiles reuse the same source.
find "$DEB" -type d -exec chmod 755 {} +
find "$DEB" -type f ! -path '*/DEBIAN/*' -exec chmod a+r {} +
find "$DEB" -type f ! -path '*/DEBIAN/*' -perm /111 -exec chmod a+x {} +
SOURCE_DATE_EPOCH="$EPOCH" dpkg-deb --root-owner-group --build "$DEB" "$STAGE/Remote-Commander-Linux-amd64.deb" >/dev/null
dpkg-deb --field "$STAGE/Remote-Commander-Linux-amd64.deb" Package Version Architecture
dpkg-deb --contents "$STAGE/Remote-Commander-Linux-amd64.deb" |
  grep -E 'native-config-preflight.mjs|systemd/(system|user)/chatgpt-remote-commander.*service|app/src/server-v0.3.mjs|runtime/node$'
mkdir -p "$(dirname "$OUT")"
mv -n "$STAGE/Remote-Commander-Linux-amd64.deb" "$OUT"
test -s "$OUT"
echo "NATIVE_LINUX_QA_PACKAGE_PASS commit=$HEAD version=$VERSION package=$OUT sha256=$(sha256sum "$OUT" | cut -d' ' -f1) installed=false nativeServiceStarted=false"
