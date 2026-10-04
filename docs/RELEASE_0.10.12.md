Remote Commander v0.10.12
=========================

This candidate adds one evidence-driven maintenance capability for a gap discovered while auditing the Linux Codex plugin projection. The canonical `linux-project-skills` source is newer than its derived Codex managed cache, and Codex 0.157.1 refreshes that local cache through `plugin/list` with `forceRefetch=true`. Remote Commander v0.10.11 intentionally blocks general local Codex launch, but it exposed no narrow path to trigger that supported administrative refresh.

Scoped Codex plugin maintenance
-------------------------------
The new `codex_plugin_refresh` tool starts a short-lived `codex app-server` sidecar and sends only the protocol sequence required for local plugin discovery and cache refresh:

1. `initialize`;
2. `initialized`; and
3. `plugin/list` with `forceRefetch=true`.

The tool accepts no arbitrary Codex executable, subcommand, arguments, prompt, review request, thread request, turn request, or agent/delegation payload.

Authority and secret boundary
-----------------------------
The maintenance path requires both an explicitly authorized Full-Power profile and `confirmCurrentRequest=true` on the individual call. It does not change or require the broad `powerMode.codexControl.allowLaunch` delegation switch.

OpenAI/Codex API-key and token environment variables are removed before the sidecar is started. A legitimate local Codex home is preserved so the existing authenticated desktop state and configured marketplaces can be read by Codex itself; Commander's generated no-Codex sentinel home is not reused for maintenance.

Transport safety
----------------
The entire synchronous sidecar interaction uses one shared deadline capped at eight seconds, below Commander's ten-second direct synchronous transport ceiling. The sidecar is terminated after the response, and the returned payload is reduced to bounded marketplace/plugin metadata rather than forwarding unbounded app-server output.

Regression boundary
-------------------
Automated tests prove that missing current-request confirmation fails before process creation, Standard/non-authorized profiles remain denied, the spawned command is exactly `codex app-server`, the only client methods are the fixed maintenance handshake plus `plugin/list`, `forceRefetch` is always true, and the tool schema exposes no `command`, `args`, or `prompt` escape hatch.

Acceptance
----------
v0.10.11 remains the accepted stable baseline until v0.10.12 passes focused tests, full check/test/security qualification, hosted Windows and Ubuntu CI, Linux and Windows Server install canaries, immutable release publication, candidate-first exact-ref rollout, and a live post-cutover `linux-project-skills` cache refresh with source/cache version and hash verification.
