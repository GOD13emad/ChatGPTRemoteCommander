#!/usr/bin/python3
"""User-local Remote Commander private X11 workspace manager (Emad Laptop).

No root, no physical desktop manipulation, no cross-chat authentication.
Start/stop controls only the two explicitly pinned Xvfb instances; no
arbitrary executable or shell payloads are accepted. A separate protected
Core broker is needed before exposing native input as public MCP tools.
"""
from __future__ import annotations
import argparse
import ast
import re
import stat
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import tempfile
import time

HOME=Path.home()
ROOT=HOME/".local/state/chatgpt-remote-commander/private-gui"
XVFB=HOME/".cache/rc-emad-private-gui-v1/binroot/usr/bin/Xvfb"
SEATS={"a":1960,"b":1961}
UNIT="rc-private-gui@{}.service"
STOP=False


def fail(value):
    raise RuntimeError(value)


def verify_dir(p):
    q=p.lstat()
    if not p.is_dir() or p.is_symlink() or q.st_uid!=os.getuid() or q.st_mode & 0o077:
        fail("PRIVATE_GUI_ROOT_NOT_OWNER_PRIVATE")


def mkdir_owned(p):
    p.mkdir(parents=True,exist_ok=True,mode=0o700)
    verify_dir(p)


def workspace(seat):
    if seat not in SEATS:fail("PRIVATE_GUI_SEAT_INVALID")
    return ROOT/seat


def run(args,timeout=7,env=None,check=True):
    r=subprocess.run(args,capture_output=True,text=True,stdin=subprocess.DEVNULL,
                     timeout=timeout,env=env)
    if check and r.returncode:
        fail("PRIVATE_GUI_COMMAND_FAILED:"+Path(args[0]).name)
    return r


