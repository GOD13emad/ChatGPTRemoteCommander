# Remote Commander v0.10.6

Date: 2026-10-02

## Release objective

Promote the stable, evidence-backed Saeid development line on top of official v0.10.5 without shipping blocked experimental components as runtime authority.

## Production delta

- Preserve all v0.10.5 stream-resume hardening.
- Add synchronous child-lifecycle capture to the detached operation worker so exit/close/error state is recorded before awaited persistence can race it.
- Add the dedicated operation-child-lifecycle regression to the default test suite and syntax gate.
- Advance installer, plugin-template, server and release identity to v0.10.6.

## Versioned experimental snapshots

The release tree also carries reviewable, non-runtime source under `experimental/`:
- `project-operations-v03`: bounded project policy/monitor source.
- `paused-domain-policy`: game/video remain user-paused.
- `windows-private-files-q5/overlay`: STOP / DO NOT RUN until native Windows private-file qualification is complete.
- `owned-browser-r3`: accepted Saeid headless fixture/graceful-close component snapshot. It is not wired into the production browser control path.

These snapshots are versioned for audit and continuation but do not grant automatic execution, chat continuation, foreground control or production acceptance.

## Acceptance gates

Release is accepted only if the exact v0.10.6 tree passes:
1. package/parser/static checks;
2. operation-child-lifecycle targeted regression;
3. default Windows qualification and security audit;
4. installer/release-asset contracts;
5. hosted Windows and Ubuntu CI;
6. server-install canaries;
7. immutable tag/release readback.

Any failing gate keeps the release candidate unpromoted.

## Rollback

Official v0.10.5 at commit `d6912c750640ca57a67be4a9cc8e6485653eb36c` remains the rollback baseline until v0.10.6 is published and downstream update/readback succeeds.
