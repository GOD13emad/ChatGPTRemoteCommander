# GNOME stability permanent-fix plan

Host: mmz-LOQ-15IRX9, Ubuntu GNOME/X11.

Verified findings before mutation API lockout:
- Lockscreen Studio 1.1.2 threw a disposed St.Widget lifecycle exception immediately before one gnome-session-failed event.
- A separate GNOME Shell XTEST/FakeInput BadValue crash was recorded earlier.
- Astra Monitor is healthy in the normal session and is not a removal target.
- MMZ Theme Manager already writes native GNOME background/screensaver image keys, so Lockscreen Studio is not required for lock-screen image authority.
- Commander was temporarily hardened by disabling Lockscreen Studio, fail-closing synthetic GUI takeover/XTEST mutation, and applying MemoryHigh=8G without MemoryMax/OOM kills.

Permanent actions after the Commander host-schema compatibility fix is installed locally:
1. Remove Lockscreen Studio dependency from the desktop/theme architecture after preserving its settings evidence; keep native GNOME lock-screen background handling.
2. Keep Astra Monitor and validate it after clean login/lock/unlock cycles.
3. Converge Commander router/backend/gui/browser helpers onto one qualified build; retire retained v0.9.2 only after persistent-terminal ownership/drain checks.
4. Replace temporary GUI stop-file with a persistent capability/config policy and qualify GNOME/Clutter input lifecycle on X11 before re-enabling mouse/keyboard takeover.
5. Retire or rework legacy xdotool injection helper where it is not required; never restore unrestricted XTEST as a generic fallback.
6. Run repeated login, lock/unlock, screenshot-only GUI, controlled synthetic input, Firefox, Theme Manager switch, and idle-load tests while checking for gnome-shell SIGSEGV, XTEST BadValue, disposed-widget errors, Xid and OOM.
7. Only after those gates pass, remove temporary guards and seal final evidence/rollback state.
