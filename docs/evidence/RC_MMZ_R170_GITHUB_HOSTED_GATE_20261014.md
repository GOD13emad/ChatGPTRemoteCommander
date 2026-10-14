# Linux R170 hosted-runner safety guard and exact PR promotion gate

**Date:** 2026-10-14, Mohammad's Ubuntu Linux only. **Scope:** one narrow failure-prevention change to prevent executing the real upgrade/rollback R170 harness on a workstation or a self-hosted/non-Linux runner. **Status:** local guard, check:qualification, security audit PASS; CI true promotion/rollback PENDING on new PR head until hosted evidence exists.

## Authority and previous accepted state
- Exact accepted source prestate: Draft PR #204 branch `feature/provider-command-adapter-20261013`, commit `fb82ba2e706fa484600d8e72d222b6d6ad2c9cab`; latest Ubuntu CI for that commit completed **success**, and Release Sync completed **success**.
- Owner host: `mmz-LOQ-15IRX9`; current installed Commander `0.10.20`, PID 5208/NRestarts 0, health HTTP200, Router file SHA256 `c1a31a6563e2842849acb21bf62c5e54b345d06f2652d4906ff8e74c9edfa744`. Full Power 97 tool schemas, runner/autoTick disabled; no user-host upgrade performed.
- Existing `test/release-rollback-linux-r170.sh` already demands CI=true, workspace/temp, no installed Commander, fresh isolated directory and unused router port. Its related `.github/workflows/release-rollback-r170.yml` runs on `ubuntu-latest` when the R170 test script changes (or on an explicit workflow_dispatch). CI=true is a generic and potentially user-settable variable, not a sufficient positive hosted-runner identity on its own.
- Official primary source: https://docs.github.com/en/actions/reference/workflows-and-actions/variables . GitHub documents `GITHUB_ACTIONS=true`, `RUNNER_OS=Linux`, and `RUNNER_ENVIRONMENT=github-hosted` for its managed Linux jobs; `self-hosted` is a different runner environment.

## Minimum sufficient mutation and verified negative regression
Only change to executable project code: prepend a fail-closed check to R170 before existing CI/path/port checks:
`[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == Linux && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]] || { echo R170_GITHUB_HOSTED_LINUX_ONLY >&2; exit 60; }`
Then preserve existing CI-only guard, using safe default expansions `CI:-`, `GITHUB_WORKSPACE:-` and `RUNNER_TEMP:-` under `set -u`. This prevents common accidental host, non-Linux, or self-hosted execution but is **not a cryptographic authentication mechanism** against malicious arbitrary environment spoofing; existing fresh-sandbox/port/owner-install gates are retained and must not be bypassed.

Exact negative cases tested **without starting real upgrade/rollback**: `GITHUB_ACTIONS=false`; `RUNNER_ENVIRONMENT=self-hosted`; `RUNNER_OS=Windows`. All 3 rejected with exit code **60** and exact guard message before side effects. `bash -n` PASS. Target script SHA256 `59dbfcb1a925806eb953b83f7437be778b06d6aef0b43ae076d12a459208fb63`.

Source qualification on same checkout: `npm run check:qualification` **PASS**, `npm run audit` **PASS** (`SECURITY_AUDIT_PASS`). Owner-private, exact qualification log `~/.local/share/rc-local-ai/evidence/rc_mmz_r170_githubhost_guard_20261014.log` SHA256 `78a4952676314b1b6a70ebd9aa27c66a6c56651b3d0d6c1a49a426c6f38b5c84`. Previous exact Linux router logic 19/19 PASS in `docs/evidence/RC_MMZ_LINUX_ROLLBACK_LOGIC_20261014.md`.

## Release critical path and acceptance rules
This intentionally substantive safety change matches R170 workflow's `pull_request.paths` filter for the **test script**. After committing the narrow guard to Draft PR #204, review the resulting hosted `Core real promotion and rollback R170 (isolated Linux)` workflow run *for exactly that PR SHA*, not unrelated CI. Accept R170 only after the fresh GitHub-hosted Linux runner completes real v0.10.20→v0.10.21→v0.10.20 promotion/rollback and provides expected PASS markers, `RETURN_R170.json` receipt plus `CLEANUP_R172.json` owned-node cleanup evidence. Failed/pending/untriggered => **UNPROVEN**; no blind rerun without root-cause audit. Do not fake environment guards or attempt R170 on a configured host.

Remaining after R170: immutable `v0.10.21` release authority currently MISSING, active Router `previous=null`, live user session/credential/durable-workflow route continuity and explicit release approval UNPROVEN. Do not upgrade active `0.10.20` or enable unattended actions until those gates are accepted.

**Brain status:** CURRENT for local safety patch and evidence; project PARTIAL_NOT_FINAL until hosted end-to-end evidence and production release gates.
