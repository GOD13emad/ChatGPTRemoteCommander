# Stream Resume Resilience Audit — 2026-10-02

Status: IN PROGRESS / code-level mitigation validated; full qualification and live rollout pending.

## User symptom

Frequent ChatGPT "Resume stream unavailable" during long Remote Commander turns. A separate Pro 200 account reportedly shows fewer/no such failures. That correlation is recorded but is not treated as proof that plan tier or response token allowance is the sole cause.

## External comparator: Desktop Commander

Desktop Commander uses a process lifecycle that decouples long work from one assistant response:
- start process and return quickly;
- keep process state persistent;
- retrieve output separately;
- page output by offset/length;
- bound buffered history and per-read output;
- optionally wait only for a short bounded interval.

This is the transferable engineering pattern.

## Remote Commander findings

CONFIRMED:
- durable operation_start/status/result and MCP Tasks already exist in the backend;
- the current ChatGPT-facing tool surface on Emad PC is stale relative to the live backend and does not expose the operation tools in this conversation;
- start_terminal already returns immediately;
- pre-v0.10.5 read_terminal returned all unread buffered output and had no paging;
- direct run_shell could return up to the configured multi-megabyte output budget;
- direct run_project_command could return 256 KiB;
- direct synchronous command guard was 15 seconds;
- MCP final response envelope allowed up to 8 MiB.

## Root cause model

The host-side Resume service cannot be repaired from Commander. The preventable Commander contribution is holding a response/tool call open too long or returning too much data, especially when the client has cached an older tool catalog and cannot use operation_start.

Root Cause -> Prevention -> Guard -> Regression:
long/large foreground MCP calls -> background handoff + paged reads -> 10s sync cap, 32KiB direct output, 32/64KiB terminal pages, <=5s wait, <=2 direct calls/turn -> targeted MCP/retry/paging/process tests.

## Implemented delta

- sync command max: 15s -> 10s;
- direct synchronous calls per turn: 3 -> 2;
- run_shell direct output cap: 32 KiB;
- run_project_command direct output cap: 32 KiB;
- read_terminal default page: 32 KiB per stream;
- read_terminal page max: 64 KiB per stream;
- read_terminal absolute paging offsets + remaining counts;
- read_terminal waitMs max: 5000;
- explicit stale-tool-catalog fallback: start_terminal -> bounded read_terminal -> BACKGROUND closeout.

## Evidence

Prestate manifest:
docs/audit/2026-10-02-stream-resume/prestate/PRESTATE_MANIFEST.json
SHA256 c66d988bddc6d2406ffaf3c0d524ac9e8dc051ff1f22a331503227dd980adbef

Targeted regression 1: 13/13 PASS.
Targeted regression 2: 31/31 PASS.

A direct synchronous invocation of the approximately 16-second test group hit the Commander synchronous transport timeout while the underlying tests were still progressing. The same group completed via start_terminal plus later read_terminal. This is direct local evidence supporting the background-handoff design.

## Remaining gates

- full repository qualification;
- source/release contract validation;
- commit and exact-tree identification;
- candidate-first live rollout;
- live behavior readback;
- Custom MCP App Refresh/Scan Tools in ChatGPT when the host surface permits it.


## R02 — qualification closure

Status: SOURCE QUALIFICATION PASS / LIVE ROLLOUT PENDING.

Additional evidence:
- check:qualification PASS with exitCode=0.
- test:qualification final run PASS with exitCode=0.
- main full batch: 489 tests, 483 pass, 0 fail, 6 platform-gated skip.
- downstream live-workflow/async/tunnel/browser/GUI/source/schema gates all PASS.
- the only first-pass full-suite failure was a stale compatibility-test expectation still calling the historical 15-second direct budget; after updating that fixture to the accepted 10-second contract, its isolated regression passed and the entire qualification passed.

The candidate is therefore ready for commit and candidate-first deployment. No live runtime mutation has occurred yet.
