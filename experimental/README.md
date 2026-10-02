# Project operations source snapshot

This directory records unmerged development, not a production feature bundle.
The installed official core is v0.10.5; this draft PR remains based on the
previous companion candidate. Publication does not rebase, merge, install or
qualify integration with v0.10.5.

`project-operations-v03` contains the finite policy kernel, execution-scope
guard, durable monitor, feature service and focused tests. They have no added
MCP registration or installer wiring. Private-file verifier callbacks used by
disk tests are injected fixtures, not native Windows owner/ACL proofs.

`paused-domain-policy` preserves pure game/video admission policy and tests.
Game/video execution remains user-paused; no game, emulator, renderer or paid
provider is invoked by this snapshot.

`windows-private-files-q5/overlay` preserves the later private-create module
and changed integration files relative to PR 99. It is an incomplete overlay,
not a standalone package. DO NOT RUN its package test command, creator,
compile/native/parity/focused/full drafts or historical ONCE runners. Apply
nothing to a live installation. This overlay is syntax-checked only for
publication; native lifecycle/accounting, error preservation and file
ownership gates remain open. Existing accepted companion code is unchanged.

See `docs/PROGRESS_20261002_FA.md` and
`docs/PUBLIC_SOURCE_MANIFEST_20261002.json` for exact scope and file hashes.
Historical test results do not qualify new source or the whole product.
