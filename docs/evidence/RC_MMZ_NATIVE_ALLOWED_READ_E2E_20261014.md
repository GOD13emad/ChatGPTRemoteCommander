# MMZ Linux — Authorized read-only native Workflow E2E (2026-10-14)

**Status: NATIVE_ALLOWED_READ_E2E_PASS / WRITING AND UNATTENDED AUTONOMY NOT ACCEPTED.**

## Previous accepted state / test objective

- Previous milestone: Linux Qwen3 4B local model and command proposal adapter, fail-closed no-authority Workflow E2E, successful source CI for previous Draft PR #204 commit dc68d0c3… and paired fixed 64-item MMLU source benchmark (Qwen3 41/64, Qwen3.5 44/64; no supported general quality advantage). Draft MMLU evidence commit fb44eb3b91f127fce88650eb5006a2c8ff9fd984 is the source baseline for this change set.
- The missing safety-critical gate was **one successful authorized read_text action through real model → command planner → workflow engine → independent verifier**. A prior BLOCKED test confirmed the negative path only.
- Scope: only Linux mmz-LOQ-15IRX9, installed stable Commander v0.10.20 unchanged, user-level Qwen3 b11588 on RTX4050, runner of installed Commander remains disabled. No real project work or source mutation dispatched by model.

## Controlled isolated method and raw evidence

- Program: examples/provider-adapter/qualify-linux-read-success.mjs, SHA256 **2b6abdce44e5f0219a8e7c1d70b521ad533786bac3f82cf849011c8cea377efd**.
- Command is explicitly gated by the exact --live flag and Linux platform; a negative call without it returned EXPLICIT_LINUX_LIVE_FLAG_REQUIRED (exit 2); Node syntax PASS.
- Creates a unique /tmp/rc-mmz-read-success-* directory, one synthetic private input file inspection.txt with fixed nonsecret text, chmod 0600, then a temporary workflow state inside that root. The file contains no real user data. Zero authorized write tools.
- Real createCommandPlanner command-mode invokes the versioned linux-local-qwen3.sh with private locally read llama.cpp bearer key and strict JSON proposal contract. The sole exposed tool is read_text and the dispatch callback fails closed unless tool=read_text AND path=inspection.txt.
- Isolated workflow runner: enabled for **this temporary root only**, autoTick=false, exactly 1 action / 1 planner call / 60s duration, no registered system-wide work or scheduler. Workflow step explicitly authorizes reading inspection.txt once. Independent acceptance verifier checks SHA256 of original file, while separate counters prove the actual tool was dispatched exactly once and the file remained identical.
- A preexisting fixture hash alone would not prove completion. The test therefore also requires first tick QUEUED with PROJECT_STEP_RECORDED, exactly one dispatch on the expected path, second tick COMPLETED, persisted run status COMPLETED and unchanged file hash.
- Actual live stdout result NATIVE_ALLOWED_READ_E2E_PASS; firstStatus QUEUED, firstCode PROJECT_STEP_RECORDED, secondStatus COMPLETED, recordedStatus COMPLETED, dispatchedTools=1, exactReadPath=true, unchangedFixture=true, finalStepStatus=verified, elapsedMs=1902 and autoTick=false. Fixture SHA256 b6d44c77a4c1c4702e39932d98d797c025384dccd4b0e6599b2fa5779dc8fb99.
- Raw transcript external on owner host: /tmp/rc_mmz_allowed_read_e2e_20261014.log SHA256 **fb4dd8cb204705e9a18ad235ca3b482d4cc681bffcc2f9745fc5ed2f84e4d50b**. No model key included in log. All temporary roots removed on exit; no residual root found.
- The verifier checks original pre-created data, not a newly generated artifact. The proven outcome is **authorized read dispatch and persisted workflow verification**, not model reasoning quality or that reading caused the independent file to exist.

## Postcheck and decision

Only the owned Qwen3 service process was stopped after checking its MainPID and executable. Confirmed ActiveState=inactive, SubState=dead, MainPID=0, UnitFileState=static, local port 18080 closed and NVIDIA memory returned to 41MiB used. Installed Commander stable and runner/automatic execution unchanged. Qwen3.5 dormant.

**Decision:** positive read-only native Workflow E2E gate PASS in isolated test, alongside previous negative BLOCKED E2E PASS. Do **not** infer approval for write_text, run_shell, broader action budgets, unattended autoTick or production-scientific claims. These remain independently open. Next critical gate is a real user-representative read-only multi-step workflow with independently audited information provenance and bounded latency, or explicit product/release review after source CI; no unnecessary extra controls/auto-installs. Keep PR #204 Draft, no merge or stable upgrade.

Reuse: Project Knowledge/Evidence, Brain/handoff, Linux owner technical guide, source CI regression and failure-prevention controls. Confidence: CONFIRMED for this exact fixture, UNPROVEN for unrestricted autonomy or complex scientific quality.

## Post-change source regression closeout

On the identical staged source and evidence, npm run check PASS, npm test PASS, npm run audit PASS, including SECURITY_AUDIT_PASS. Full raw local suite log external at /tmp/rc_mmz_read_success_qualification_20261014.log SHA256 **9f4d9eca2fba55f8770e054ef4a52c30f78a1a4e816c3317a2736945d0651a28**. Prior MMLU documentation-only HEAD fb44eb3b91f127fce88650eb5006a2c8ff9fd984 has GitHub CI, Release Sync, Windows NoPromote and Server Install Canary **completed/success**. The new opt-in live read-success test is NOT yet verified by hosted CI for its own commit; the live test needs an authorized Linux model service and therefore is intentionally not an unattended CI requirement.
