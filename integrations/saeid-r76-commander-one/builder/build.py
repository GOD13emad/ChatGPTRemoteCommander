#!/usr/bin/env python3
"""Build offline, single-file Windows SEA or Linux .run preview from dev23 + safe overlay.
No production deploy, no profile migration, no external network calls.
"""
import argparse, gzip, hashlib, io, json, os, re, shutil, subprocess, tarfile, tempfile, sys
from pathlib import Path, PurePosixPath
HERE=Path(__file__).resolve().parent
OVERLAY=("src/capability-gap-registry.mjs",
 "src/capability-profile.mjs",
 "src/full-access-status.mjs","src/full-access-http-quarantine.mjs", "src/privilege-client.mjs",
 "src/windows-admin-token.mjs",
 "tools/enroll-full-access-profile.mjs",
 "tools/probe-full-access-host.mjs")
# Windows GUI capture needs a complete, hash-pinned helper/dependency set.
# A present-but-unpacked overlay file is NOT evidence that the preview contains it.
WINDOWS_GUI_OVERLAY=("tools/gui-control.ps1","tools/gui-native.cs",
 "tools/gui-notice.cs","tools/gui-dxgi-session-probe.cs")
WINDOWS_GUI_SHA={
 "tools/gui-control.ps1":"5a45067b1748d6bde33a903801918794540267624369ce6b78048dda7ba92df0",
 "tools/gui-native.cs":"613f04fe13e173d79e7d9779ac9a64048bd1ce59d98d32ea40ae2143d3b1ccd0",
 "tools/gui-notice.cs":"353c74bcd9bcd695b2b32b29fe8eece08a749f64aaabbbbd5b6492b162f33062",
 "tools/gui-dxgi-session-probe.cs":"bbc6babe1b6cb1694ec09f17b308ef43bb697f7ae6a725581a18521ee85afaa9"}

