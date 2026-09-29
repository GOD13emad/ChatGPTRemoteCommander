# Remote Commander v0.9.23

## Objective
Make Windows candidate-first auto-update qualification use the same bounded full-suite path already adopted by hosted Windows CI and the Windows/Linux installer/update qualification paths.

## Root cause
v0.9.22 introduced the generic `test:qualification` wrapper with Node test-file concurrency limited to 2, but `auto-update-windows.ps1` still invoked raw `npm test`. During the live v0.9.22 default-profile rollout, that unbounded gate produced one 30-second `workflow-http.test.mjs` health timeout while 482 tests passed. The exact failing file then passed 3/3 in isolation in about 2.5 seconds.

Node's official CLI documentation states that `--test-concurrency` controls the maximum number of test files executed concurrently and, with process isolation, the default is `os.availableParallelism() - 1`. Source: https://nodejs.org/dist/latest/docs/api/all.html

## Change
- Windows auto-update uses `npm run test:qualification` for candidate qualification.
- The generic qualification contract now covers `auto-update-windows.ps1` so this path cannot silently regress to raw `npm test`.
- Ordinary `npm test` remains unbounded for development and the complete local final gate.
- No production runtime semantics, functional timeouts, routing policy, or runner authorization logic are changed.

## Validation
Promotion requires the focused qualification contract, exact bounded qualification suite, complete local final gate, hosted Windows/Ubuntu CI, both server-install canaries, immutable v0.9.23 release publication, candidate-first live rollout, and final live readback of the default routed runtime.
