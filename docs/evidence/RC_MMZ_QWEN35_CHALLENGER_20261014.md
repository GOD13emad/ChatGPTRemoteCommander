# MMZ Linux — Qwen3.5-4B challenger verification and comparison, 2026-10-14

**Status: HASHED ARTIFACT PASS / GPU LOAD PASS / NON-THINKING CONTRACT PASS / MODEL QUALITY NOT ACCEPTED / NO PROMOTION.**

## Change objective, baseline, authority

One bounded objective: check whether a stronger local 4B family model is safe and materially better than current Qwen3-4B on the owner's Ubuntu 26.04.1 / NVIDIA RTX 4050 6 GB. Keep existing installed Commander v0.10.20, local Qwen3 4B model, agent extensions, browser profiles and disabled runner untouched. Source branch for optional adapter remains Draft PR #204. No autoTick, stable promotion, third-party cloud egress or model-generated code execution.

Published upstream base model: https://huggingface.co/Qwen/Qwen3.5-4B (Qwen/Qwen3.5-4B, revision 851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a, Apache-2.0, not gated).
Community quantization source: https://huggingface.co/SoAIHQ/Qwen3.5-4B-GGUF (revision 0c82e2f4c9582ecd5f49c0f02a21b4d60c4ad603), Qwen3.5-4B-Q4_K_M.gguf, exactly **2,783,447,136 bytes**, expected SHA-256 **2ebe6eb67cb92adeffc7073c48dd4e3baf79465ac650793dc751cad2b29cf219**. Community GGUF is not an official Qwen binary; source and conversion/trust levels are distinguished.

## Actual mutation and deterministic checks

- Read-only preflight: new target absent, ~160 GB free disk, prior user model unit inactive, ~5733 MiB GPU memory free, pinned Hugging Face revision HEAD 200 and range GET 206.
- One-run 16-range downloader in private user evidence path, every Content-Range and segment length verified, whole-file hash and length verified **PASS** after **179.1 seconds**. No partial files promoted and segment temp directory removed. Final private 0600 file: ~/.local/share/rc-local-ai/models/Qwen3.5-4B-Q4_K_M.gguf. Existing Qwen3-4B-Q4_K_M.gguf was preserved.
- Ran pinned llama.cpp b11588 Vulkan binary against the model in a transient user systemd unit with loopback-only port 18081, private bearer API-key file, RuntimeMaxSec=300 and no autoenable. Model loaded into NVIDIA Vulkan1 at approximately 2.6–2.85GB allocated. Authenticated health HTTP 200. Loader logged unused tensors from a next-token prediction auxiliary layer; functional compatibility is supported by load/generation, but detailed treatment of all model tensors remains **UNVERIFIED**.

## Root cause and prevention: Qwen3.5 is NOT the Qwen3 prompt contract

An initial *configuration-incompatible* 12-task run had **0/12 schema-valid** responses using old Qwen3 text instruction /no_think. This must not be interpreted as model quality. Official Qwen3.5 model card explicitly states Qwen3.5 **does not support** Qwen3's soft switch /think /nothink. Primary reference: https://huggingface.co/Qwen/Qwen3.5-4B/blob/main/README.md. llama.cpp recognizes server flag --reasoning off. See upstream discussion https://github.com/ggml-org/llama.cpp/discussions/23351 on server-level controls. The no-think textual prompt was preserved in comparative task fixture for consistency but could not enforce the switch.

Root cause → guard → regression:
- Rejected old assumption that the Qwen3 soft switch applies to Qwen3.5. Do not blindly rerun/prompt-patch after repeated invalid JSON.
- Restarted a **different, separately capped transient service** using native --reasoning off on port 18082; after model loaded, a new synthetic JSON smoke call returned HTTP 200 / finish_reason=stop / exact two string keys (answer, explanation). This establishes the service JSON contract but not inference quality.
- Identical 12-task fixture was then run once against that native off mode, using unchanged scoring and prompts. Harness copied from baseline with only output path, URL, model alias and benchmark ID modified; exact diff inspected.

## Fixed screening: evidence and interpretation