ROOT=("package.json","config.json","LICENSE","README.md")
TREES=("src/","tools/","assets/","config/","extensions/")
BAN=re.compile(r"(^|/)(?:node_modules|var|credentials|runtime|releases|\.git|\.runtime|\.env|__pycache__|test|\.qa|\.github)/|(^|/)(?:[^/]*private[^/]*\.key|id_rsa|id_ed25519|config\.local\.json)$",re.I)
IMPORT=re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)['"](\.[^'"]+)['"]""")
def sha(b):return hashlib.sha256(b).hexdigest()
def sha_file(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()
def collect(base,overlay,platform):
 found={}
 for p in sorted(base.rglob("*")):
  r=p.relative_to(base).as_posix()
  # Only package-eligible paths require alias validation. Ignored runtime
  # dependencies (such as npm symlinks) must not block an unrelated build.
  if not(r in ROOT or r.startswith(TREES)) or BAN.search(r):continue
  if p.is_symlink():raise ValueError("BUNDLE_SOURCE_ALIAS:"+str(p))
  if not p.is_file():continue
  if not re.fullmatch(r"[A-Za-z0-9._/-]+",r):raise ValueError("BUNDLE_PATH_UNSAFE:"+r)
  if p.stat().st_size>64*1024*1024:raise ValueError("BUNDLE_SOURCE_OVERSIZED:"+r)
  found[r]=p.read_bytes()
 for r in OVERLAY + (WINDOWS_GUI_OVERLAY if platform=="win-x64" else ()):
  p=overlay/r
  if not p.is_file() or p.is_symlink():raise ValueError("BUNDLE_OVERLAY_MISSING:"+r)
  data=p.read_bytes()
  if r in WINDOWS_GUI_SHA and sha(data)!=WINDOWS_GUI_SHA[r]:
   raise ValueError("BUNDLE_GUI_OVERLAY_IDENTITY_MISMATCH:"+r)
  found[r]=data
 if "src/server-v0.3.mjs" not in found:raise ValueError("BUNDLE_BASE_SERVER_MISSING")
 server=found["src/server-v0.3.mjs"].decode("utf8")
 found["src/server-v0.3.mjs"]=patch_privileged_http_quarantine(patch_capability_gap_runtime(patch_native_access_status(server))).encode("utf8")
 if len(found)<80:raise ValueError("BUNDLE_SOURCE_INCOMPLETE")
 for rel,data in found.items():
  if not rel.endswith((".js",".cjs",".mjs")):continue
  for request in IMPORT.findall(data.decode("utf8","replace")):
   bits=[]
   for bit in (PurePosixPath(rel).parent/request).parts:
    if bit=="..":
     if not bits:raise ValueError("BUNDLE_IMPORT_OUTSIDE:"+rel)
     bits.pop()
    elif bit not in ("","."):bits.append(bit)
   key="/".join(bits)
   choices=(key,key+".mjs",key+".js",key+".cjs",key+"/index.mjs")
   if not any(t in found for t in choices):
    raise ValueError("BUNDLE_IMPORT_MISSING:"+rel+":"+request)
 return {k:found[k] for k in sorted(found)}
def patch_native_access_status(base):
 # Patch the selected installed dev23 server in memory; never replace it with
 # an older source checkout, which would silently remove existing features.
 marker="import http from 'node:http';"
 cfg="const config = JSON.parse(configRaw);"
 case="case 'system_status': {\n      await audit(ctx, { action: 'system_status', ok: true });"
 field="        configSha256,\n        configSchema: {"
 if base.count("createAccessStatusReader") or base.count("        accessStatus,"):
  if (base.count("import { createAccessStatusReader } from './full-access-status.mjs';")==1
      and base.count("        accessStatus,")==1):
   return base
  raise ValueError("FULL_ACCESS_BASE_PATCH_PARTIAL_OR_CONFLICT")
 for snippet in (marker,cfg,case,field):
  if base.count(snippet)!=1:raise ValueError("FULL_ACCESS_BASE_PATCH_ANCHOR_UNSAFE")
 patched=(base
   .replace(marker,marker+"\nimport { createAccessStatusReader } from './full-access-status.mjs';",1)
   .replace(cfg,cfg+"\nconst readAccessStatus = createAccessStatusReader({ config });",1)
   .replace(case,case+"\n      const accessStatus = await readAccessStatus();",1)
   .replace(field,"        configSha256,\n        accessStatus,\n        configSchema: {",1))
 if patched.count("const readAccessStatus = createAccessStatusReader({ config });")!=1:
  raise ValueError("FULL_ACCESS_BASE_PATCH_INCOMPLETE")
 return patched

def patch_capability_gap_runtime(base):
 # Preserve every installed dev23 dispatcher and insert only the tested
 # bounded owner-host capability gap contract. No external synchronization.
 imp="import http from 'node:http';"
 cfg="const readAccessStatus = createAccessStatusReader({ config });"
 tools="  ...agentExtensions.definitions,\n"
 dispatch="  if (name.startsWith('agent_extension_')) return agentExtensions.execute(name, args);\n"
 status="        agentExtensions: agentExtensions.status(),\n"
 if "capabilityGapToolDefinitions" in base or "capabilityGaps" in base:
  expected=(
   "import { CapabilityGapRegistry, capabilityGapToolDefinitions } from './capability-gap-registry.mjs';",
   "...capabilityGapToolDefinitions,",
   "if (name.startsWith('capability_gap_')) return capabilityGaps.execute(name, args);",
   "capabilityGaps: capabilityGaps.status(),")
  if all(base.count(item)==1 for item in expected):return base
  raise ValueError("CAPABILITY_GAP_BASE_PATCH_PARTIAL_OR_CONFLICT")
 for item in (imp,cfg,tools,dispatch,status):
  if base.count(item)!=1:raise ValueError("CAPABILITY_GAP_BASE_PATCH_ANCHOR_UNSAFE")
 return (base
  .replace(imp,imp+"\nimport { CapabilityGapRegistry, capabilityGapToolDefinitions } from './capability-gap-registry.mjs';",1)
  .replace(cfg,cfg+"\nconst capabilityGaps = new CapabilityGapRegistry({\n  directory: process.env.REMOTE_COMMANDER_CAPABILITY_GAP_DIR || undefined\n});",1)
  .replace(tools,tools+"  ...capabilityGapToolDefinitions,\n",1)
  .replace(dispatch,dispatch+"  if (name.startsWith('capability_gap_')) return capabilityGaps.execute(name, args);\n",1)
  .replace(status,status+"        capabilityGaps: capabilityGaps.status(),\n",1))


def patch_privileged_http_quarantine(base):
 # Do not expose an elevated worker through the legacy unauthenticated
 # loopback HTTP listener. V2's signed, revocable caller authorization is a
 # separate authenticated ingress, not a mutable config/header bypass.
 marker="import http from 'node:http';"
 cfg="const readAccessStatus = createAccessStatusReader({ config });"
 dispatch="    if (req.method !== 'POST' || url.pathname !== '/mcp') {"
 imp="import { legacyPrivilegedMcpQuarantine, rejectLegacyPrivilegedMcp } from './full-access-http-quarantine.mjs';"
 proof="import { probeWindowsAdministrator } from './windows-admin-token.mjs';"
 if "privilegedLegacyHttp = legacyPrivilegedMcpQuarantine" in base:
  if (base.count(imp)==1 and base.count(proof)==1 and
      base.count("if (rejectLegacyPrivilegedMcp(req, res, privilegedLegacyHttp)) return;")==1):
   return base
  raise ValueError("PRIVILEGED_HTTP_QUARANTINE_PARTIAL_OR_CONFLICT")
 for snippet in (marker,cfg,dispatch):
  if base.count(snippet)!=1:
   raise ValueError("PRIVILEGED_HTTP_QUARANTINE_ANCHOR_UNSAFE")
 start="""// Quarantine legacy MCP if FULL_ACCESS is configured, the token is elevated,
 // or the current process's privilege cannot be proven non-elevated.
