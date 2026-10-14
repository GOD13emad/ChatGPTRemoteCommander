# Provider command adapter — evidence and handoff (2026-10-13)

Status: **SOURCE CANDIDATE / LOCAL TESTS PASS / LIVE PROVIDERS MISSING / NOT FINAL**.
Project: Remote Commander Core (not Direct Internet Method).
Final objective: add optional proposal-only planning via local Ollama or external OpenRouter without changing stable installed routes, expanding Commander tool authority, silently delegating to Codex, or bypassing independent acceptance.
DoD for a *source candidate*: a pinned-source isolated branch; deterministic RED→GREEN provider tests; full check/test/security audit; exact diff check; evidence and Brain handoff. Production DoD additionally requires Emad development-host review, live model qualification with consent/budget, cross-platform CI, and explicit promotion.

## Previous accepted state → Current delta

- Published stable Core remains immutable **v0.10.20** (release tag target `362375c464948be3001b307650c13fc3353ed05b`); Browser remains separately released v0.8.1. Reference: `docs/RELEASE_AUTHORITY.md`, read 2026-10-13. GitHub `main` at branch creation was development `e3fe4e3e22679ebdae346612f6e20d9879661b36` with package version 0.10.21; development is **not** stable.
- Linux MMZ active Commander `0.10.20`; configured Project Engine present, runnerConfigured=false, automaticExecution=false. This observation applies only to MMZ host; Emad hosts are **NOT VERIFIED** in this change set.
- Original local hotfix checkout a previous detached hotfix checkout (private host path not stored in public source) is dirty and detached. Left untouched.
- Isolated candidate root: an isolated checkout named `RC_PROVIDER_ADAPTER_DEV_20261013` (private host root excluded), branch `feature/provider-command-adapter-20261013` (created from exact main SHA above). Not installed, not launched as a service, not promoted.
- Main mutation objective: a reusable, external `kind=command` adapter at `examples/provider-adapter/adapter.mjs` and its tests at `test/provider-command-adapter.test.mjs`. `package.json` integrates the new test into ordinary `check` and `test` commands. Core planner, engine, scheduler, permissions and live configuration are unchanged.

## Method and rationale

**Official, primary references:**
- Remote Commander current `src/project-planner.mjs` and `docs/PROJECT_ENGINE.md`: command planner takes bounded JSON context on stdin and returns exactly one validated proposal via stdout; execution/acceptance remain independent.
- Ollama official compatibility: https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx — subset of OpenAI-compatible chat completions, local `127.0.0.1:11434`.
- OpenRouter official quickstart: https://github.com/OpenRouterTeam/docs/blob/main/quickstart.mdx — OpenAI-style chat completions endpoint, provider-dependent model capabilities.

**Chosen simplest design:** reuse the existing opt-in command-provider contract rather than introduce a new executor, scheduler, credential manager, agent framework or router dependency. Fixed provider allowlist: `ollama` → `http://127.0.0.1:11434/v1/chat/completions`, `openrouter` → `https://openrouter.ai/api/v1/chat/completions`. No arbitrary endpoint input or automatic fallback. Node built-in `fetch`, no new package dependencies.

**Safety controls:** explicit `RC_MODEL_PROVIDER` and `RC_MODEL_NAME`; OpenRouter additionally requires `RC_ALLOW_EXTERNAL_CONTEXT=yes`, API key from `OPENROUTER_API_KEY`, and defaults to `:free` models unless `RC_ALLOW_PAID_MODEL=yes`; fixed 12-second request timeout, no redirects, bounded 512 KiB input / 256 KiB response; strict four-field proposal validation; no provider response/error/context/key logging; fail-closed network/model errors; no model-output tool execution in adapter. Existing Commander engine independently enforces permitted tools, revisions and final acceptance.

**Rejected options:** modifying Commander Core's provider dispatch (unnecessary and higher regression risk); silent addition of cloud inference to active service (privacy/charge risk); implementing multi-model dynamic fallback before measured benchmarks (complexity without evidence).

