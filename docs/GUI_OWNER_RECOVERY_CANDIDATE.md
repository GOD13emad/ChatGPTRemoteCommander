# Windows GUI owner-review recovery candidate

Base: official Core 0.10.25. This source candidate is not an accepted native GUI
release and does not itself authorize deployment or desktop input.

An unresolved native click previously blocked every subsequent GUI request,
including observation, permanently across restarts. A restart does not prove
the click's result. Never delete or rename the original intent to reset it.

This candidate adds an explicit owner-local review transition. Until a valid
review exists, the original fail-closed behavior remains. The physical owner
must review the current desktop, confirm normal manual control and acknowledge
that the historical outcome remains UNKNOWN and must never be replayed.

`tools/gui-owner-recovery.ps1` has a read-only `-Report` mode and an interactive
owner form. There is no unattended approval flag, remote reset tool, countdown
or automatic expiry. Its button remains disabled if this exact source root is
not the active default Core, the route/configuration identity fails, a GUI lease
is active, the native input mutex cannot be acquired, or the stop file differs
from the specifically recognized installation stop. An arbitrary owner stop is
never cleared by this workflow.

The local button writes an exclusive, flushed receipt bound to the original
intent ID/tool/SHA256, machine/user, exact source root and hashes of the relevant
controller/store/review tools. It preserves the original intent byte for byte,
and locally retains the recognized stop's bytes with an epoch-qualified name.
The historical outcome stays `UNKNOWN_NO_REPLAY`; no claim of APPLIED or
NOT_APPLIED is manufactured.

Fresh operations use a distinct epoch-specific persistent intent. A new unknown
effect blocks subsequent operations and restarts again. Only a live issued
handle can resolve its own new intent. Receipt changes, evidence tampering,
invalid paths/links, another source build, malformed records or storage failures
fail closed. Existing lease, single-use fresh-frame, desktop mutex, Escape and
GUI_STOP checks remain intact. No input is automatically queued or retried.

The receipt is application policy for the same trusted OS user, not an OS
security boundary against a user with unrestricted shell/file access. Different
trust domains still need separate OS accounts/sessions. No UAC/lock screen or
protected-input bypass is provided.

Acceptance sequence:

1. Candidate syntax, focused safety, full Windows test and audit gates.
2. Controlled installation with the old Core/configuration available for rollback
   and the new GUI still stopped. Preserve jobs; do not hot-patch installed code.
3. Physical owner's local form review. Never automate its approval button.
4. Named gui_status, observe lease and real screenshot on the exact host.
5. Explicitly authorized input into an owned disposable fixture, with a fresh
   screenshot before each operation and visible verification after each input.
6. End the lease and retain receipts. Packaging or mocked input is not native
   acceptance. A failed or partial local review must be reconciled, not rerun.

The original source/history, installed baseline and pending incident must be
preserved until a documented promotion. Existing game/video agents stay paused.
