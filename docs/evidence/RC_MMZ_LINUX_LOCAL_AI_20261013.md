# Linux MMZ: opt-in local AI provider — 2026-10-13

Status: **SOURCE/LAUNCHER CANDIDATE**. This is not an installed Ollama runtime, loaded model, or active Commander provider.

## Host baseline (fresh Remote Commander read-only probe)

- Device: mmz-LOQ-15IRX9, Ubuntu 26.04.1 LTS x86_64; Intel i7-13650HX; 16 GB RAM.
- NVIDIA RTX 4050 Laptop GPU, 6141 MiB VRAM, driver 595.99.02, libcuda.so.1 available. GPU availability is **not** model-inference acceptance.
- 163 GB free disk at audit; approx. 6.0 GiB memory available; available memory may change.
- Remote Commander v0.10.20, runnerConfigured=false, automaticExecution=false. Core immutable v0.10.20 remains the published stable baseline.
- 10 current valid Agent Extensions (several Linux-specialized). Existing `linux-research-computing/SKILL.md` still contains a cached Ubuntu 24.04.5 2026-10-03 profile; live 26.04.1 readback supersedes it for OS version.
- Ollama binary absent; localhost port 11434 not listening. OpenRouter API key not present in Commander shell. No secrets inspected or created.

## Provider contract: minimal and Linux-only

The executable `examples/provider-adapter/linux-local-qwen3.sh` pins `RC_MODEL_PROVIDER=ollama` and `RC_MODEL_NAME=rc-qwen3-4b:q4km`; it invokes adjacent `adapter.mjs` via /usr/bin/node.
The Core/Project Engine config is **not** modified. The wrapper neither installs runtimes nor starts/stops services; it is activated only when a trusted operator explicitly chooses the existing `kind=command` runner and opts into per-project execution. All proposals must pass Core independent guards and acceptance.

Default model choice: **Qwen3 4B Q4_K_M** for 6 GB VRAM; source `Qwen/Qwen3-4B-GGUF` (Apache-2.0). Official Hugging Face file:
`Qwen3-4B-Q4_K_M.gguf` / exactly **2,497,280,256 bytes** / SHA-256
`7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`.
Hugging Face model listing/API and 1 MiB HTTP range returned 200/206 respectively on this host, but **full model artifact is not downloaded or validated**.

Official Ollama stable release observed from GitHub API on 2026-10-13: `v0.40.3`, published 2026-10-11. x86_64 tar.zst size **1,437,349,190 bytes**, SHA-256
`ce6f8b671a699bf1ebafb28d60dbbabf4f37b30b499145fa308a8ba72de021d6`.
This is a candidate for a *user-local* install, not a request for sudo, a system-wide service, or an unaudited curl-to-shell installation.

## Network facts and decision

- `registry.ollama.ai/v2/library/qwen3/manifests/4b`: timeout (HTTP 000) on this host; `ollama.com/library/qwen3:4b`: HTTP 403.
- `huggingface.co/api/models/Qwen/Qwen3-4B`: HTTP 200; official GGUF HEAD HTTP 200; single range byte request returned HTTP 206.
- `openrouter.ai/api/v1/models`: HTTP 200, but no key in environment; endpoint reachability ≠ authorized inference.
- Both official release and GGUF ranged samples measured ~0.5 MB/s on this route. Combined pinned archives exceed 3.9 GB; completing authenticated, hash-verified local installation is therefore **not an accepted gate today**. Avoid pretending download, install and GPU generation passed.

## Reproducible eventual install sequence — NOT EXECUTED

1. Verify free disk/RAM/GPU and current version/sha from official GitHub release API. Reserve dedicated user-owned `$HOME/.local/opt/ollama/v0.40.3` and `$HOME/.local/share/rc-ollama-qwen3`. Keep downloads as incomplete until hashes match. Do not overwrite existing service binaries.
2. Download official `ollama-linux-amd64.tar.zst` from `https://github.com/ollama/ollama/releases/download/v0.40.3/ollama-linux-amd64.tar.zst`, verify exact byte count/SHA-256 above, extract into versioned user-local directory, not `/usr`, `/usr/local`, or an existing Ollama install.
3. Download from `https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf` into private user-local model directory. Verify pinned file SHA and size. Rejected/mismatched/partial downloads are **never** promoted to the final model filename.
4. Create a private Modelfile with `FROM` pointing to verified local GGUF; select an initial 2048-context profile to keep VRAM use bounded. Start Ollama **manually** on `127.0.0.1:11434`, with auto-update/autostart disabled. Do not bind 0.0.0.0. Use `ollama create rc-qwen3-4b:q4km -f <verified Modelfile>`.
5. Test `/api/tags`, exact local model, CUDA/GPU offload, Persian and English proposal schema; obtain latency, GPU utilization, memory, context length and failure evidence. Then test the independent Commander command proposal flow in a temporary isolated workflow. Do not enable `runner.autoTick`, scheduler or execute arbitrary tool calls by inference.
6. On failure: preserve baseline and logs, stop candidate only, keep stable Commander v0.10.20 and all existing browser profiles unchanged. Do not blind-retry.

