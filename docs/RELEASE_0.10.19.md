Remote Commander v0.10.19
=========================

v0.10.19 completes the cross-platform monitoring/control parity work on top of
immutable v0.10.18 and the merged GNOME 50 compatibility revision.

Changes:
- adds an owner-private short-lived Browser Companion live monitor snapshot;
- exposes exact Core identity, GUI readiness, background-browser readiness,
  durable workflow count, Agent Extension inventory count and operation/lock
  counters to the native Remote Commander Browser panel;
- keeps the Browser monitor read-only: no web-page bridge, command channel,
  credentials, cookie access or execution authority is added;
- records GUI/background-browser UNCERTAIN separately so uncertain backends are
  never rendered as READY;
- carries the GNOME 50 monitor/compositor compatibility fix from PR #138;
- moves the Linux GNOME bridge to the fresh
  chatgpt-remote-commander-linux-safe-v2@god13emad UUID so the corrected module
  can be loaded in the current GNOME session without reboot/logout while
  superseded UUIDs are quarantined;
- preserves Mutter RemoteDesktop as the only Linux mouse/keyboard injection
  path and preserves explicit takeover, fresh-frame and local-stop safety gates.

Pinned Browser dependency:
- Remote Commander Browser v0.8.1 is immutable/non-prerelease at commit `39258bc8e143aa666465e0ad63c4f277b075fcf3`.
- Windows Setup `Remote-Commander-Browser-Setup-v0.8.1.exe` SHA-256 is `dcf4c5bc5d0ca8788f803e469246512af3745c81f578411dbabf6ce2a97feca2`.
- v0.10.19 release/build must fetch that exact immutable version and hash; v0.8.0 remains rollback history.

Release acceptance requires exact-head Windows/Linux qualification, hosted CI,
release-sync/server-canary/security gates, candidate-first live rollout and
post-rollout Browser monitor plus GUI readback. v0.10.18 remains immutable
rollback history.
