# MMZ Linux — Qwen3 4B reasoning-mode benchmark (2026-10-14)

Status: **MEASURED / SCIENTIFIC-QUALITY GATE NOT ACCEPTED / NOT RELEASED**.

## Baseline and source authority

- Project: Remote Commander Linux-only Qwen3 4B supplementary model; mmz-LOQ-15IRX9, Ubuntu 26.04.1, NVIDIA RTX 4050 6 GB. Stable installed Commander v0.10.20 remains unchanged, automatic runner disabled, model user-unit on-demand only.
- Draft GitHub PR #204 at commit 897479d595bb7c211805c53046fef12edf49613f. Exact-commit GitHub Actions CI (Windows + Ubuntu), Release Sync, Server Install Canary, and Windows isolated updater NoPromote R157 all COMPLETED SUCCESS. Source-quality verification != model-output validation.
- Model: original official Qwen3-4B-Q4_K_M GGUF with pinned SHA in RC_MMZ_LINUX_LOCAL_AI_20261013.md; inference through authenticated local llama.cpp b11588 Vulkan and 127.0.0.1:18080. No model-generated code was executed, no external requests, no project-private prompts or tools provided.

## Evidence-first evaluation choices

- Evaluation-harness reference: https://github.com/EleutherAI/lm-evaluation-harness ; fixed benchmark tasks, configuration and sample logging enable replication. Our 12-case fixture is owner-defined synthetic screening, NOT a recognized external benchmark.
- Official Qwen reference: https://github.com/QwenLM/Qwen3/blob/main/docs/source/getting_started/quickstart.md ; the Qwen3 4B supports /think and /no_think with different recommended sampling settings.
- Hugging Face evaluation warning: https://github.com/huggingface/evaluate/blob/main/metrics/code_eval/code_eval.py ; generated code must run in sandbox, hence this benchmark graded code *reasoning* only using predeclared answers, without executing model-generated code.

Twelve predeclared questions: five code-semantics/SQL/complexity, six statistics/science, one instruction-safety; Persian and English mixed, zero real user project data. Both modes used exactly the same tasks with one response per task, no retries, response_format=json_object, expected field names answer/explanation, predeclared exact/numeric grading. The generation configurations differ in more than one parameter; no causal attribution is valid.

| Measured item | Fast /no_think | /think with official sampling |
|---|---:|---:|
| Temperature | 0 | 0.6 |
| Top_p / top_k | engine defaults | 0.95 / 20 |
| Max output tokens | 280 | 1024 |
| Correct strict responses | **7 of 12** | **9 of 12** |
| Coding | 4 of 5 | 5 of 5 |
| Scientific/statistical | **2 of 6** | **3 of 6** |
| One safety case | 1 of 1 | 1 of 1 |
| Median warmed response time | **1.984 sec** | **8.6815 sec** |

Thinking median was 4.38x slower on this small fixed set. This does NOT prove higher general accuracy, security, scientific reliability, or cold-start/throughput superiority.

### Failure taxonomy

- Fast model wrong: Python late-binding (0,0,0 vs expected 2,2,2), Bayes PPV (60.0 vs 15.38 percent), confidence interval returned placeholder instead of 90.2,109.8; Simpson answer no instead of yes; data leakage answered no rather than yes.
- Thinking model fixed late binding, confidence interval and leakage but Bayes PPV still wrong (1538 rather than 15.38). Bonferroni and Simpson consumed full token budget: finish_reason=length and invalid JSON, both operational FAIL. No blind retries.
- Independent PPV reference: numerator 0.01 * 0.90 = 0.009; false positive contribution 0.99*0.05 = 0.0495; PPV = 0.009 / 0.0585 = 15.38 percent. Other numeric expected values and Simpson aggregate were validated with fixed assertions before calls.
- Under strict JSON model contract, max-token truncations must fail closed; a confident-sounding model answer is not evidence. Science errors require independent calculation/authoritative literature validation. No auto-promotion or automatic file mutations are warranted.
- Limitations: 12 easy/synthetic hand-authored cases, no independent sample replication, mixed languages, changed sampling and output budget, warmed model, hardware-specific GPU latency, one safety prompt cannot establish robustness.

## Provenance: owner-private files external to Git

All under ~/.local/share/rc-local-ai/evidence/ on MMZ Linux:
- benchmark_qwen3_4b_reasoning_v2_20261014.py SHA256 a69c20e2cef9100fe8875d22055745e154708cc7490dec274c5d4306a3e14a6b
- qwen3_4b_reasoning_v2_20261014.json SHA256 e028f7816dc2eea9f76fa826fa4470d875393e0c80acdb06a119b3efc9710d9c
- benchmark_qwen3_4b_think_v2_20261014.py SHA256 c2b7837ca310850eeba304db8535af26360fee78dc7ecb76570ed44cb97d525e
- qwen3_4b_thinking_v2_20261014.json SHA256 d316d449b2a3e5a4bedfa56a86bb8272dd861c886ff0337514899c2751f1bd38

These are explicitly EXTERNAL, not embedded in Git or falsely presented as transferable attachments. No credential was logged/published. Before service stop: verified exact user-owned llama-server MainPID/executable. After stop: ActiveState=inactive, SubState=dead, MainPID=0, UnitFileState=static; TCP 18080 closed and used GPU memory returned to 41 MiB. Stable Core and runner unaffected.

## Project decisions, gates, next action

- Completed: optional local GPU runtime and model hash, safe private user-unit, authenticated endpoint, CLI and native planner/workflow blocked-case E2E, source CI for current commit 4 of 4 success, 12-task two-mode diagnostic recorded.
- CURRENT: science/coding QUALITY GATE **NOT ACCEPTED** for autonomous decision-making. Allow only supplementary low-risk drafting and read-only proposals with deterministic verification; never substitute local Qwen for an authoritative auditor.
- Deferred: additional multi-GB model install without resource/evidence justification, production runner enrollment, autoTick, stable release and merge of PR #204.
- Next exact action: evaluate a stronger model or a recognized benchmark with meaningful sample size and independently reproducible scoring, versus latency/VRAM and quality requirements. New mutation objective only; keep draft PR and stable baseline. No overall completion percentage inferred.
