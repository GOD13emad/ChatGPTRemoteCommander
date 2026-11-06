Remote Commander v0.10.13
=========================

This candidate is a narrow observability follow-up to v0.10.12. The scoped Codex plugin refresh itself is working, but post-rollout validation found an unresolved mismatch between the canonical `linux-project-skills` source (1.4.13) and Codex `plugin/list` reporting 1.4.12. v0.10.12 intentionally reduced the Codex response to bounded metadata, but omitted the already-available `PluginSummary.source` field needed to prove which concrete source path Codex is listing.

Bounded source diagnostics
--------------------------
`codex_plugin_refresh` now includes a compact `source` object for each returned plugin and for the requested target. It supports the Codex 0.157.1 protocol source kinds:

- `local`: bounded local path;
- `git`: bounded URL/path/ref/SHA;
- `npm`: bounded package/version/registry; and
- `remote`: type only.

No arbitrary app-server response is returned. Each textual source field is capped by the existing 512-character field limit, and the existing JSONL frame, marketplace-count and plugin-count bounds remain unchanged.

Authority boundary
------------------
There is no delegation-policy expansion. The tool still requires explicit current-request confirmation plus authorized Full Power shell/process authority, still launches only `codex app-server`, still sends only `initialize`, `initialized`, and local-only `plugin/list(forceRefetch=true)`, and still strips API/token credentials from the sidecar environment.

Acceptance
----------
v0.10.12 remains accepted stable until v0.10.13 passes focused regressions, full qualification, hosted Windows/Ubuntu CI, Linux/Windows Server install canaries, immutable release publication, exact-ref rollout, and a live diagnostic refresh that identifies the concrete `linux-project-skills` source responsible for the 1.4.12 listing.
