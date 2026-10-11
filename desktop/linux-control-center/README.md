# Remote Commander Control Center — R32 GTK4/Adwaita

This is a **read-only native** Control Center candidate for Linux. It does not replace a running Commander release, install a service, elevate privileges, access browser profiles, or execute workflows.

The original owner-private telemetry readers remain in `control_center.py`: bounded JSON, exact owner and file-mode guards, canonical routing runtime pairs, and SQLite `mode=ro` + `PRAGMA query_only=ON`. `dashboard_ui.py` is presentation-only and receives sanitized callbacks.

## Visual system
- Adaptive dark/light GNOME color scheme, consistent overview/metric cards, sidebar navigation and readable typography.
- Connection, native GUI, background Browser and live-operation state **do not** fabricate green/healthy from missing data.
- Profiles are canonical read-only records; workflows show persisted state, not a claim that an active worker is running.
- Search filters workflow rows without network, shell, execution or credential access.
- Refresh does not rebuild unchanged workflow/profile lists, preserving search state and scroll.
- Security and control authority are shown explicitly; task mutations require a future separately accepted authenticated Core IPC.

## Verification
Run `python3 -B -m unittest discover -s desktop/linux-control-center -p 'test*.py' -v`. R32 Emad Linux isolated run: **16 passed**, log SHA256 `c075df222601cff3f05c36f114a4f29936b2995e8832a31ffba3f51b7b50491d`.

A synthetic GTK4 Broadway visual experiment **failed** (SIGSEGV in libgtk-4.so.1); this is an OPEN independent Native GUI validation gate. Backtrace SHA256 `eb2c970fdef8318f863082c629f72ffc74e0d12c133a7b6826403f70e40facd3`. Do not classify native rendering as PASS. All synthetic Broadway processes were terminated and the live desktop remained untouched.

Never use this preview to assume real runner state, submit changes to user workflows or close STOP/Mutex gates. Production installation is not performed by this PR.
