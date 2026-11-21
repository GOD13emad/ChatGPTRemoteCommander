# v0.12 one-install engine — current QA boundary

This is the unified Windows/Linux source-package and rollback engine in
tools/universal-install/engine.mjs. Both operating systems execute the same
Node.js module and installer/universal-install-contract.json. Platform adapters
are confined to native prerequisites, service management, and GUI rendering;
technical account profile/Tunnel identities are never rewritten.

## Evidence standard / DoD

- Common package: one immutable Git commit and exact sorted, hashed, complete
  file inventory. A Git archive must force core.autocrlf=false and core.eol=lf for Windows/Linux byte identity; this is child-process-local and does not change the user's Git config.
- Common lifecycle: install, upgrade with previous-version retention,
  verification and rollback are implemented by the same source file and
  exercised on both OSes; dangerous roots, aliases and tampering are rejected.
- Common feature declaration: JSON lists Core/Browser/Control Center/Transfer/
  Workflow/Local AI/GUI/Access components and required source files. The suite
  verification proves source-file presence only, not functional parity.
- Still open: bootstrapped native launcher, native services, full GUI
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