| Result | Existing Qwen3 4B fast | Qwen3 4B thinking | Qwen3.5 4B native reasoning OFF |
|---|---:|---:|---:|
| Strict valid/correct answers | **7/12** | **9/12** | **5/12** |
| Code | 4/5 | 5/5 | **2/5** |
| Science/statistics | 2/6 | 3/6 | **2/6** |
| One safety case | 1/1 | 1/1 | 1/1 |
| Warm median latency | 1.984 s | 8.6815 s | **2.447 s** |

The old Qwen3 benchmark and Qwen3.5-off benchmark have the same fixed 12 hand-authored prompts, expected answers, numeric tolerance, temperature=0 and max_tokens=280, with no retries; service-level native reasoning flags differ because Qwen model generations use different chat templates. The 12-case result is an **owner-defined screening**, NOT a standard academic benchmark, model-wide accuracy claim, causal estimate or statistically significant superiority test.

New model specific failures include mutable Python default argument, Python closure late binding, loop-complexity, numeric standard error (0.316 instead of 2), approximate confidence interval (95.04/104.96 instead of 90.2/109.8), Simpson paradox and a non-JSON Bayes PPV answer. No real project changes/tools were exposed. One easy instruction-safety prompt is insufficient to validate adversarial resistance. A Qwen3.5 thinking-mode run was NOT performed; do not infer model-wide ranking from this one non-thinking setup.

### Evidence file registry (owner-private/external)

All listed artifacts reside under ~/.local/share/rc-local-ai/evidence/ (not embedded in repository):
- Source exact one-run downloader: download_qwen35_4b_once_20261014.py SHA-256 436d2a4d75d7f412fd82934337237d732e64858fbc40442b64d8b4ea4ae72a34.
- Initial incompatible fixture program: benchmark_qwen35_4b_reasoning_v2_20261014.py SHA-256 d1d8af1c234a7e802a99692164b91914e47165177b86f21569f004b34c55fa26; result qwen35_4b_reasoning_v2_20261014.json SHA-256 b89272143bed0446af1418b57af67912e24690fbfffcc7c35606bf8fb2002ad6. This is a **configuration FAIL** only.
- Corrected native-off fixture program: benchmark_qwen35_4b_off_v2_20261014.py SHA-256 d1992a7cb167a680f74caf7da1879e0e5e033e149298d5a22f3294326ea1782f; result qwen35_4b_reasoning_off_v2_20261014.json SHA-256 83e2fceeda83b6556487f0a6ccecfe9292b4ca46ca18b3dadf46b4692940c56e.
- Reference results and hashes: docs/evidence/RC_MMZ_QWEN3_REASONING_BENCH_20261014.md.
- Model GGUF SHA-256 itself **2ebe6eb67cb92adeffc7073c48dd4e3baf79465ac650793dc751cad2b29cf219**. File 0600, private Linux user root, no unverified artifacts promoted.

## Poststate, risk, roadmap

Both temporary Qwen3.5 systemd user units were explicitly stopped after verifying their exact owner process and executable; no permanent Qwen3.5 unit was installed. Loopback 18081/18082 closed, old Qwen3 unit inactive/static with port18080 closed, GPU returned to idle ~41 MiB. Installed Commander/runner remained stable and disabled. Qwen3.5 GGUF retained as **DORMANT CANDIDATE**, not selected as a default or an automatic workflow reviewer.

**Decision:** preserve the already verified Qwen3 4B on-demand proposal-only setup; reject auto promotion of Qwen3.5 based on this evidence. Do not treat 5/12 as inherent universal inferiority of Qwen3.5. Full-context/comparison/official-task benchmark and compatible thinking-mode evaluation remain OPEN if a future justified change set targets them. Given limited source benchmarks, prioritize independently grounded evidence over adding layers of automated enforcement.

**Roadmap ← CURRENT:** source CI/adapter accepted at local and hosted level for prior exact commit; local Qwen3 baseline measured; new Qwen3.5 artifact and hardware load PASS; Qwen3.5 schema-mode issue root-caused; Qwen3.5-off 12-case model-output gate **NOT ACCEPTED**. Next exact action is owner-approved model-selection V&V using recognized benchmark/tasks and separate review of task accuracy/latency/VRAM; avoid blind repetitions. No release and no percentage inferred. Brain status CURRENT evidence, global FINAL remains OPEN.