## Reproducible evidence

- Prior main baseline, before candidate mutation: `node --test test/project-planner.test.mjs test/project-runner-config.test.mjs` → **32 PASS / 0 FAIL**.
- RED: `node --test test/provider-command-adapter.test.mjs` initially failed because adapter module did not yet exist, confirming the intended missing implementation.
- Initial GREEN: new deterministic adapter test suite → **8 PASS / 0 FAIL**.
- Incremental RED: paid OpenRouter model test failed with `Missing expected rejection`. Added default-deny cost policy.
- Incremental GREEN: `node --test test/provider-command-adapter.test.mjs test/project-planner.test.mjs test/project-runner-config.test.mjs` → **41 PASS / 0 FAIL**.
- Full source qualification *before the package script integration*: `npm run check` PASS, `npm test` PASS, `npm run audit` PASS (`SECURITY_AUDIT_PASS`); log at `/tmp/rc_provider_adapter_20261013_qualify.log`. The post-package integration full qualification and fresh diff/audit remain to be recorded below.
- Direct MMZ environment read-only probe: Ollama binary **NOT_INSTALLED**, port 11434 **NOT_LISTENING**, OpenRouter key **NOT_IN_THIS_SHELL**; no live provider call was attempted. Other profiles' credentials are not inferred.

## Open gates and next action

1. Re-run full check/test/audit after integrating the test into package scripts, and inspect exact diff/hash. Mark PASS only after observed outputs.
2. Publish **development feature branch/draft PR only** after verified qualification and account/branch authority; do not release or deploy to MMZ/Emad systems.
3. Emad development system: independently inspect candidate and run Node/Windows native qualification. Do not overwrite a dirty checkout.
4. Live Ollama or OpenRouter trial only when owner-authorized credentials/target model and egress budget are present. Keep `runner.enabled=false`, `autoTick=false` until operational gate.
5. Once qualified, evaluate quality, latency, failure modes and cost under equal benchmark tasks before considering second provider rollout or promotion.

### Model metadata and provenance

Date 2026-10-13, status **Confirmed** for source metadata/test receipts above and **Missing/Unverified** for live/Windows/CI/rollout. Source locations and SHA-256 of modified files shall be pinned at final gate. Reuse targets: code review, CI acceptance, provider documentation, Project Brain/handoff, article/methodology (evidence-first optional adapter). Never treat deterministic fixture tests as model quality validation.


## 2026-10-13 — post-change verification addendum (authoritative for this candidate)

- Targeted final regression `node --test test/provider-command-adapter.test.mjs test/project-planner.test.mjs test/project-runner-config.test.mjs`: **42 PASS / 0 FAIL**. This includes an additional RED→GREEN control requiring `max_tokens=1024` in requests (limits requested generation length, not a provider billing guarantee).
- Exact post-package-integration commands `npm run check`, `npm test`, and `npm run audit`: **PASS / PASS / PASS**, process exit 0, including `SECURITY_AUDIT_PASS`; isolated CI-like local log SHA-256 `43adb4d5da2cece07297c0017026aa257c21c82d78d1e643e354022371c29229` at `/tmp/rc_provider_adapter_20261013_final_qualify.log`.
- Runtime-disabled CLI smoke: stdin `{}`, both model variables unset → exit code 1 and sole error `ADAPTER_PROVIDER_DISABLED`, no provider call.
- Candidate SHA-256: `examples/provider-adapter/adapter.mjs` = `c360a949830e7cde051009ed2d588403cb033c95be172ee2b4ffb1af7204e5cf`; `test/provider-command-adapter.test.mjs` = `df82494bc44b6bc765ade8aa2742db61dc09c9c5a272e8f1261009178c274ebf`; `package.json` = `e972c9f84abb370f826bd944dccce7060dfee460f87aeac1790adf90c614be08`.
- These PASS claims are strictly **local source qualification**, not model quality, Windows Emad native acceptance, authenticated cloud inference, hosted CI, release, or installed-product qualification. Those gates remain **UNPROVEN/OPEN**.