## Acceptance / open gates

- **Confirmed:** source controller v0.10.20 working, installed 10 valid Linux skills, GitHub develop candidate, user hardware, endpoints behavior and exact upstream artifact metadata.
- **Candidate:** Linux command wrapper; static shell syntax and pinning tests, alongside previous adapter tests.
- **Missing:** downloaded binary/model, SHA-verified user-local runtime, GPU inference, model-quality benchmarks, owner-approved runtime start/installed service activation.
- **Critical path:** access/download window → exact checksum validation → user-local runtime → actual inference → bounded Commander integration test → evidence/Brain promotion.
- **DoD:** local Qwen correctly returns a constrained proposal, source verification is reproducible, no unauthorized cloud egress/tool execution, stable service unaffected. Until then **NOT FINAL**.

Sources: https://github.com/ollama/ollama/releases/tag/v0.40.3 ; https://github.com/ollama/ollama/blob/main/docs/linux.mdx ; https://huggingface.co/Qwen/Qwen3-4B-GGUF ; https://docs.ollama.com/api/openai-compatibility .


## Verified continuation, 2026-10-13 (supersedes above model/runtime MISSING lines)

**Current decision:** choose official `llama.cpp b11588` prebuilt Ubuntu x64 Vulkan as the *working local runtime* instead of installing the significantly larger Ollama package. Official archive SHA `96e9fef5c8881221baddd5737d3f4e598e0d35bc93179426fe8c962df08ebb4e`, 30,338,773 B. `llama-server --version` and Vulkan device inventory PASS (Intel Vulkan0, NVIDIA RTX 4050 Vulkan1). User-local runtime is versioned; no system-wide install.
**Qwen source:** official Qwen/Qwen3-4B-GGUF Q4_K_M full file 2,497,280,256 bytes; exact SHA `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` verified after 16 ranged parts and reassembly. User-local GGUF file mode 0600. Approx. 2809 MiB of NVIDIA GPU memory used during model loading vs 41 MiB idle. This establishes actual Vulkan model load, not numerical quality superiority.
**API security:** User-local on-demand `systemd --user` unit `rc-local-qwen3.service` uses fixed 127.0.0.1:18080, disables WebUI, restricts CORS to localhost, requires a private user-key file (mode 0600), and checks pinned model checksum before startup. Auth probe: no key HTTP 401; authenticated HTTP 200. No key value is in this repository. Unit is **static/inactive**, not enabled at login/boot. Confirmed start/readiness/stop and after-stop port closed, MainPID=0 and GPU memory idle.
**Real inference V&V:** English and Persian test contexts produced valid four-field proposal JSON through the command-launcher using the **real 4B model**, `action=block`, empty executable tool, zero tool dispatch. Provider endpoint `llamacpp` explicitly fixed to localhost and independently tested fail-closed. A model-echo privacy issue in `block.argumentsJson` was reproduced RED and prevented by normalization to `{}`; controlled regression GREEN. This does not validate model coding/scientific accuracy.
**Failure prevention:** Stopping a transient test terminal left a known child process and listener alive; ownership/PGID/executable were verified before bounded group termination. The user-scoped systemd unit replaces terminal-owned lifecycle; start/stop regression PASS.
**Source qualification:** Final isolated Linux-focused 47/47 scoped tests PASS; `npm run check`, `npm test`, `npm run audit` all PASS, security audit PASS. Raw full-suite log SHA-256 `bbb0756508d9580508ce80640d02819069f532c81f8ccedcc5c031215711c3fc`. Modified source hashes: adapter `0c3a6f84423ae2ba94ddd448cad9bb194cc7a738972110a638536cbd83ce4d7f`; launcher `ae0fc4374a2ccbddff047decee9ed3b04f98ff2a2df8fbf6d2c283df892c38a3`; adapter tests `e604e2a69361ad7f803bc43b2965359376d2d5c026ab448545a4a1c6fdafc06c`; Linux launcher tests `5accdac881c94b062fb177ce438f8e39bfab4a832629b3c65665416742490c43`.
**Open:** native Commander Project Engine opt-in and independent workflow finalization, hosted PR CI for this exact follow-up, equal-task benchmarking, project privacy/decision validation and release. Stable installed Core remains v0.10.20 and runner disabled. Local host-specific evidence lives EXTERNAL to GitHub in user-owned private `rc-local-ai/evidence/`.
