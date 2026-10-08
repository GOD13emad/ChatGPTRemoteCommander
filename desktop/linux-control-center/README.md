# Remote Commander Native Control Center (Linux preview)

**Status:** owner-private desktop monitoring preview. It is not a released Core upgrade, authenticated task editor, Browser-to-shell command bridge, or full project FINAL.

This GTK4/Libadwaita application follows live GNOME color-scheme preferences and, when GNOME is Default, the effective GTK dark theme without modifying browser settings. It provides tabs for Commander health, configured routing profiles, durable workflow metadata and safety/settings. It distinguishes **persisted workflow state from currently executing operations**: a RUNNING state in SQLite does not prove an active worker. No cookies, ChatGPT credentials, clipboard contents, generic shell calls or project files are read.

Security: owner-UID regular-file checks, no symlink input, bounded file/JSON sizes, monitor TTL/schema validation, canonical routing-pair validation, read-only SQLite mode=ro and PRAGMA query_only=ON, no workflow mutation, no user-supplied executable paths. Management changes need an independently qualified authenticated Core protocol; the preview does not fake their availability.

## Baseline and installation

Requires Ubuntu GNOME with GTK4, Libadwaita and Python GObject introspection. Execute from the audited Project Root; do not execute from Downloads or copy unknown profile data. Command examples:

    /usr/bin/python3 desktop/linux-control-center/install.py --dry-run
    /usr/bin/python3 desktop/linux-control-center/install.py --install
    /usr/bin/python3 desktop/linux-control-center/install.py --verify

Installer rejects root, unknown ownership, symlinks, changed source SHA, unknown existing target and unsafe reruns. It installs a standalone application, icon and menu/Desktop launchers without altering Core or Browser. Official logo SHA256: d724415693a4a4da8c20a065db978467ae979714d9b0559ace7dc33035461195.

## Verification

    /usr/bin/python3 -m unittest discover -s desktop/linux-control-center -p 'test_*.py' -v
    /usr/bin/python3 desktop/linux-control-center/control_center.py --audit

Final acceptance needs real host/owner visual evidence of Overview, Profiles, Tasks, Settings, theme switching, icon, keyboard focus and logout/power return only when permitted. This preview does not close GUI emergency STOP, immutable installer, privileged recovery or ChatGPT-tab delivery gates.

Rollback: only files listed in the verified private install-receipt.json, after exact SHA and owner review. Never delete other applications, historical backups, evidence, or entire user directories.
