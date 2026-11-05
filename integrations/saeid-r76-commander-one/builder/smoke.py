#!/usr/bin/env python3
"""End-to-end, clean-room single-installer QA; never touches configured user install."""
import argparse, hashlib, json, os, pathlib, shutil, signal, socket
import subprocess, tempfile, time, urllib.request
from pathlib import Path
def stable(value):
 if isinstance(value,dict):return {k:stable(value[k]) for k in sorted(value)}
 if isinstance(value,list):return [stable(x) for x in value]
 return value
def digest(value):
 return hashlib.sha256(json.dumps(stable(value),ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
def cmd(argv,timeout=35):
 result=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
 if result.returncode:
  raise RuntimeError("QA_COMMAND_FAILED:"+str(result.returncode)+":"+result.stderr[-400:])
 try:return json.loads(result.stdout.strip().splitlines()[-1])
 except Exception as e:raise RuntimeError("QA_JSON_INVALID:"+result.stdout[-350:]) from e
def request(port,method,params=None,ident=1):
 body=json.dumps({"jsonrpc":"2.0","id":ident,"method":method,"params":params or {}}).encode()
 req=urllib.request.Request("http://127.0.0.1:"+str(port)+"/mcp",method="POST",data=body,
  headers={"content-type":"application/json"})
 with urllib.request.urlopen(req,timeout=3) as resp:return json.load(resp)
def baseline_catalog(base, profile, work):
 # Compare against a COPY of original dev23, never run its live installation.
 isolated=Path(work)/"baseline-dev23"
 for folder in ("src","tools"):
  src=base/folder
  if src.is_dir():shutil.copytree(src,isolated/folder)
 for name in ("package.json","config.json"):
  src=base/name
  if src.is_file():shutil.copy2(src,isolated/name)
 with socket.socket() as sock:
  sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
 # Preserve the tool-gating feature flags of the installed candidate.
 # Otherwise FULL_POWER workflow tools appear as false "added" deltas against
 # a STANDARD-like baseline. Redirect all persistence to the isolated QA tree.
 originalWorkflows=profile.get("durableWorkflows",{})
 cfg={**profile,"port":port,
      "auditLog":str(Path(work)/"baseline-audit.jsonl"),
      "runtimeState":str(Path(work)/"baseline-runtime.json"),
      "durableWorkflows":{**originalWorkflows,
                          "directory":str(Path(work)/"baseline-workflows"),
                          "rootLeaseDirectory":str(Path(work)/"baseline-shared-root-leases")},
      "asyncOperations":{"enabled":False},
      "durableDelivery":{"directory":str(Path(work)/"baseline-delivery"),"scope":"baseline-parity"}}
 conf=Path(work)/"baseline-config.json"
 conf.write_text(json.dumps(cfg),encoding="utf8")
 env=os.environ.copy()
 env["REMOTE_COMMANDER_CONFIG"]=str(conf)
 env["REMOTE_COMMANDER_CAPABILITY_GAP_DIR"]=str(Path(work)/"baseline-gaps")
 node=shutil.which("node")
 if not node:raise RuntimeError("BASELINE_PARITY_NODE_MISSING")
 log=open(Path(work)/"baseline-server.log","w")
 proc=subprocess.Popen([node,str(isolated/"src/server-v0.3.mjs")],
  cwd=isolated,env=env,stdout=log,stderr=subprocess.STDOUT,
  creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0),
  start_new_session=os.name!="nt")
 try:
  ready=False
  for _ in range(100):
   if proc.poll() is not None:break
   try:
    with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/health",timeout=.4) as resp:
     if json.load(resp).get("ok"):ready=True;break
   except Exception:time.sleep(.1)
  if not ready:
   log.flush()
   raise RuntimeError("BASELINE_PARITY_SERVER_NOT_READY:"+Path(log.name).read_text(errors="replace")[-650:])
  return request(port,"tools/list")["result"]["tools"]
 finally:
  if proc.poll() is None:
   if os.name=="nt":proc.terminate()
   else:os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=4)
   except subprocess.TimeoutExpired:
    if os.name=="nt":proc.kill()
    else:os.killpg(proc.pid,signal.SIGKILL)
    proc.wait(timeout=4)
  log.close()

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--installer",type=Path,required=True)
 parser.add_argument("--mode",choices=("standard","full"),default="standard")
 parser.add_argument("--baseline-root",type=Path)
 a=parser.parse_args()
 if not a.installer.is_file():raise RuntimeError("QA_INSTALLER_NOT_FOUND")
 if os.name=="nt":tmpbase=Path(os.environ["TEMP"])
 else:
  tmpbase=Path.home()/".cache";tmpbase.mkdir(exist_ok=True)
 with tempfile.TemporaryDirectory(prefix="rc-one-install-full-smoke-",dir=tmpbase) as work:
  managed=Path(work)/"managed"
  product=cmd([str(a.installer),"--verify-package"])
  assert product["ok"] and product["files"]>120
  first=cmd([str(a.installer),"--install","--target",str(managed),"--mode",a.mode])
  assert first["installed"] and first["profiles"]==["default"]
  repeated=cmd([str(a.installer),"--install","--target",str(managed),"--mode",a.mode])
  assert repeated["idempotent"] and not repeated["installed"]
  if os.name=="nt":
   entry=[str(managed/"Commander.exe")]
  else:entry=[str(managed/"bin/node"),str(managed/"Commander.cjs")]
  second=cmd(entry+["--add-profile","--profile","MMZ","--target",str(managed)])
  assert set(second["profiles"])=={"default","MMZ"}
  addedProfile=json.loads((managed/"state/profiles/MMZ.json").read_text())
  assert addedProfile["instance"]["profile"]=="MMZ"
  assert addedProfile["capabilityProfile"]["id"]=="MMZ"
  assert addedProfile["capabilityProfile"]["tier"]==("FULL_POWER" if a.mode=="full" else "STANDARD")
  assert len(addedProfile["capabilityProfile"]["grantedCapabilities"])==(27 if a.mode=="full" else 0)
  assert addedProfile["powerMode"]["allowShell"] is (a.mode=="full")
  reported=cmd(entry+["--status","--target",str(managed)])
  assert reported["oneManagedInstall"]
  native=None
  if product.get("nativeUi"):
   assert reported["nativeUiBundled"]
   assert reported["managedProfileActions"] is (product["nativeUi"].get("managedProfiles") is True)
   assert reported["uiReadOnly"] is (not reported["managedProfileActions"])
   native=cmd(entry+["--dashboard-probe","--target",str(managed)])
   assert native["nativeUiBundled"] and native["launcherVerified"]
   assert native["dependencyReady"]
   assert native["managedProfileActions"] is reported["managedProfileActions"]
   assert native["uiReadOnly"] is reported["uiReadOnly"]
   assert native["monitoringScope"]=="owner-local-existing-commander"
  config=managed/"state/profiles/default.json"
  original=json.loads(config.read_text())
  sourceCatalog=baseline_catalog(a.baseline_root.resolve(),original,work) if a.baseline_root else None
  assert original["allowedRoots"]==[str(managed/"app")]
  assert original["powerMode"]["enabled"]==(a.mode=="full")
  assert original["powerMode"]["guiControl"]["enabled"] is (a.mode=="full")
  assert original["capabilityProfile"]["tier"]==("FULL_POWER" if a.mode=="full" else "STANDARD")
  assert original["capabilityProfile"]["explicitlyAuthorized"] is True
  assert len(original["capabilityProfile"]["grantedCapabilities"])==(27 if a.mode=="full" else 0)
  assert original["powerMode"]["allowShell"] is (a.mode=="full")
  assert original["powerMode"]["allowProcessControl"] is (a.mode=="full")
  assert original["powerMode"]["browserControl"]["enabled"] is (a.mode=="full")
  # The installed dev23 policy enables GUI capability flags without silently
  # taking over an owner's physical desktop or persistent session.
  assert original["powerMode"]["guiControl"].get("ownerAuthorizedTakeover") is False, (
   "GUI_STANDING_APPROVAL_BYPASS:"+repr(original["powerMode"]["guiControl"]))
  assert ".stage-" not in json.dumps(original)
  with socket.socket() as s:
   s.bind(("127.0.0.1",0));port=s.getsockname()[1]
  updated={**original,"port":port}
  config.write_text(json.dumps(updated))
  log=open(Path(work)/"server.log","w")
  proc=subprocess.Popen(entry+["--run","--target",str(managed)],
   cwd=managed,stdout=log,stderr=subprocess.STDOUT,
   creationflags=(getattr(subprocess,"CREATE_NO_WINDOW",0) if os.name=="nt" else 0),
   start_new_session=(os.name!="nt"))
  try:
   ready=False
   for _ in range(75):
    if proc.poll() is not None:break
    try:
     with urllib.request.urlopen("http://127.0.0.1:"+str(port)+"/health",timeout=.4) as resp:
      if json.load(resp).get("ok"):ready=True;break
    except Exception:time.sleep(.1)
   if not ready:
    log.flush()
    raise RuntimeError("QA_SERVER_NOT_READY:"+Path(log.name).read_text(errors="replace")[-650:])
   catalog=request(port,"tools/list")["result"]["tools"]
   names={x["name"] for x in catalog}
   parity=None
   if sourceCatalog is not None:
    before={t["name"]:t for t in sourceCatalog}
    after={t["name"]:t for t in catalog}
    missing=sorted(set(before)-set(after))
    changed=sorted(n for n in before.keys()&after.keys() if digest(before[n])!=digest(after[n]))
    added=sorted(set(after)-set(before))
    intended=["capability_gap_get","capability_gap_list","capability_gap_report","capability_gap_update"]
    expected_added=[] if set(intended).issubset(before) else intended
    if missing or changed or added!=expected_added:
     raise RuntimeError("BASELINE_TOOL_PARITY_FAILED:"+json.dumps({
      "missing":missing[:20],"changed":changed[:20],"added":added[:20],
      "expectedAdded":expected_added}))
    parity={"baseTools":len(before),"added":added,"unchangedSchemas":len(before),
            "baselineSchemaParity":True}
   need={"capability_gap_report","capability_gap_list","capability_gap_get","capability_gap_update"}
   assert need<=names
   # A real installed preview must expose native tier diagnostics in MCP.
   # FULL in this preview means FULL_POWER, not Root/Administrator enrollment.
   status=request(port,"tools/call",{"name":"system_status","arguments":{}})["result"]["structuredContent"]
   access=status.get("accessStatus")
   assert isinstance(access,dict), "FULL_ACCESS_STATUS_NOT_PACKAGED"
   expected="FULL_POWER" if a.mode=="full" else "STANDARD"
   assert access.get("configuredTier")==expected, "INSTALLED_TIER_MISMATCH"
   assert access.get("effectiveTier")==expected, "EFFECTIVE_TIER_MISMATCH"
   assert access.get("fullAccessActive") is False, "PREVIEW_FALSE_ADMIN_PROMOTION"
   assert access.get("broker",{}).get("unrestrictedAdminShell") is False
   assert len(status["capabilityProfile"]["grantedCapabilities"])==(27 if a.mode=="full" else 0)
   action={"name":"run_shell","arguments":{"command":"whoami" if os.name=="nt" else "id -un",
            "timeoutMs":4000,"requestId":"oneinstall-mode-scope-qa-"+a.mode}}
   shell=request(port,"tools/call",action,ident=3)["result"]
   if a.mode=="full":
    assert shell.get("isError") is False,"FULL_POWER_SHELL_NOT_OPERATIONAL"
    assert shell.get("structuredContent",{}).get("exitCode")==0,"FULL_POWER_SHELL_EXIT"
   else:
    assert shell.get("isError") is True,"STANDARD_SHELL_WRONGLY_ALLOWED"
   result={"status":"INSTALL_AND_RUNTIME_PASS","os":os.name,"mode":a.mode,
    "managedRoots":1,"profileCount":len(reported["profiles"]),"tools":len(catalog),
    "toolSchemaHash":digest(sorted(catalog,key=lambda x:x["name"])),
    "packagedSourceSHA":product["archiveSha256"],
    "installerSHA":hashlib.sha256(a.installer.read_bytes()).hexdigest(),
    "productBuild":product["build"],"nativeAccessStatusValidated":True,
    "effectiveTier":access["effectiveTier"],"ownerModeMigrated":True,
    "grantedCapabilities":len(status["capabilityProfile"]["grantedCapabilities"]),
    "shellScopeVerified":True,"rootStagePathLeaks":False,
    "dev23Parity":parity,"rootStagePathLeaks":False,
    "productionInstallChanged":False,"uiIntegrated":False,
    "nativeUiBundled":bool(native),"nativeUiProbePass":bool(native),
    "installerSigned":False}
   print(json.dumps(result))
  finally:
   if proc.poll() is None:
    if os.name=="nt":proc.terminate()
    else:os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=4)
    except subprocess.TimeoutExpired:
     if os.name=="nt":proc.kill()
     else:os.killpg(proc.pid,signal.SIGKILL)
     proc.wait(timeout=4)
   log.close()
   config.write_text(json.dumps(original))
 print("ONE_INSTALL_SMOKE_TEMP_CLEANED")
if __name__=="__main__":main()
