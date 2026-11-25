#!/usr/bin/env python3
"""Reproducible, OPT-IN native X11 workspace isolation QA (not a Core backend).

Run on a disposable Linux QA host with:
  RC_QA_XVFB_BIN=/absolute/path/to/Xvfb python3 -B test/gui-private-x11-isolation-qa.py

This creates two distinct headless Xvfb displays with independent MIT-MAGIC-
COOKIE-1 authorities and Tk GUI clients. XTEST keyboard input targets each
DISPLAY explicitly. No real desktop, foreground window, user browser, tunnel,
service, or running Commander GUI session is opened or modified.

This is same-OS-user functional isolation, NOT a security boundary against a
malicious process under that user, NOT authenticated supervisor control, and
NOT a production workspace lifecycle implementation.
"""
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

TITLE_PREFIX = "RC_PRIVATE_X11_QA_"
DISPLAY_LOW = 1700
DISPLAY_HIGH = 1750
ROOT_PARENT = Path(tempfile.gettempdir())
PROBE_DEADLINE = 7
GUI_DEADLINE = 7


def native_app(label: str, receipt_file: Path):
    import tkinter as tk
    assert label in ("A", "B", "C")
    assert not receipt_file.exists()
    win = tk.Tk()
    win.title(TITLE_PREFIX + label)
    win.geometry("370x170+12+12")
    body = tk.Frame(win)
    body.pack(padx=14, pady=13, fill="both")
    tk.Label(body, text="Private GUI worker " + label, font=("Sans", 13)).pack()
    box = tk.Entry(body, width=38)
    box.pack(pady=12)
    def save(event=None):
        val = box.get()
        # Fixed-format synthetic receipt: never store real typed information.
        if val != "SYNTHETIC_ONLY_" + label:
            return
        raw = json.dumps({"worker": label, "synthetic": val}, sort_keys=True).encode()
        tmp = receipt_file.with_suffix(".partial")
        with tmp.open("xb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, receipt_file)
        tk.Label(body, text="Local worker confirmed").pack()
    box.bind("<Return>", save)
    win.after(300, box.focus_force)
    win.mainloop()


def run(args, *, env=None, timeout=4, check=True):
    p = subprocess.run(args, env=env, stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       text=True, timeout=timeout)
    if check and p.returncode:
        raise RuntimeError(f"Subprocess {Path(args[0]).name} exited {p.returncode}: " +
                           p.stderr.strip()[-280:])
    return p


def die_owned(p):
    if p is None or p.poll() is not None:
        return
    p.terminate()
    try:
        p.wait(timeout=2.5)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait(timeout=2.5)


def parent_death_guard():
    """QA-only Linux parent-death signal; no global process killing.

    Do not transplant Python preexec_fn into a multithreaded production Core.
    A production service needs a reviewed native child lifecycle broker.
    """
    import ctypes
    owner_pid=os.getpid()
    def set_guard():
        libc=ctypes.CDLL(None, use_errno=True)
        if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
            os._exit(121)
        if os.getppid() != owner_pid:
            os._exit(122)
    return set_guard


def linux_process_running(pid):
    try:
        state=Path(f"/proc/{pid}/stat").read_text().split()[2]
        return state not in ("X", "Z")
    except (OSError, IndexError):
        return False


def wait_until(predicate, seconds, label):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.12)
    raise RuntimeError(label + " did not become ready in time")


def binary(path):
    p = Path(path)
    if not p.is_absolute() or not p.is_file() or not os.access(p, os.X_OK):
        raise RuntimeError("QA_BINARY_UNAVAILABLE: " + p.name)
    return str(p)


def isolated_env(workspace: Path, display: str, auth: Path):
    env = {
        "PATH": "/usr/bin:/bin",
        "HOME": str(workspace),
        "LANG": "C.UTF-8",
        "DISPLAY": display,
        "XAUTHORITY": str(auth),
        "GDK_BACKEND": "x11",
        "WAYLAND_DISPLAY": "",
        "XDG_CONFIG_HOME": str(workspace / "config"),
        "XDG_CACHE_HOME": str(workspace / "cache"),
        "XDG_DATA_HOME": str(workspace / "data"),
    }
    for key in ("config", "cache", "data"):
        (workspace / key).mkdir(mode=0o700)
    return env


