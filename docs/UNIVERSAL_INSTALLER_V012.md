# v0.12 one-install engine — current QA boundary

The ONE native installer candidate remains packaging/unified: shared Electron
frontend, Windows NSIS and Linux composed DEB. The disposable
tools/universal-install/engine.mjs is its common QA source-transaction verifier,
not another public installer. The native source-preparation code validates the
shared installer/universal-install-contract.json before any staging.
Technical account profile/Tunnel identities are never rewritten.

## Evidence standard / DoD

- Common package: one immutable Git commit and exact sorted, hashed, complete
  file inventory. A Git archive must force core.autocrlf=false and core.eol=lf for Windows/Linux byte identity; this is child-process-local and does not change the user's Git config.
- Common lifecycle: install, upgrade with previous-version retention,
  verification and rollback are implemented by the same source file and
  exercised on both OSes; dangerous roots, aliases and tampering are rejected.
- Common feature declaration: JSON lists Core/Browser/Control Center/Transfer/
  Workflow/Local AI/GUI/Access components and required source files. The suite
  verification proves source-file presence only, not functional parity.
- Actual unified native candidate: packaging/unified/prepare.mjs now checks
  the same contract and required embedded Core inventory; its existing
  Electron/NSIS/DEB pipeline remains the sole public-install candidate.
- Still open: accepted native cutover, full GUI
  visual/interaction parity, Browser, J01 owner grant, authenticated ChatGPT
  account tunnel, real installed canary/cutover, exact rollback and provenance.

## Same development invocation on Windows and Linux

    node tools/universal-install/engine.mjs --contract
    node tools/universal-install/engine.mjs --package --source ABS_REPO_ROOT --output ABS_NEW_BUNDLE_DIR --expected-commit EXACT40
    node tools/universal-install/engine.mjs --verify-suite --bundle ABS_BUNDLE_DIR --expected-commit EXACT40
    node tools/universal-install/engine.mjs --qa-install --bundle ABS_BUNDLE_DIR --target ABS_OWNER_HOME/rc-universal-qa-TEST --expected-commit EXACT40
    node tools/universal-install/engine.mjs --qa-verify --target ABS_OWNER_HOME/rc-universal-qa-TEST
    node tools/universal-install/engine.mjs --qa-upgrade --bundle ABS_NEW_BUNDLE --target ABS_OWNER_HOME/rc-universal-qa-TEST --expected-commit EXACT40
    node tools/universal-install/engine.mjs --qa-rollback --target ABS_OWNER_HOME/rc-universal-qa-TEST

The mandatory npm test runner now begins with test:universal-install on both OSes.

QA ONLY until approved! The engine copies complete source into immutable
owner-local QA releases and atomically swaps owner-local active metadata.
It never replaces installed Commander Core/Browser/UI, starts native service,
alters live routing, grants Full Power, or publishes a release. Test success
is not live installation, feature parity or visual parity proof.

v0.12.0-dev.8 remains INTEGRATION_CANDIDATE_NOT_FINAL; the existing
tools/verify-v012-publish-readiness.mjs explicitly rejects unapproved
stable promotion. Historical tools/one-install in other branches is design
provenance, not a competing active installer. Next integration milestone:
both OS launchers must route to the same engine, then exact native
per-host canary/rollback and matching screen/action inventories must pass
with real owner approval before deployment.


## Exact cross-OS native Core artifact parity (automated)

The same native packaging/unified workflow now uploads its independently
prepared, source-commit-pinned source-manifest.json from each Windows and
Linux matrix build. A dependent exact-source-parity job checks every
embedded Core path and SHA-256 against the exact PR HEAD and Git tree.
A single mismatch fails the PR gate. It does NOT claim identical rendered
font pixels, identical native permissions or activated Full Power; these are
separate acceptance gates. The job does not install or promote on owner hosts.