const nativeWindowsToken = process.platform === 'win32'
  ? await probeWindowsAdministrator({ platform: process.platform })
  : null;
const privilegedLegacyHttp = legacyPrivilegedMcpQuarantine({
  platform: process.platform,
  configuredTier: config?.capabilityProfile?.tier,
  effectiveUid: process.platform === 'linux' ? process.geteuid?.() : null,
  windowsAdminToken: nativeWindowsToken
});"""
 return (base
  .replace(marker,marker+"\n"+imp+"\n"+proof,1)
  .replace(cfg,cfg+"\n"+start,1)
  .replace(dispatch,"    if (rejectLegacyPrivilegedMcp(req, res, privilegedLegacyHttp)) return;\n"+dispatch,1))


def tarball(entries):
 buffer=io.BytesIO()
 with gzip.GzipFile(filename="",fileobj=buffer,mode="wb",mtime=0,compresslevel=7) as gf:
  with tarfile.open(fileobj=gf,mode="w|",format=tarfile.PAX_FORMAT) as tar:
   for name,(b,mode) in sorted(entries.items()):
    t=tarfile.TarInfo(name);t.size=len(b);t.uid=t.gid=0;t.uname=t.gname=""
    t.mtime=0;t.mode=mode;tar.addfile(t,io.BytesIO(b))
 return buffer.getvalue()
def linux_run(payload,packsha):
 header=r'''#!/bin/sh
set -eu
# Offline user-local installer preview. No root, no download, no legacy cleanup.
umask 077
self="$0"
tmp="$(mktemp -d /tmp/commander-one.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
line="$(awk '/^__COMMANDER_PAYLOAD_BELOW__$/ {print NR+1; exit}' "$self")"
[ -n "$line" ] || { echo "INSTALLER_PAYLOAD_MARKER_MISSING" >&2; exit 2; }
tail -n +"$line" "$self" > "$tmp/payload.tar.gz"
actual="$(sha256sum "$tmp/payload.tar.gz" | awk '{print $1}')"
[ "$actual" = "@SHA@" ] || { echo "INSTALLER_PAYLOAD_SHA_MISMATCH" >&2; exit 2; }
tar -xzf "$tmp/payload.tar.gz" -C "$tmp"
chmod 700 "$tmp/node"
"$tmp/node" "$tmp/installer-core.cjs" "$@" \
 --asset "$tmp/source.tar.gz" --manifest "$tmp/bundle.json" --node "$tmp/node"
exit "$?"
__COMMANDER_PAYLOAD_BELOW__
'''
 return header.replace("@SHA@",packsha).encode()+payload
def headless_systemd_preflight():
 """Return (ready, reason); no service or OS settings change."""
 if sys.platform!="linux":return False,"not-linux-host"
 if os.geteuid()==0:return False,"root-build-session"
 if not shutil.which("systemctl") or not shutil.which("loginctl"):
  return False,"systemd-or-loginctl-unavailable"
 try:
  manager=subprocess.run(["systemctl","--user","show-environment"],
    capture_output=True,text=True,timeout=8)
  linger=subprocess.run(["loginctl","show-user",str(os.getuid()),
    "-p","Linger","--value"],capture_output=True,text=True,timeout=8)
 except (OSError,subprocess.TimeoutExpired):return False,"user-manager-state-unavailable"
 if manager.returncode or linger.returncode or linger.stdout.strip()!="yes":
  return False,"user-manager-or-linger-not-ready"
 return True,"owner-user-manager-ready"

def headless_systemd_gate(qa_mode,platform,code,staged,payload,previous_installer):
 """Run the real package in disposable user-local installations before release."""
 if platform!="linux-x64":
  if qa_mode=="required":raise RuntimeError("BUNDLE_HEADLESS_SYSTEMD_LINUX_ONLY")
  return {"status":"NOT_APPLICABLE","reason":"windows-package"}
 if qa_mode=="off":return {"status":"NOT_RUN","reason":"explicitly-disabled"}
 if b"headlessLifecycleRevision" not in code.read_bytes():
  if qa_mode=="required":raise RuntimeError("BUNDLE_HEADLESS_CORE_UNSUPPORTED")
  return {"status":"NOT_RUN","reason":"installer-core-lacks-headless-support"}
 ready,reason=headless_systemd_preflight()
 if not ready:
  if qa_mode=="required":raise RuntimeError("BUNDLE_HEADLESS_SYSTEMD_QA_NOT_READY:"+reason)
  return {"status":"NOT_RUN","reason":reason}
 cmd=[sys.executable,str(HERE/"smoke-headless-systemd.py"),
      "--installer",str(staged),"--expected-sha256",sha(payload),
      "--verify-crash-recovery"]
 if previous_installer is not None:
  cmd.extend(["--previous-installer",str(previous_installer)])
 trial=subprocess.run(cmd,capture_output=True,text=True,timeout=180)
 if trial.returncode:
  raise RuntimeError("BUNDLE_HEADLESS_SYSTEMD_QA_FAILED:"+
                     (trial.stderr or trial.stdout)[-1400:])
 rows=[line for line in trial.stdout.splitlines() if line.startswith("{")]
 if not rows:raise RuntimeError("BUNDLE_HEADLESS_SYSTEMD_RECEIPT_MISSING")
 proof=json.loads(rows[-1])
 checks=("distinctPorts","actualSystemdUserServices",
         "unsafeUpgradeUninstallRejected","configShaMismatchRejected",
         "systemdCrashRecoveryTested","systemdCrashRecoveryPassed",
         "reversibleUninstallRestore","fullPowerServiceDenied")
 if (proof.get("status")!="HEADLESS_SYSTEMD_USER_PASS" or
     proof.get("installerSha256")!=sha(payload) or
     proof.get("profiles")!=2 or
     not all(proof.get(k) is True for k in checks) or
     proof.get("legacyMutationRejected") is not (previous_installer is not None) or
     proof.get("bootOrLoginTested") is not False or
     proof.get("productionTouched") is not False or
     "HEADLESS_QA_TEMP_CLEANED" not in trial.stdout):
  raise RuntimeError("BUNDLE_HEADLESS_SYSTEMD_RECEIPT_INVALID")
 return {"status":"PASS","source":"actual-user-systemd",
         "installerSha256":proof["installerSha256"],"profiles":2,
         "crashRecovery":True,"bootOrLoginTested":False,
         "productionTouched":False}

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--platform",choices=("win-x64","linux-x64"),required=True)
 for arg in ("base","overlay","node","output"):ap.add_argument("--"+arg,type=Path,required=True)
 ap.add_argument("--ui-windows",type=Path)
 ap.add_argument("--ui-linux",type=Path)
 ap.add_argument("--previous-installer",type=Path)
 ap.add_argument("--headless-systemd-qa",choices=("auto","required","off"),default="auto",
   help="Linux user-systemd integration acceptance: auto runs if ready; required fails closed; off records NOT_RUN")
 a=ap.parse_args()
 for n,p in (("base",a.base),("overlay",a.overlay),("node",a.node)):
  if not p.exists():raise ValueError("BUNDLE_INPUT_MISSING:"+n)
 files=collect(a.base.resolve(),a.overlay.resolve(),a.platform)
 # Bundle the existing tested native dev23 control center. These are read-only
 # monitors; they must never be confused with complete task-control approval.
 native_ui=None
 if a.platform=="win-x64" and a.ui_windows is not None:
  p=a.ui_windows.resolve()
  if not p.is_file() or p.is_symlink() or p.stat().st_size>256*1024*1024:
   raise ValueError("UI_WINDOWS_BINARY_INVALID")
  item="desktop/RemoteCommander.exe";files[item]=p.read_bytes()
  native_ui={"kind":"winforms-readonly","entry":"app/"+item,
             "sha256":sha(files[item]),"managedProfiles":True}
 elif a.platform=="linux-x64" and a.ui_linux is not None:
  root=a.ui_linux.resolve()
  if not root.is_dir() or root.is_symlink():raise ValueError("UI_LINUX_SOURCE_INVALID")
  for name in ("control_center.py","dashboard_ui.py","notion_panel.py","managed_controls.py"):
   p=root/name
   if not p.is_file() or p.is_symlink() or p.stat().st_size>1024*1024:
    raise ValueError("UI_LINUX_FILE_MISSING:"+name)
   files["desktop/linux-control-center/"+name]=p.read_bytes()
  entry="desktop/linux-control-center/control_center.py"
  native_ui={"kind":"gtk4-readonly-system-python","entry":"app/"+entry,
             "sha256":sha(files[entry]),"managedProfiles":True}
 elif a.ui_windows is not None or a.ui_linux is not None:
  raise ValueError("UI_PLATFORM_ARGUMENT_MISMATCH")
 files={name:files[name] for name in sorted(files)}
 archive=tarball({"app/"+name:(data,0o644) for name,data in files.items()})
 code=HERE/"installer-core.cjs"
 if not code.is_file():raise ValueError("INSTALLER_CORE_MISSING")
 meta={"schema":1,"product":"ChatGPTRemoteCommander","build":"dev23-scoped-v1-one-install-preview",
  "releaseBaseline":"0.11.0-dev.23-402568736277","sourceSha256":sha(archive),
  "installerCoreSha256":sha(code.read_bytes()),
  "platform":a.platform,"signed":False,"autoMigratesLegacy":False,"nativeUi":native_ui,
  "files":[{"path":"app/"+k,"sha256":sha(v),"bytes":len(v)} for k,v in files.items()]}
 a.output.mkdir(parents=True,exist_ok=True)
 suffix="-UI-preview" if native_ui else "-preview"
 result=a.output/("CommanderOne-Setup-Windows-x64"+suffix+".exe" if a.platform=="win-x64"
  else "CommanderOne-Setup-Linux-x64"+suffix+".run")
 if result.exists():raise ValueError("OUTPUT_ALREADY_EXISTS_RECONCILE")
 with tempfile.TemporaryDirectory(prefix="commander-one-builder-",dir=a.output) as dir:
  w=Path(dir);src=w/"source.tar.gz";src.write_bytes(archive)
  manifest=w/"bundle.json";manifest.write_text(json.dumps(meta,sort_keys=True)+"\n")
  if a.platform=="win-x64":
   cfg={"main":str(code),"mainFormat":"commonjs","output":str(w/"setup.exe"),
    "executable":str(a.node),"disableExperimentalSEAWarning":True,
    "useCodeCache":False,"useSnapshot":False,"execArgvExtension":"none",
    "assets":{"source.tar.gz":str(src),"bundle.json":str(manifest)}}
   f=w/"sea.json";f.write_text(json.dumps(cfg))
   check=subprocess.run([str(a.node),"--build-sea",str(f)],
    cwd=w,capture_output=True,text=True,timeout=180)
   if check.returncode:raise RuntimeError("SEA_BUILD_FAILED:"+check.stderr[-600:])
   payload=(w/"setup.exe").read_bytes()
  else:
   blob=tarball({"node":(a.node.resolve().read_bytes(),0o700),
     "installer-core.cjs":(code.read_bytes(),0o600),"source.tar.gz":(archive,0o600),
     "bundle.json":(manifest.read_bytes(),0o600)})
   payload=linux_run(blob,sha(blob))
  # Validate the actual one-file installer from a temporary executable path
  # before the atomic final publication. Never publish a boot-broken preview.
  staged=w/("commander-one-stage.exe" if a.platform=="win-x64" else "commander-one-stage.run")
  staged.write_bytes(payload)
  if a.platform=="linux-x64":staged.chmod(0o700)
  receipts={}
  for mode in ("standard","full"):
   trial=subprocess.run([sys.executable,str(HERE/"smoke.py"),
       "--installer",str(staged),"--mode",mode,"--baseline-root",str(a.base)],
       text=True,capture_output=True,timeout=120)
   if trial.returncode:
    raise RuntimeError("BUNDLE_SMOKE_FAILED:"+mode+":"+trial.stderr[-750:])
   lines=[x for x in trial.stdout.splitlines() if x.startswith("{")]
   if not lines:raise RuntimeError("BUNDLE_SMOKE_RECEIPT_MISSING:"+mode)
   receipt=json.loads(lines[-1])
   if receipt.get("status")!="INSTALL_AND_RUNTIME_PASS" or receipt.get("mode")!=mode:
    raise RuntimeError("BUNDLE_SMOKE_ACCEPTANCE_FAILED:"+mode)
   parity=receipt.get("dev23Parity") or {}
   if parity.get("baselineSchemaParity") is not True:
    raise RuntimeError("BUNDLE_BASELINE_PARITY_MISSING:"+mode)
   lifetime=subprocess.run([sys.executable,str(HERE/"smoke-lifecycle.py"),
      "--installer",str(staged),"--mode",mode],
      capture_output=True,text=True,timeout=150)
   if lifetime.returncode:
    raise RuntimeError("BUNDLE_LIFECYCLE_FAILED:"+mode+":"+lifetime.stderr[-850:])
   lifecycle_lines=[x for x in lifetime.stdout.splitlines() if x.startswith("{")]
   if not lifecycle_lines:raise RuntimeError("BUNDLE_LIFECYCLE_RECEIPT_MISSING:"+mode)
   proof=json.loads(lifecycle_lines[-1])
   if proof.get("status")!="LIFECYCLE_PASS" or proof.get("mode")!=mode or not all(
       proof.get(key) is True for key in ("distinctOwnerPorts","forbiddenRouterPortsAvoided",
       "duplicateStartRejected","occupiedPortRejected","forgedStopRejected",
       "authenticatedStop","verifiedEndpointIdentity","stateCleaned")):
    raise RuntimeError("BUNDLE_LIFECYCLE_ACCEPTANCE_FAILED:"+mode)
   rollback_pass=False
   if a.previous_installer is not None:
    if not a.previous_installer.is_file():
     raise RuntimeError("BUNDLE_PRIOR_VERSION_MISSING")
    test=subprocess.run([sys.executable,str(HERE/"smoke-upgrade.py"),
        "--installer",str(staged),"--previous-installer",str(a.previous_installer),
        "--mode",mode],
        capture_output=True,text=True,timeout=155)
    if test.returncode:
     raise RuntimeError("BUNDLE_UPGRADE_ROLLBACK_FAILED:"+mode+":"+test.stderr[-950:])
    proof_lines=[x for x in test.stdout.splitlines() if x.startswith("{")]
    if not proof_lines:raise RuntimeError("BUNDLE_UPGRADE_ROLLBACK_RECEIPT_MISSING")
    proof=json.loads(proof_lines[-1])
    if proof.get("status")!="ATOMIC_UPGRADE_ROLLBACK_PASS" or not all(
        proof.get(key) is True for key in ("stateShaPreserved","activeUpgradeDenied",
        "upgradeIdempotent","rollbackRestoredExactPrevious","failedCandidateRetained")):
     raise RuntimeError("BUNDLE_UPGRADE_ROLLBACK_ACCEPTANCE_FAILED:"+mode)
    rollback_pass=True
   retirement=subprocess.run([sys.executable,str(HERE/"smoke-retire.py"),
       "--installer",str(staged),"--mode",mode],
       text=True,capture_output=True,timeout=140)
   if retirement.returncode:
    raise RuntimeError("BUNDLE_REVERSIBLE_UNINSTALL_FAILED:"+mode+":"+retirement.stderr[-900:])
   retired_lines=[x for x in retirement.stdout.splitlines() if x.startswith("{")]
   if not retired_lines:raise RuntimeError("BUNDLE_UNINSTALL_RECEIPT_MISSING:"+mode)
   acceptance=json.loads(retired_lines[-1])
   if acceptance.get("status")!="OWNER_REVERSIBLE_UNINSTALL_PASS" or not all(
       acceptance.get(key) is True for key in ("userDataByteIdentical","liveUninstallRejected",
       "targetCollisionRejected","restorePreservesExactMarker","repeatRestoreRejected")):
    raise RuntimeError("BUNDLE_UNINSTALL_ACCEPTANCE_FAILED:"+mode)
   autostart=subprocess.run([sys.executable,str(HERE/"smoke-autostart.py"),
       "--setup",str(staged),"--mode",mode],
       text=True,capture_output=True,timeout=160)
   if autostart.returncode:
    raise RuntimeError("BUNDLE_AUTOSTART_FAILED:"+mode+":"+autostart.stderr[-950:])
   autostart_lines=[x for x in autostart.stdout.splitlines() if x.startswith("{")]
   if not autostart_lines:raise RuntimeError("BUNDLE_AUTOSTART_RECEIPT_MISSING:"+mode)
   autostart_accept=json.loads(autostart_lines[-1])
   if (autostart_accept.get("ok") is not True or
       autostart_accept.get("code")!="R43_AUTOSTART_OWNER_LOCAL_ENABLE_DISABLE_PASS" or
       autostart_accept.get("mode")!=mode or
       autostart_accept.get("packagedCliTested") is not True or
       autostart_accept.get("profiles")!=2 or
       autostart_accept.get("productionTouched") is not False):
    raise RuntimeError("BUNDLE_AUTOSTART_ACCEPTANCE_FAILED:"+mode)
   launch=subprocess.run([sys.executable,str(HERE/"smoke-autostart-launch.py"),
       "--installer",str(staged),"--mode",mode],
       capture_output=True,text=True,timeout=125)
   if launch.returncode:
    raise RuntimeError("BUNDLE_NATIVE_STARTUP_HANDOFF_FAILED:"+mode+":"+launch.stderr[-900:])
   launch_lines=[x for x in launch.stdout.splitlines() if x.startswith("{")]
   if not launch_lines:raise RuntimeError("BUNDLE_NATIVE_STARTUP_HANDOFF_RECEIPT_MISSING:"+mode)
   launch_accept=json.loads(launch_lines[-1])
   if (launch_accept.get("ok") is not True or
       launch_accept.get("status")!="R44_NATIVE_STARTUP_LAUNCH_HANDOFF_PASS" or
       launch_accept.get("mode")!=mode or
       launch_accept.get("verifiedBackend") is not True or
       launch_accept.get("productionTouched") is not False):
    raise RuntimeError("BUNDLE_NATIVE_STARTUP_HANDOFF_ACCEPTANCE_FAILED:"+mode)
   winforms_ui_pass=False
   if a.platform=="win-x64" and native_ui is not None:
    winforms=subprocess.run([sys.executable,str(HERE/"smoke-winforms-ui.py"),
        "--installer",str(staged),"--mode",mode],
        text=True,capture_output=True,timeout=160)
    if winforms.returncode:
     raise RuntimeError("BUNDLE_WINFORMS_STOP_CONFIRM_FAILED:"+mode+":"+winforms.stderr[-950:])
    winforms_lines=[x for x in winforms.stdout.splitlines() if x.startswith("{")]
    if not winforms_lines:raise RuntimeError("BUNDLE_WINFORMS_RECEIPT_MISSING:"+mode)
    winforms_accept=json.loads(winforms_lines[-1])
    if (winforms_accept.get("status")!="WINFORMS_MANAGED_STOP_DENY_ACCEPT_E2E_PASS" or
        winforms_accept.get("mode")!=mode or
        winforms_accept.get("realButtonEvents") is not True or
        winforms_accept.get("stopDenyPreservesBackend") is not True or
        winforms_accept.get("stopAcceptStopsBackend") is not True or
        winforms_accept.get("ownerDesktopTouched") is not False or
        winforms_accept.get("productionTouched") is not False):
     raise RuntimeError("BUNDLE_WINFORMS_STOP_CONFIRM_INVALID:"+mode)
    winforms_ui_pass=True
   dead_control=subprocess.run([sys.executable,str(HERE/"smoke-runtime-reconcile.py"),
       "--installer",str(staged),"--mode",mode],
       text=True,capture_output=True,timeout=160)
   if dead_control.returncode:
    raise RuntimeError("BUNDLE_DEAD_CONTROL_RECONCILE_FAILED:"+mode+":"+dead_control.stderr[-1000:])
   reconcile_lines=[x for x in dead_control.stdout.splitlines() if x.startswith("{")]
   if not reconcile_lines:raise RuntimeError("BUNDLE_DEAD_CONTROL_RECEIPT_MISSING:"+mode)
   reconcile_accept=json.loads(reconcile_lines[-1])
   if (reconcile_accept.get("ok") is not True or
       reconcile_accept.get("status")!="R46_DEAD_OWNER_CONTROL_RECONCILE_PASS" or
       reconcile_accept.get("mode")!=mode or
       reconcile_accept.get("productionTouched") is not False or
       reconcile_accept.get("noProcessKilled") is not True or
       not all(reconcile_accept.get(k) is True for k in (
        "liveControlRejected","configMismatchRejected","reconcileLockRejected",
        "controlPortOccupiedRejected","backendPortOccupiedRejected",
        "staleControlQuarantined","idempotentSecondReconcile",
        "restartAndHealthVerified"))):
    raise RuntimeError("BUNDLE_DEAD_CONTROL_RECONCILE_ACCEPTANCE_FAILED:"+mode)
   receipts[mode]={"tools":receipt["tools"],"schema":receipt["toolSchemaHash"],
                   "baseTools":parity["baseTools"],"added":parity["added"],
                   "baselineSchemaParity":True,"realLifecyclePass":True,
                   "upgradeRollbackPass":rollback_pass,
                   "reversibleUninstallPass":True,"autostartPackagedCliPass":True,
                   "nativeStartupHandoffPass":True,"winformsStopConfirmPass":winforms_ui_pass,
                   "runtimeDeadControlReconcilePass":True}
  # A packaged FULL_POWER runtime must preserve ordinary owner-local MCP,
  # while a synthetic configured FULL_ACCESS runtime must fail closed on
  # anonymous or forged legacy HTTP before any executable tool dispatch.
  quarantine=subprocess.run([sys.executable,str(HERE/"smoke-fullaccess-http-quarantine.py"),
      "--installer",str(staged),"--expected-sha256",sha(payload)],
      text=True,capture_output=True,timeout=145)
  if quarantine.returncode:
   raise RuntimeError("BUNDLE_PRIVILEGED_HTTP_FAIL_CLOSED_FAILED:"+quarantine.stderr[-1050:])
  quarantine_lines=[x for x in quarantine.stdout.splitlines() if x.startswith("{")]
  if not quarantine_lines:raise RuntimeError("BUNDLE_PRIVILEGED_HTTP_RECEIPT_MISSING")
  quarantine_accept=json.loads(quarantine_lines[-1])
  if (quarantine_accept.get("status")!="PRIVILEGED_HTTP_FAIL_CLOSED_QA_PASS" or
      quarantine_accept.get("ownerTokenFullPower")!=[200,200] or
      quarantine_accept.get("fullAccessConfigured")!=[403,403] or
      quarantine_accept.get("trustedV2AuthenticatedExecutionProved") is not False or
      quarantine_accept.get("actualAdminTokenTested") is not False or
      quarantine_accept.get("productionTouched") is not False or
      quarantine_accept.get("qaCleanUp") is not True):
   raise RuntimeError("BUNDLE_PRIVILEGED_HTTP_FAIL_CLOSED_ACCEPTANCE_FAILED")
  for mode in receipts:receipts[mode]["privilegedLegacyHttpQuarantinePass"]=True
  headless_qa=headless_systemd_gate(a.headless_systemd_qa,a.platform,code,
     staged,payload,a.previous_installer)
  unicode_path_qa={"status":"NOT_APPLICABLE","reason":"linux-package"}
  if a.platform=="win-x64":
   command=[sys.executable,str(HERE/"smoke-unicode-install.py"),
            "--installer",str(staged),"--expected-sha256",sha(payload)]
   if native_ui is not None:
    command.extend(["--native-ui-sha256",native_ui["sha256"]])
   observed=subprocess.run(command,capture_output=True,text=True,timeout=210)
   if observed.returncode:
    raise RuntimeError("BUNDLE_WINDOWS_UNICODE_INSTALL_FAILED:"+
                       (observed.stderr or observed.stdout)[-950:])
   proof_lines=[line for line in observed.stdout.splitlines() if line.startswith("{")]
   if not proof_lines:
    raise RuntimeError("BUNDLE_WINDOWS_UNICODE_INSTALL_RECEIPT_MISSING")
   proof=json.loads(proof_lines[-1])
   if (proof.get("status")!="WINDOWS_UNICODE_SPECIAL_PATH_INSTALL_PASS" or
       proof.get("installerSha256")!=sha(payload) or
       proof.get("modes")!=["standard","full"] or
       proof.get("nativeUiHashVerified") is not (native_ui is not None) or
       proof.get("unicodeAbsolutePathPreviouslyUnsafe") is not True or
       proof.get("percentDollarSpaceTested") is not True or
       proof.get("productionTouched") is not False or
       proof.get("osElevationRequired") is not False or
       proof.get("osRestartTested") is not False or
       "UNICODE_INSTALL_QA_TEMP_CLEANED" not in observed.stdout):
    raise RuntimeError("BUNDLE_WINDOWS_UNICODE_INSTALL_RECEIPT_INVALID")
   unicode_path_qa={"status":"PASS","source":"actual-windows-special-path-install",
                    "installerSha256":sha(payload),"modes":proof["modes"],
                    "nativeUiHashVerified":proof["nativeUiHashVerified"],
                    "productionTouched":False,"osRestartTested":False}
  unicode_upgrade_qa={"status":"NOT_APPLICABLE","reason":"not-windows-ui-upgrade"}
  if a.platform=="win-x64" and a.previous_installer is not None and native_ui is not None:
   previous_package=subprocess.run([str(a.previous_installer),"--verify-package"],
       capture_output=True,text=True,timeout=45)
   previous_lines=[line for line in previous_package.stdout.splitlines() if line.startswith("{")]
   if previous_package.returncode or not previous_lines:
    raise RuntimeError("BUNDLE_UNICODE_UPGRADE_PRIOR_PACKAGE_INVALID")
   previous_metadata=json.loads(previous_lines[-1])
   prior_ui=previous_metadata.get("nativeUi")
   if (previous_metadata.get("ok") is not True or
       not isinstance(prior_ui,dict) or
       not re.fullmatch("[a-f0-9]{64}",prior_ui.get("sha256",""))):
    raise RuntimeError("BUNDLE_UNICODE_UPGRADE_PRIOR_NATIVE_UI_MISSING")
   previous_sha=sha_file(a.previous_installer)
   modes=[]
   for mode in ("standard","full"):
    command=[sys.executable,str(HERE/"smoke-unicode-upgrade.py"),
       "--previous",str(a.previous_installer),"--current",str(staged),
       "--previous-sha256",previous_sha,"--current-sha256",sha(payload),
       "--previous-ui-sha256",prior_ui["sha256"],
       "--current-ui-sha256",native_ui["sha256"],"--mode",mode]
    observed=subprocess.run(command,capture_output=True,text=True,timeout=170)
    if observed.returncode:
     raise RuntimeError("BUNDLE_WINDOWS_UNICODE_UPGRADE_FAILED:"+mode+":"+
                        (observed.stderr or observed.stdout)[-1050:])
    lines=[line for line in observed.stdout.splitlines() if line.startswith("{")]
    if not lines:raise RuntimeError("BUNDLE_WINDOWS_UNICODE_UPGRADE_RECEIPT_MISSING:"+mode)
    proof=json.loads(lines[-1])
    if (proof.get("status")!="UNICODE_SPECIAL_PATH_UPGRADE_ROLLBACK_PASS" or
        proof.get("mode")!=mode or
        proof.get("previousUiSha")!=prior_ui["sha256"] or
        proof.get("newUiSha")!=native_ui["sha256"] or
        not all(proof.get(k) is True for k in (
         "nonAsciiDollarPercentSpace","autostartUnsafeEnableDenied",
         "sameBuildInstallRejected","twoProfilesAndOwnerStateBytePreserved",
         "exactUiAndCoreRollback")) or
        proof.get("productionChanged") is not False or
        "UNICODE_SPECIAL_PATH_TEMP_CLEANED" not in observed.stdout):
     raise RuntimeError("BUNDLE_WINDOWS_UNICODE_UPGRADE_RECEIPT_INVALID:"+mode)
    modes.append(mode)
   unicode_upgrade_qa={"status":"PASS","modes":modes,"previousSha256":previous_sha,
       "installerSha256":sha(payload),"productionTouched":False,
       "unicodeAutoStartEnableRejected":True,"bootOrLoginTested":False}
  if result.exists():raise ValueError("OUTPUT_RACE_RECONCILE")
  os.replace(staged,result)
  print(json.dumps({"status":"PREVIEW_BUILT_AND_EXECUTED","file":str(result),"platform":a.platform,
   "bytes":len(payload),"sha256":sha(payload),"sourceCount":len(files),
   "sourceSha256":sha(archive),"nativeUi":native_ui,"smokes":receipts,
   "headlessSystemdQa":headless_qa,"windowsUnicodeInstallQa":unicode_path_qa,
   "windowsUnicodeUpgradeQa":unicode_upgrade_qa,
   "productionInstalled":False,"signed":False}))
if __name__=="__main__":main()