def write_atomic(p,obj):
    body=(json.dumps(obj,sort_keys=True)+"\n").encode()
    fd,temp=tempfile.mkstemp(prefix="."+p.name+".",dir=p.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as stream:
            stream.write(body);stream.flush();os.fsync(stream.fileno())
        os.replace(temp,p)
    finally:
        if os.path.lexists(temp):os.unlink(temp)


def guarded_signal(_sig,_frame):
    global STOP
    STOP=True


def owner_at_spi_address(raw, uid):
    """Accept only this owner's real AT-SPI socket path from the user D-Bus broker."""
    try:
        payload=ast.literal_eval(raw.strip())
    except (SyntaxError,ValueError):
        return None
    if not isinstance(payload,tuple) or len(payload)!=1 or not isinstance(payload[0],str):
        return None
    expected=rf"unix:path=/run/user/{uid}/at-spi/bus(?:,guid=[0-9a-fA-F]{{32}})?"
    return payload[0] if re.fullmatch(expected,payload[0]) else None


def publish_owner_at_spi(env):
    """Publish the existing owner a11y bus to this *private Xvfb root only*.

    Linux toolkit clients may not expose their AX subtree until the X11
    AT_SPI_BUS root atom is present BEFORE the target application starts.
    Never start another bus/registry or change global desktop settings.
    A missing bus leaves private GUI observation available but AX unverified.
    """
    bus=Path(f"/run/user/{os.getuid()}/at-spi/bus")
    try:
        bs=bus.lstat()
        if not stat.S_ISSOCK(bs.st_mode) or bs.st_uid!=os.getuid():
            return False
        broker=run(["/usr/bin/gdbus","call","--session",
             "--dest","org.a11y.Bus","--object-path","/org/a11y/bus",
             "--method","org.a11y.Bus.GetAddress"],
             timeout=4,env=env,check=False)
        if broker.returncode: return False
        address=owner_at_spi_address(broker.stdout,os.getuid())
        if address is None:return False
        before=run(["/usr/bin/xprop","-root","AT_SPI_BUS"],timeout=3,env=env,check=False)
        # xprop can print "no such atom" yet exit successfully (observed
        # on this Xvfb build). Inspect exact output, not only the exit code.
        missing="no such atom" in ((before.stdout or "")+(before.stderr or ""))
        if not missing:
            return before.returncode==0 and address in before.stdout
        applied=run(["/usr/bin/xprop","-root","-f","AT_SPI_BUS","8s",
                     "-set","AT_SPI_BUS",address],timeout=3,env=env,check=False)
        if applied.returncode:return False
        after=run(["/usr/bin/xprop","-root","AT_SPI_BUS"],timeout=3,env=env,check=False)
        return after.returncode==0 and address in after.stdout
    except (OSError,ValueError,subprocess.TimeoutExpired):
        return False


def server(seat):
    global STOP
    n=SEATS[seat]
    display=f":{n}"
    if not XVFB.is_file() or not os.access(XVFB,os.X_OK):
        fail("PRIVATE_GUI_XVFB_NOT_AVAILABLE")
    if ROOT.exists():verify_dir(ROOT)
    else:mkdir_owned(ROOT)
    state=workspace(seat)
    mkdir_owned(state)
    sock=Path(f"/tmp/.X11-unix/X{n}")
    lock=Path(f"/tmp/.X{n}-lock")
    if sock.exists() or lock.exists():
        fail("PRIVATE_GUI_DISPLAY_IN_USE_NO_TAKEOVER")
    authority=state/"authority"
    if os.path.lexists(authority) and (
      authority.is_symlink() or not authority.is_file() or
      authority.lstat().st_uid!=os.getuid() or authority.lstat().st_mode&0o077
    ):
        fail("PRIVATE_GUI_XAUTH_UNTRUSTED")
    env=dict(os.environ,DISPLAY=display,XAUTHORITY=str(authority),
             WAYLAND_DISPLAY="",GDK_BACKEND="x11")
    run(["/usr/bin/xauth","-f",str(authority),"add",display,".",
         secrets.token_hex(16)],env=env)
    if authority.stat().st_mode & 0o077:
        fail("PRIVATE_GUI_XAUTH_PERMISSIONS")
    err=state/"xvfb.stderr.log"
    logfd=os.open(err,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
    try:
        p=subprocess.Popen([str(XVFB),display,"-screen","0","1280x800x24",
                            "-nolisten","tcp","-auth",str(authority),
                            "-noreset"],env=env,cwd=state,
                            stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                            stderr=logfd)
    finally:os.close(logfd)
    signal.signal(signal.SIGTERM,guarded_signal)
    signal.signal(signal.SIGINT,guarded_signal)
    ready=state/"ready.json"
    try:
        until=time.monotonic()+10
        while time.monotonic()<until:
            if p.poll() is not None:fail("PRIVATE_GUI_XVFB_EXITED")
            probe=run(["/usr/bin/xdpyinfo","-display",display],env=env,
                      timeout=2,check=False)
            if probe.returncode==0:break
            time.sleep(.15)
        else:fail("PRIVATE_GUI_XVFB_TIMEOUT")
        at_spi_published=publish_owner_at_spi(env)
        write_atomic(ready,{"schema":1,"seat":seat,"display":display,
                   "atSpiBusPublished":at_spi_published,
                   "xvfbPid":p.pid,"supervisorPid":os.getpid(),
                   "startedAt":int(time.time()),"ownerUid":os.getuid(),
                   "physicalDesktopInput":False,
                   "authenticatedChatIdentity":False})
        while not STOP:
            if p.poll() is not None:fail("PRIVATE_GUI_XVFB_EXITED")
            time.sleep(.3)
    finally:
        if p.poll() is None:
            p.terminate()
            try:p.wait(timeout=4)
            except subprocess.TimeoutExpired:
                p.kill();p.wait(timeout=4)
        # Do not remove a route or child's cookie if a foreign writer replaced it.
        try:
            record=json.loads(ready.read_text())
            if record.get("supervisorPid")==os.getpid() and record.get("xvfbPid")==p.pid:
                ready.unlink()
        except (OSError,ValueError,TypeError):
            pass


def inspect(seat):
    disp=f":{SEATS[seat]}"
    state=workspace(seat)
    output={"seat":seat,"display":disp,"service":"UNKNOWN",
            "guiReady":False,"privateDesktop":True,
            "productionCoreIntegrated":False,
            "authenticatedChatIdentity":False}
    cmd=run(["/usr/bin/systemctl","--user","is-active",UNIT.format(seat)],
            timeout=4,check=False)
    output["service"]=cmd.stdout.strip() or "unknown"
    record=state/"ready.json"
    if record.is_file() and not record.is_symlink():
        try:
            value=json.loads(record.read_text())
            if value.get("seat")==seat and value.get("display")==disp:
                output["serverPid"]=value.get("xvfbPid")
                auth=state/"authority"
                if auth.is_file() and not auth.is_symlink() and auth.stat().st_mode&0o077==0:
                    env=dict(os.environ,DISPLAY=disp,XAUTHORITY=str(auth),
                             WAYLAND_DISPLAY="",GDK_BACKEND="x11")
                    probe=run(["/usr/bin/xdpyinfo","-display",disp],
                              timeout=2,env=env,check=False)
                    output["guiReady"]=(probe.returncode==0 and
                                         output["service"]=="active")
        except Exception:
            output["reason"]="UNKNOWN_OR_UNVERIFIED_RECEIPT"
    return output


def start(seat):
    targets=list(SEATS) if seat=="all" else [seat]
    for s in targets:
        if s not in SEATS:fail("SEAT_INVALID")
        run(["/usr/bin/systemctl","--user","start",UNIT.format(s)],timeout=15)
    deadline=time.monotonic()+12
    while time.monotonic()<deadline:
        if all(inspect(s)["guiReady"] for s in targets):return
        time.sleep(.2)
    fail("PRIVATE_GUI_NOT_READY_AFTER_START")


def stop(seat):
    targets=list(SEATS) if seat=="all" else [seat]
    for s in targets:
        if s not in SEATS:fail("SEAT_INVALID")
        run(["/usr/bin/systemctl","--user","stop",UNIT.format(s)],timeout=15)
    if any(inspect(s)["guiReady"] for s in targets):
        fail("PRIVATE_GUI_STOP_UNCONFIRMED")


def repair(seat,force):
    if seat not in SEATS:fail("SEAT_INVALID")
    active=inspect(seat)
    if active["guiReady"] and not force:
        fail("SEAT_HEALTHY_REPAIR_REFUSED_WITHOUT_FORCE")
    # A failed/stale workspace may hold an unknown native effect. Never
    # reissue an old mouse/keyboard command. Restart only its own service.
    run(["/usr/bin/systemctl","--user","reset-failed",UNIT.format(seat)],timeout=5)
    if active["service"]=="active" and force:
        stop(seat)
    start(seat)


def capture(seat):
    status=inspect(seat)
    if not status["guiReady"]:fail("PRIVATE_GUI_NOT_READY_FOR_CAPTURE")
    from PIL import ImageGrab,features
    if not features.check_feature("xcb"):fail("PIL_XCB_UNAVAILABLE")
    n=SEATS[seat]
    auth=workspace(seat)/"authority"
    oldx=os.environ.get("XAUTHORITY")
    try:
        os.environ["XAUTHORITY"]=str(auth)
        im=ImageGrab.grab(xdisplay=f":{n}")
    finally:
        if oldx is None:os.environ.pop("XAUTHORITY",None)
        else:os.environ["XAUTHORITY"]=oldx
    if im.size!=(1280,800):fail("PRIVATE_GUI_FRAME_SIZE_INVALID")
    evidence=workspace(seat)/("capture-"+str(time.time_ns())+".png")
    with evidence.open("xb") as stream:
        im.save(stream,format="PNG")
    return {"frame":str(evidence),"width":im.width,"height":im.height,
            "sha256":hashlib.sha256(evidence.read_bytes()).hexdigest(),
            "privateDisplay":True}


def owner_menu():
    if "DISPLAY" not in os.environ and "WAYLAND_DISPLAY" not in os.environ:
        fail("NATIVE_MENU_NEEDS_OWNER_GUI_SESSION")
    labels={
        "Status":"status","Start both":"start",
        "Repair A":"repair-a","Repair B":"repair-b",
        "Capture A":"capture-a","Capture B":"capture-b",
        "Observe A":"observe-a","Observe B":"observe-b",
        "Application status":"appstatus",
        "Launch app A":"launch-a","Launch app B":"launch-b",
        "Stop app A":"stopapp-a","Stop app B":"stopapp-b",
        "Stop both":"stop"
    }
    while True:
        rows=[]
        for label in labels:rows.extend([label,label])
        r=run(["/usr/bin/zenity","--list",
               "--title=Commander Private GUI Recovery",
               "--text=Owner-local manager; does not control your desktop.",
               "--column=Action","--column=Description",
               *rows,"--width=575","--height=380"],timeout=3600,check=False)
        if r.returncode or not r.stdout.strip():break
        label=r.stdout.strip()
        action=labels.get(label)
        if action is None:continue
        try:
            if action=="status":value={"seats":[inspect(s) for s in SEATS]}
            elif action=="start":start("all");value={"status":"STARTED"}
            elif action=="stop":
                q=run(["/usr/bin/zenity","--question",
                       "--text=Stop both private displays and their apps?"],
                      timeout=3600,check=False)
                if q.returncode:continue
                stop("all");value={"status":"STOPPED"}
            elif action.startswith("repair"):
                seat=action[-1]
                q=run(["/usr/bin/zenity","--question",
                       "--text=Restart only private workspace "+seat.upper()+
                       "? Any apps in it will close."],
                      timeout=3600,check=False)
                if q.returncode:continue
                repair(seat,True);value={"status":"REPAIRED","seat":seat}
            elif action=="appstatus":
                appman=HOME/".local/bin/rc-private-gui-app"
                out=run([sys.executable,str(appman),"status","all"],timeout=12)
                value=json.loads(out.stdout)
            elif action.startswith("launch-") or action.startswith("stopapp-"):
                seat=action[-1]
                appman=HOME/".local/bin/rc-private-gui-app"
                if not appman.is_file() or appman.is_symlink():
                    fail("PRIVATE_GUI_APP_MANAGER_UNTRUSTED")
                choices=[("Clock","clock"),("Calculator","calculator"),
                         ("Text Editor","editor")]
                rows=[]
                for label,key in choices:
                    rows.extend([label,key])
                select=run(["/usr/bin/zenity","--list",
                            "--title=Commander approved private apps",
                            "--text=Choose an allowlisted native application",
                            "--column=Application","--column=App ID",
                            "--print-column=2",*rows,"--width=520"],
                           timeout=3600,check=False)
                if select.returncode or not select.stdout.strip():
                    continue
                app=select.stdout.strip()
                if app not in dict((key,label) for label,key in choices):
                    fail("PRIVATE_GUI_APP_NOT_ALLOWLISTED")
                mode="start" if action.startswith("launch-") else "stop"
                if mode=="stop":
                    confirm=run(["/usr/bin/zenity","--question",
                                 "--text=Stop private "+seat.upper()+
                                 " application "+app+" only?"],
                                timeout=3600,check=False)
                    if confirm.returncode:
                        continue
                result=run([sys.executable,str(appman),mode,seat,app],
                           timeout=25)
                value=json.loads(result.stdout)
            elif action.startswith("capture"):
                value=capture(action[-1])
            elif action.startswith("observe"):
                seat=action[-1]
                if not inspect(seat)["guiReady"]:
                    fail("PRIVATE_GUI_NOT_READY_FOR_OBSERVATION")
                viewer=HOME/".local/bin/rc-private-gui-viewer"
                if not viewer.is_file() or viewer.is_symlink():
                    fail("PRIVATE_GUI_VIEWER_UNTRUSTED")
                proc=subprocess.Popen(
                    [sys.executable,str(viewer),seat],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                    start_new_session=True)
                value={"status":"OBSERVE_ONLY_VIEWER_REQUESTED",
                       "seat":seat,"processId":proc.pid,
                       "keyboardMouseForwarding":False}
            else:continue
        except Exception as exc:
            value={"error":str(exc)}
        run(["/usr/bin/zenity","--info","--title=Commander Private GUI",
             "--text="+json.dumps(value,indent=2),
             "--width=600"],timeout=3600,check=False)


def main():
    if not sys.platform.startswith("linux") or os.geteuid()==0:
        fail("LINUX_USER_LOCAL_ONLY")
    ap=argparse.ArgumentParser()
    ap.add_argument("action",choices=["serve","status","start","stop","repair",
                                      "capture","menu"])
    ap.add_argument("seat",nargs="?",default="all")
    ap.add_argument("--force",action="store_true")
    args=ap.parse_args()
    if args.action=="serve":
        server(args.seat);return
    if args.action=="menu":
        owner_menu();return
    if args.action=="status":
        print(json.dumps({"seats":[inspect(s) for s in SEATS]},sort_keys=True))
    elif args.action=="start":
        start(args.seat);print(json.dumps({"seats":[inspect(s) for s in SEATS]}))
    elif args.action=="stop":
        stop(args.seat);print(json.dumps({"seats":[inspect(s) for s in SEATS]}))
    elif args.action=="repair":
        repair(args.seat,args.force);print(json.dumps(inspect(args.seat)))
    elif args.action=="capture":
        print(json.dumps(capture(args.seat)))


if __name__=="__main__":
    try:main()
    except Exception as exc:
        print(json.dumps({"ok":False,"error":str(exc)}),file=sys.stderr)
        sys.exit(2)
