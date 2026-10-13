# R468 — Windows CI timing failure audit and fail-closed qualification

Status: **CANDIDATE / NOT RELEASED**. Revision objective: isolate historically timing-sensitive Windows tests from the bulk batch without changing any timeout, planner budget, production workflow behavior, UI, installer, or release route.

## Identity / Baseline

- Repository: `GOD13emad/ChatGPTRemoteCommander`; development Core 0.10.21
- Exact pre-mutation main: `a74866919a07bc7b1871efae68c05c62230937ad`
- Local isolated QA: `C:\Users\Aa.Emad\source\repos\RC_QA_R468` (no live stable install)
- Stable Core: v0.10.20; Stable CEF Browser: v0.8.1; no auto promotion
- Changed source: `tools/run-bounded-test-script.mjs`, `test/ci-test-concurrency.test.mjs` and this audit. No product runtime change.

## Historical failures (actual GitHub Actions evidence)

1. **F-R465-DELIVERY-TIME**: hosted Windows job `115261464805` in Actions run `38387097437` (PR197 earlier head). `test/project-delivery-correlation.test.mjs` expected `BLOCKED` but observed `EXHAUSTED` after approx 24.9 s, while the fixture's run `maxDurationMs` is 10000. This indicates elapsed wall clock/budget contention as a likely factor, but not proven unique cause. Do not mask legitimate production deadline `EXHAUSTED`.
2. **F-R468-TEAM-TIMEOUT**: hosted Windows job `115276389773` in Actions run `38391575106` on merged main. Test `team reserves all calls before workers and executes only the coordinator proposal` inside `test/project-adaptive.test.mjs` timed out after 6000 ms (observed 6043.7 ms). The fixture uses actual deferred coordinator/worker lifecycle; no production state mutation was inferred.
3. Previous R232 Windows lease-regression fixture was already executed as a dedicated process under `isolateWindowsLeaseRegression`. Repeated timing errors across different tests prohibit blind rerun or blanket timeout increases.

## Version-specific reference / diagnosis

- Official Node.js v22 test runner: `--test-concurrency` bounds the number of *test files* running concurrently; an individual test's `timeout` can fail if the application thread/event loop is delayed, and is not a reliable mechanism to force-cancel blocked work.
  - https://nodejs.org/download/release/v22.16.0/docs/api/test.html
  - https://nodejs.org/download/release/v22.17.0/docs/api/cli.html
- **Fact:** isolated local Windows targeted tests, same source at main, PASS:
  - Adaptive team: 190.9561 ms (timeout unchanged 6000 ms).
  - Delivery correlation: 195.1742 ms (workflow duration unchanged 10000 ms).
  - Earlier Linux targeted team: 72.357 ms, delivery correlation 45 ms.
- **Inference / Probable:** cumulative suite scheduling pressure or residual OS resource contention on hosted Windows runners, rather than deterministic failure of the state machine. Root cause remains **UNVERIFIED**.
- **Not claimed:** no general product acceptance, no proof of zero flake, no authorization to relax deadline semantics.

## One narrow change

The Windows-only qualification wrapper moves the exact two named files into separate early `node --test --test-concurrency=1` processes before bulk test execution. The existing lease/sensitive test ordering remains, all original files run **exactly once**, missing/duplicate names cause explicit FAIL, and the remaining bulk command is otherwise byte-identical.

Test: `node --test test/ci-test-concurrency.test.mjs`; contract asserts exact command rewrite, cardinality, ordering, no duplicate/skip and unchanged `timeout: 6000` / `maxDurationMs:10000`. No test fixture or production logic changes.

## Acceptance / Regression / Failure policy

1. Parser PASS + `git diff --check` PASS + dedicated concurrency regression PASS on isolated Windows source.
2. Run isolated targeted adaptive/delivery tests on Windows (recorded PASS).
3. Hosted PR exact-head Windows + Ubuntu CI SUCCESS; retained test cases must appear in logs and no expected test silently skipped.
4. Compare all changes to this three-file revision; **do not publish, install, restart GUI or modify user profiles.**
5. If the same type of hosted failure recurs after this change, **STOP patching and blind reruns**. Collect process-level timing/CPU/file I/O evidence and exact job logs, review Node v22/Windows runner event scheduling and alternate test harness before further mutation. Mark `UNRESOLVED—EXTERNAL EVIDENCE INSUFFICIENT` when precise cause cannot be established.

This audit and its source hashes belong in next cumulative Project Brain; previous R466 and deployed stable installations remain unchanged until explicit verified promotion.