def start_worker(label, workroot, binaries, allocated):
    xvfb, xauth, xdpyinfo, _, _ = binaries
    workspace = workroot / ("worker-" + label.lower())
    workspace.mkdir(mode=0o700)
    auth = workspace / "authority"
    xlog = workspace / "xvfb.stderr"
    receipt = workspace / "input-result.json"
    started = None
    for d in range(DISPLAY_LOW, DISPLAY_HIGH):
        if d in allocated:
            continue
        if Path(f"/tmp/.X11-unix/X{d}").exists() or Path(f"/tmp/.X{d}-lock").exists():
            continue
        address = ":" + str(d)
        token = secrets.token_hex(16)
        try:
            run([xauth, "-f", str(auth), "add", address, ".", token], timeout=3)
            assert auth.is_file() and not (auth.stat().st_mode & 0o077)
            env = isolated_env(workspace, address, auth)
            log = xlog.open("wb")
            try:
                started = subprocess.Popen(
                    [xvfb, address, "-screen", "0", "640x480x24", "-nolisten", "tcp",
                     "-auth", str(auth), "-noreset"],
                    cwd=workspace, stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=log, env=env,
                    preexec_fn=parent_death_guard())
            finally:
                log.close()
            def ready():
                if started.poll() is not None:
                    raise RuntimeError("Xvfb child failed startup: " +
                                       xlog.read_text(errors="replace")[-180:])
                return run([xdpyinfo, "-display", address],
                           env=env, timeout=2, check=False).returncode == 0
            wait_until(ready, PROBE_DEADLINE, "Xvfb " + label)
            allocated.add(d)
            return dict(label=label, display=address, display_number=d, env=env,
                        authority=auth, receipt=receipt, xvfb=started, app=None,
                        screenshot=workspace / "screen.xwd")
        except Exception:
            die_owned(started)
            started = None
            # For display collision retry on another display; other failures
            # should not be hidden behind several blind process launches.
            if xlog.exists() and ("already active" in xlog.read_text(errors="replace").lower()):
                continue
            raise
    raise RuntimeError("No private X11 display slot available")


def run_crash_child(workroot: Path):
    """Intentionally exits without cleanup; outer QA confirms Xvfb is reaped."""
    xvfb=binary(os.environ.get("RC_QA_XVFB_BIN", ""))
    bins=(xvfb,binary("/usr/bin/xauth"),binary("/usr/bin/xdpyinfo"),
          binary("/usr/bin/xdotool"),binary("/usr/bin/xwd"))
    w=start_worker("C",workroot,bins,set())
    app=None
    try:
        app=subprocess.Popen(
            [sys.executable,"-B",str(Path(__file__).resolve()),"--app",
             "C",str(w["receipt"])],
            cwd=workroot, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, env=w["env"],
            preexec_fn=parent_death_guard())
        def app_ready():
            if app.poll() is not None:
                raise RuntimeError("Crash fixture Tk worker exited early")
            result=run([bins[3],"search","--onlyvisible","--name",
                        "^"+TITLE_PREFIX+"C$"],
                       env=w["env"],timeout=2,check=False)
            return result.returncode==0
        wait_until(app_ready,GUI_DEADLINE,"crash fixture Tk")
        print(json.dumps({"display":w["display"],
                          "display_number":w["display_number"],
                          "pid":w["xvfb"].pid,"appPid":app.pid}),flush=True)
        os._exit(79)  # Deliberately skip finally; PDEATHSIG must stop both.
    except Exception:
        die_owned(app)
        die_owned(w["xvfb"])
        raise


def prove_parent_death_cleanup(workroot: Path):
    child=subprocess.run(
        [sys.executable,"-B",str(Path(__file__).resolve()),
         "--crash-child",str(workroot)],
        env={"RC_QA_XVFB_BIN":os.environ["RC_QA_XVFB_BIN"],"PATH":"/usr/bin:/bin"},
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=15)
    if child.returncode != 79:
        raise RuntimeError("Controlled crash fixture failed: "+
                           child.stderr.strip()[-220:])
    receipt=json.loads(child.stdout)
    display=receipt["display"]
    pid=receipt["pid"]
    app_pid=receipt["appPid"]
    assert isinstance(pid,int) and pid>1
    assert isinstance(app_pid,int) and app_pid>1 and app_pid!=pid
    assert display==":"+str(receipt["display_number"])
    socket=Path("/tmp/.X11-unix/X"+str(receipt["display_number"]))
    try:
        wait_until(lambda:(not linux_process_running(pid)
                           and not linux_process_running(app_pid)
                           and not socket.exists()),
                   5,"crash-child Xvfb and Tk shutdown")
    finally:
        # If the parent-death mechanism failed, terminate only our exact
        # test-owned Xvfb child, not another session's server.
        if linux_process_running(pid):
            try:
                args=Path(f"/proc/{pid}/cmdline").read_bytes()
                if b"Xvfb" in args and display.encode() in args.split(bytes([0])):
                    os.kill(pid,signal.SIGTERM)
            except (OSError,ProcessLookupError):
                pass
        if linux_process_running(app_pid):
            try:
                args=Path(f"/proc/{app_pid}/cmdline").read_bytes()
                if b"gui-private-x11-isolation-qa.py" in args:
                    os.kill(app_pid,signal.SIGTERM)
            except (OSError,ProcessLookupError):
                pass
    return True


