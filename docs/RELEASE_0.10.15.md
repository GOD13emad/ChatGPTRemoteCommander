Remote Commander v0.10.15

Purpose
-------
v0.10.15 is a narrow hotfix release on top of the immutable v0.10.14 merge/tag. It closes the remaining Windows interactive-terminal readiness race found by independent hosted Windows CI and Windows Server canary execution.

Change
------
- Windows interactive terminals with an initial command launch PowerShell using `-NoExit -Command <validated command>`.
- The initial command is no longer written to redirected stdin before shell readiness.
- Follow-up `send_terminal` input continues through the same stdin pipe.
- Linux interactive-shell behavior is unchanged.
- Lifecycle regression reads successive bounded terminal chunks until the expected marker or a fixed readiness deadline.
- Release/runtime/install/server/plugin identities advance to 0.10.15.

Release discipline
------------------
v0.10.14 remains immutable. v0.10.15 may be promoted only after exact-head Windows qualification, hosted CI and server canary, Linux laptop acceptance, Amirreza server acceptance, merge, immutable tag/release publication, and post-release install/readback evidence.

Known non-goals
---------------
This hotfix does not change scheduler semantics, browser session/login handling, tunnel credentials, desktop takeover policy, or Linux GUI architecture.
