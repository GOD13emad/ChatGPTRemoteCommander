# ChatGPT Remote Commander v0.9.22

## Scope

v0.9.22 is a focused Windows updater configuration-authority hotfix. It preserves explicit owner configuration across candidate-first upgrades without weakening route-based rollback, drain protection, runtime isolation, or default-deny model-provider policy.

## Root cause

The Windows updater selected the currently routed runtime config before the canonical owner config. Runtime configs are generated deployment artifacts. A runner state disabled by an earlier release could therefore become the input to the next migration even when the persistent Full-Power owner configuration still explicitly authorized a valid external Codex runner.

## Change

- The canonical local owner config is the default-profile migration authority when present.
- A named profile's recorded canonical config is its migration authority when present.
- The active routed runtime config remains a fallback only when the canonical config is missing.
- Candidate-first validation, exact-commit verification, drain protection, rollback, and route switching are unchanged.
- No automatic Codex discovery or Commander-private Codex installation is introduced; explicit owner authorization and executable validation remain mandatory.

## Acceptance

Promotion requires the focused updater/runner regressions, the full local release gate, hosted Windows and Ubuntu CI, Windows Server and clean-Ubuntu install canaries, exact-commit deployment, and live readback showing the configured runner is preserved. Elapsed soak remains a separate evidence gate.