def run_pilot():
    if sys.platform != "linux":
        raise RuntimeError("Linux-only private X11 test")
    xvfb = binary(os.environ.get("RC_QA_XVFB_BIN", ""))
    xauth = binary("/usr/bin/xauth")
    xdpyinfo = binary("/usr/bin/xdpyinfo")
    xdotool = binary("/usr/bin/xdotool")
    xwd = binary("/usr/bin/xwd")
    binaries = (xvfb, xauth, xdpyinfo, xdotool, xwd)

    # No GUI input is allowed unless the explicitly supplied private server
    # has started and its Xauthority handshake succeeded.
    physical_display = os.environ.get("DISPLAY", "")
    initial_signals = {}
    workspaces = []
    screenshot_digests = {}
    report = {}
    old_umask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix="rc-private-x11-qa-", dir=ROOT_PARENT) as td:
            workroot = Path(td)
            assert not workroot.is_symlink() and (workroot.stat().st_mode & 0o077) == 0
            allocated = set()
            try:
                for label in ("A", "B"):
                    workspaces.append(start_worker(label, workroot, binaries, allocated))
                a, b = workspaces
                assert a["display"] != b["display"]
                assert all(w["display"] != physical_display for w in workspaces)

                # Connection authentication is scoped to each server, not
                # inferred from a display number or the caller's OS account.
                foreign = dict(a["env"], XAUTHORITY=str(b["authority"]))
                bad = run([xdpyinfo, "-display", a["display"]],
                          env=foreign, timeout=2, check=False)
                assert bad.returncode != 0, "Wrong Xauthority gained access"

                for w in workspaces:
                    w["app"] = subprocess.Popen(
                        [sys.executable, "-B", str(Path(__file__).resolve()), "--app",
                         w["label"], str(w["receipt"])],
                        cwd=workroot, stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        env=w["env"], preexec_fn=parent_death_guard())
                for w in workspaces:
                    def find_window():
                        if w["app"].poll() is not None:
                            raise RuntimeError("Tk worker failed before test")
                        found = run([xdotool, "search", "--onlyvisible", "--name",
                                     "^" + TITLE_PREFIX + w["label"] + "$"],
                                    env=w["env"], timeout=2, check=False)
                        return found.stdout.strip().splitlines()[0] if found.returncode == 0 and found.stdout.strip() else None
                    w["window"] = wait_until(find_window, GUI_DEADLINE, "Tk worker "+w["label"])
                # Focus is inside the private Xvfb, not the physical display.
                for w in workspaces:
                    run([xdotool, "windowfocus", "--sync", w["window"]],
                        env=w["env"], timeout=4)
                    time.sleep(0.40)
                    run([xdotool, "type", "--clearmodifiers", "--delay", "15",
                         "SYNTHETIC_ONLY_" + w["label"]], env=w["env"], timeout=5)
                    run([xdotool, "key", "Return"], env=w["env"], timeout=3)
                    wait_until(w["receipt"].exists, GUI_DEADLINE,
                               "private input receipt "+w["label"])
                    record = json.loads(w["receipt"].read_text())
                    assert record == {"worker": w["label"],
                                      "synthetic": "SYNTHETIC_ONLY_" + w["label"]}
                    other = b if w is a else a
                    if w is a:
                        assert not other["receipt"].exists(), "Input leaked into worker B"
                    # Capture only our disposable Xvfb root, not physical GUI.
                    run([xwd, "-display", w["display"], "-root", "-silent",
                         "-out", str(w["screenshot"])], env=w["env"], timeout=4)
                    screenshot_digests[w["label"]] = hashlib.sha256(
                        w["screenshot"].read_bytes()).hexdigest()
                assert a["receipt"].read_text() != b["receipt"].read_text()
                assert screenshot_digests["A"] != screenshot_digests["B"]
                report = {
                    "status": "PASS", "scope": "isolated_same_user_native_x11_QA",
                    "displays": [a["display"], b["display"]],
                    "separateServerPids": a["xvfb"].pid != b["xvfb"].pid,
                    "isolatedSyntheticInput": True,
                    "wrongAuthorityRejected": True,
                    "physicalDisplayUntouchedByDesign": True,
                    "observerCaptureOnlyPrivateRoots": True,
                    "screenshotSha256": screenshot_digests,
                    "productionInstalled": False,
                    "authenticatedSupervisor": False
                }
            finally:
                for w in reversed(workspaces):
                    die_owned(w.get("app"))
                for w in reversed(workspaces):
                    die_owned(w.get("xvfb"))
                # Do not unlink sockets or kill processes not created here.
                report["ownedWorkersStopped"] = all(
                    w.get("xvfb") is None or w["xvfb"].poll() is not None
                    for w in workspaces)
                report["ownedAppsStopped"] = all(
                    w.get("app") is None or w["app"].poll() is not None
                    for w in workspaces)
                if report.get("status") == "PASS":
                    assert report["ownedWorkersStopped"] and report["ownedAppsStopped"]
            if report.get("status") == "PASS":
                report["parentCrashCleanup"] = prove_parent_death_cleanup(workroot)
    finally:
        os.umask(old_umask)
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    try:
        if len(sys.argv) == 4 and sys.argv[1] == "--app":
            native_app(sys.argv[2], Path(sys.argv[3]))
        elif len(sys.argv) == 1:
            run_pilot()
        elif len(sys.argv) == 3 and sys.argv[1] == "--crash-child":
            run_crash_child(Path(sys.argv[2]))
        else:
            raise RuntimeError("Expected no args or internal --app fixture")
    except Exception as exc:
        print("PRIVATE_X11_QA_FAILED: " + type(exc).__name__ + ": " + str(exc)[:260],
              file=sys.stderr)
        raise SystemExit(1)
