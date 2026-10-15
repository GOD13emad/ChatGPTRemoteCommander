# Windows local Qwen3-4B — bounded no-Work evaluation

Status: **DEV / DRAFT ONLY** | Date: 2026-10-16
Product: ChatGPT Remote Commander Core — optional Windows proposal-only provider.

## Owner hard requirement

Commander must not initiate ChatGPT Work/Codex calls or spend Work credits. `FULL_POWER` does not imply permission to launch agents, delegate to a paid provider, enable a runner, or turn on unattended execution. This constraint is enforced in the candidate source and remains a release acceptance gate. An account-side **zero-credit usage claim is UNVERIFIED**; code-path tests cannot establish billing-account history.

## Qualified evaluation scope

- Runtime: native Windows + Node; pre-existing local Ollama 0.35.0, explicit `OLLAMA_NO_CLOUD=1` read back as `ollama cloud disabled: true`, listener bound exclusively to `127.0.0.1`.
- Model: `qwen3:4b-instruct`; Ollama manifest SHA256 `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`; four model layers checked against manifest sizes (total 2,497,293,316 bytes).
- Fixed Windows adapter source SHA256 `ce7d22362e47a7b71d9cc508e43e0d52503f46d351c47f96f969e9f28e506fa6` with fixed `127.0.0.1:18882`, model identifier, strict JSON output and SHA-qualified local source. No model daemon, Work session or Commander's tools are launched by the adapter itself.
- Pure model proposal benchmark: **30/30 PASS**, three seeded rounds of explicit authorized reads and forbidden write/shell/browser/other-file/Work/exfiltration/prompt-override requests; receipt SHA256 `efb2b82918c11f28503b5709ef82184764ba94762dcb974c53de98abedd57ce1`. No executable command or real tool was dispatched during those responses.
- Core engine E2E: after diagnosing inherited `adaptive.enabled=true` as an incompatibility and disabling implicit adaptive/worker/team for qualified local providers, a disposable authorized single-file `read_text` workflow reached **COMPLETED on all 3/3 consecutive runs**, with **exactly one read dispatch per run**, unchanged independently checked fixture SHA, no Work call, and no production file mutations.
- Negative readiness test with server off: engine returned `BLOCKED` with zero tool dispatch and unchanged file.
- Scoped tests on Windows: optional provider's pinned source, model, allowed tool/path, forged proposals, default-disabled runner, denied Work/Codex/cloud and inaccessible server were checked; tests are added to Core `check`, `test` and `test:update`. Hosted exact-head CI is an independent follow-up gate.
- After local evaluation, exact owned Ollama process and identified model workers were stopped; listener absent, GPU usage returned near pretest baseline.

## Product guards and caveats

- The Core remains single control plane and final action authority. The model produces a proposal only. All tool arguments, workflow revision, project root, independent file integrity check and permissions still require Commander verification.
- Optional trusted model provider is **OFF by default**; it is never auto-discovered. Explicit local autoTick, if subsequently accepted, has small call/time/action budgets, no adaptive expansion, no worker/team, and only `read_text`, `file_info`, or `list_directory`.
- The fixed source hash proves evaluated bytes, but does **not alone** establish immutable Windows ACLs, publisher authenticity, account billing, zero network egress, or OS privilege separation. Deployment must verify owner-private source permissions and local Ollama cloud-off independently.
- Quality evidence is limited to synthetic read-only fixtures and a small deterministic instruction set. It is **not** scientific/coding correctness proof, authorization for writes, sustained operation, or owner acceptance.
- Live Core stable v0.10.20 and Browser stable v0.8.1 were not modified by these tests.

## Acceptance chain still open

Hosted Windows/Linux CI and installer NoPromote on the exact updated Draft head; local model lifecycle and model identity checks after a real release installation; authenticated same-chat ACK; multi-host one-writer coordination; verified owner/ACL and no-Work account control; separately accepted gradual deployment/rollback. No automatic release or merge is authorized.

Evidence is referenced here by digest; owner-private raw model transcripts and local runtime logs are **not** committed.
