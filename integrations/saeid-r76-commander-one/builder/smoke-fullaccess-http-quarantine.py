#!/usr/bin/env python3
"""Real installed one-file preview: owner FULL_POWER works; configured FULL_ACCESS
must reject every anonymous legacy MCP request. QA uses disposable local paths
and never runs an elevated worker or invokes a shell tool.
"""
import argparse, json, os, pathlib, socket, subprocess, tempfile, time
import urllib.request, urllib.error
from pathlib import Path

def run(args, timeout=50):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError("QA_SETUP_FAILED:"+str(p.returncode)+":"+p.stderr[-300:])
    return p.stdout

def port_free():
    with socket.socket() as s:
        s.bind(("127.0.0.1",0))
        return s.getsockname()[1]

def fetch(url, body=None, authorization=None):
    headers={"content-type":"application/json"}
    if authorization is not None: headers["authorization"]=authorization
    req=urllib.request.Request(url, data=body, headers=headers,
        method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(req,timeout=4) as r:
            return r.status,json.loads(r.read(1024*1024).decode("utf-8","replace"))
    except urllib.error.HTTPError as e:
        return e.code,json.loads(e.read(1024*1024).decode("utf-8","replace"))

def stage(executable, installed, port, configured_fullaccess):
    cfg=installed/"state/profiles/default.json"
    data=json.loads(cfg.read_text(encoding="utf-8"))
    if data["capabilityProfile"]["tier"] != "FULL_POWER":
        raise RuntimeError("QA_PREVIEW_NOT_FULL_POWER")
    if configured_fullaccess:
        # Deliberate synthetic QA config, NOT an actual native owner grant.
        data["capabilityProfile"]["tier"]="FULL_ACCESS"
    data["port"]=port
    cfg.write_text(json.dumps(data),encoding="utf-8")
    command=([str(installed/"Commander.exe")] if os.name=="nt"
        else [str(installed/"bin/node"),str(installed/"Commander.cjs")])
    log=open(installed.parent/"qa-server.log","w",encoding="utf-8")
    flags=getattr(subprocess,"CREATE_NO_WINDOW",0) if os.name=="nt" else 0
    child=subprocess.Popen(command+["--run","--target",str(installed)],
          cwd=installed,stdout=log,stderr=subprocess.STDOUT,
          creationflags=flags,start_new_session=os.name!="nt")
    try:
        good=False
        for _ in range(100):
            if child.poll() is not None:break
            try:
                status,result=fetch(f"http://127.0.0.1:{port}/health")
                if status==200 and result.get("ok") is True:good=True;break
            except Exception:time.sleep(.10)
        if not good:
            log.flush()
            raise RuntimeError("QA_RUNTIME_NOT_READY:"+Path(log.name).read_text(errors="replace")[-500:])
        post=json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}).encode()
        statuses=[]
        for auth in (None,"Bearer forged-test-token"):
            status,payload=fetch(f"http://127.0.0.1:{port}/mcp",post,auth)
            statuses.append(status)
            if configured_fullaccess:
                if status!=403 or payload!={"error":"trusted_transport_required"}:
                    raise RuntimeError("P0_UNAUTHENTICATED_FULL_ACCESS_ACCEPTED")
            else:
                if status!=200 or "result" not in payload:
                    raise RuntimeError("NORMAL_FULL_POWER_REGRESSED")
        return statuses
    finally:
        if child.poll() is None:
            child.terminate()
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill();child.wait(timeout=5)
        log.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--installer",type=Path,required=True)
    parser.add_argument("--expected-sha256",required=True)
    a=parser.parse_args()
    if not a.installer.is_file():raise RuntimeError("QA_INSTALLER_MISSING")
    import hashlib
    if hashlib.sha256(a.installer.read_bytes()).hexdigest()!=a.expected_sha256:
        raise RuntimeError("QA_INSTALLER_HASH_CHANGED")
    if os.name=="nt":base=Path(os.environ["TEMP"])
    else:base=Path.home()/".cache"
    with tempfile.TemporaryDirectory(prefix="rc-one-native-auth-qa-",dir=base) as tmp:
        installed=Path(tmp)/"managed"
        run([str(a.installer),"--install","--target",str(installed),"--mode","full"])
        owner=stage(a.installer,installed,port_free(),False)
        privileged=stage(a.installer,installed,port_free(),True)
        print(json.dumps({"status":"PRIVILEGED_HTTP_FAIL_CLOSED_QA_PASS",
          "ownerTokenFullPower":owner,"fullAccessConfigured":privileged,
          "trustedV2AuthenticatedExecutionProved":False,
          "actualAdminTokenTested":False,
          "productionTouched":False,"qaCleanUp":True}))
if __name__=="__main__":main()
