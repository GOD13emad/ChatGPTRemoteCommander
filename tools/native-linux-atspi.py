#!/usr/bin/env python3
"""Bounded read-only AT-SPI inspection. No input APIs or password-store access."""
import json
import sys
from collections import deque
def emit(v):
    print(json.dumps(v, ensure_ascii=True, separators=(",", ":")))
def main():
    if len(sys.argv)<2 or sys.argv[1] not in ("probe","observe"):
        emit({"ok":False,"code":"ATSPI_ARGUMENTS_INVALID"}); return 2
    mode=sys.argv[1]
    if mode=="probe" and len(sys.argv)!=2:
        emit({"ok":False,"code":"ATSPI_ARGUMENTS_INVALID"}); return 2
    if mode=="observe":
        if len(sys.argv)!=4 or not sys.argv[2].isdigit() or not sys.argv[3].isdigit():
            emit({"ok":False,"code":"ATSPI_ARGUMENTS_INVALID"}); return 2
        pid,limit=int(sys.argv[2]),int(sys.argv[3])
        if not 1<=pid<=2147483647 or not 1<=limit<=100:
            emit({"ok":False,"code":"ATSPI_ARGUMENTS_INVALID"}); return 2
    try:
        import gi
        gi.require_version("Atspi","2.0")
        from gi.repository import Atspi
        Atspi.init()
        desktop=Atspi.get_desktop(0)
        if desktop is None: raise RuntimeError("no desktop")
        count=desktop.get_child_count()
        if not 0<=count<=100000: raise RuntimeError("invalid count")
    except Exception:
        emit({"ok":False,"code":"ATSPI_SESSION_OR_LIBRARY_UNAVAILABLE"}); return 3
    if mode=="probe":
        emit({"ok":True,"provider":"linux-atspi-native","mode":"AT_SPI_PROBE","desktopAccessible":True}); return 0
    target=None
    for i in range(min(count,256)):
        try:
            app=desktop.get_child_at_index(i)
            if app is not None and app.get_process_id()==pid: target=app; break
        except Exception: pass
    if target is None:
        emit({"ok":False,"code":"ATSPI_TARGET_NOT_IN_SESSION"}); return 4
    queue=deque([(target,0)]); elements=[]; scanned=0
    while queue and len(elements)<limit and scanned<240:
        obj,depth=queue.popleft(); scanned+=1
        try:
            role=str(obj.get_role_name() or "")[:100]
            name="[redacted]" if "password" in role.lower() else str(obj.get_name() or "")[:160]
            elements.append({"role":role,"name":name})
            if depth<5:
                for j in range(min(max(int(obj.get_child_count()),0),40)):
                    child=obj.get_child_at_index(j)
                    if child is not None: queue.append((child,depth+1))
        except Exception: pass
    emit({"ok":True,"provider":"linux-atspi-native","mode":"AT_SPI_OBSERVE","pid":pid,"elements":elements})
    return 0
if __name__=="__main__": sys.exit(main())
