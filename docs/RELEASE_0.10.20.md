# Remote Commander v0.10.20

v0.10.20 is a narrow successor to immutable v0.10.19. It does not change the accepted Browser v0.8.1 dependency or general Core execution policy.

## GNOME 50 in-session upgrade fallback

v0.10.19 introduced the fresh chatgpt-remote-commander-linux-safe-v2@god13emad UUID to avoid stale GJS module reuse. Live GNOME Shell 50.1 evidence showed that a brand-new local UUID is not dynamically discoverable in the already-running Wayland Shell session: the files and enabled setting existed, but GetExtensionInfo was empty, EnableExtension returned false, and ReloadExtension is explicitly unsupported. No logout/reboot was permitted.

v0.10.20 keeps the v2 path, but when that UUID is not discoverable it may reuse the previously-known chatgpt-remote-commander-linux-safe@god13emad backend only if its exact GNOME-50 compatibility SHA-256 pair matches the accepted migration bytes. The fallback is never synthesized or modified in place, and the pre-safe legacy UUID remains quarantined. Fresh installations with no exact known-safe fallback remain fail-closed and persist v2 for the next Shell session.

Live evidence on mmz-LOQ-15IRX9: exact fallback extension SHA-256 084c6c1244b25b4a714b0978d7f59b0b02fa8dbce45a962bff6cda6d18a17caa, metadata SHA-256 71375ff9ff21387355de83275be8a4b42361626208bcc120e7e41e6ffb08688e; activation produced a real org.gnome.Shell.Extensions.ChatGPTRemoteCommander bridge and gui_status reported Wayland with screenshot/cursor/window-list/mouse/keyboard/focus all available.

## Windows qualification harness stabilization

On the loaded Emad Windows host, the exact v0.10.19 runtime passed hosted Windows CI but the full local qualification intermittently exceeded two short test-harness windows: async continuation recovery (3 s) and the first delayed terminal read (2 s). The two affected tests then passed three consecutive isolated runs on the same host with zero product mutation.

v0.10.20 changes only those test harnesses: continuation recovery gets an 8 s bounded evidence window, and delayed terminal output uses the existing accumulating bounded-read helper for up to 5 s instead of assuming the first read contains the marker. Production terminal/continuation implementation and user-facing command timeouts are unchanged.

## Preserved safety

- no reboot, shutdown or logout path is added;
- no GNOME Shell replacement or kill is permitted;
- no raw Clutter/virtual-input injection is introduced;
- mouse/keyboard transport remains org.gnome.Mutter.RemoteDesktop;
- exact fallback hashes are mandatory;
- Browser v0.8.1 remains pinned by immutable SHA-256;
- candidate-first update, rollback, drain and idempotency gates are unchanged.
