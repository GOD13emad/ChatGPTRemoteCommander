# v0.10.4 hosted Windows memory-budget evidence — 2026-10-01

Context: post-merge main `5511473253f9bb71922b337576c7279b88e66fee` passed Ubuntu CI but Windows qualification was unstable under hosted-runner load.

## Claim / decision
- First Windows attempt missed the existing 1-second durable-handle promptness observation; exact PR-head qualification had passed.
- One evidence-backed rerun passed that regression but then failed unrelated heavy tests with explicit `Array buffer allocation failed` and multiple `Fatal process out of memory: Zone` errors.
- Root family is therefore hosted Windows resource pressure, not a demonstrated product-semantic defect.
- Minimum sufficient control: serialize hosted Windows `node:test` file execution to concurrency 1 for both check and test CI qualification only. Keep package/install/update qualification concurrency at 2; keep Ubuntu full suites unchanged; do not weaken assertions or production timeouts.

## Local V&V
- Focused CI contract: 2/2 PASS.
- Full check: 267 tests / 265 pass / 0 fail / 2 skip.
- Full test: 508 tests / 506 pass / 0 fail / 2 skip.
- GUI contract: 77/77 PASS.
- Schema continuity: 9/9 PASS.
- Security audit: PASS.
- Combined local log SHA-256: `61c1bb9d83559dac294d620dffb50bc4d5dc19798e5559a10bda8cbd550ebabe`.

Status: LOCAL PASS / HOSTED VALIDATION OPEN. No v0.10.4 tag, publication, or live rollout until fresh Windows+Ubuntu CI on this exact change passes.

Reuse targets: Project Brain, release acceptance, hosted-runner failure prevention, future CI capacity changes.
