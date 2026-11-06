# F1 file-integrity revision

Scope: two file precondition implementations and one move recovery path.
Baseline: 402b9f4110f0c27bc7da3059f956df309048ca53 (v0.6.4).

1. An expected SHA-256 no longer succeeds when the target is absent. Invalid hash
   formats are rejected before touching the target. Power writes do not create
   parent directories before this precondition is checked.
2. Once a move has promoted its full destination and started source deletion,
   an error must preserve that destination. Source deletion can fail after
   deleting only some source entries. Removing the complete destination to restore
   an overwritten target could otherwise lose unique bytes. Recovery keeps the
   full destination and displaced/backup copies, returns MOVE_RECOVERY_REQUIRED
   and requires reconciliation. It does not blindly roll back.

Regression uses owned temporary fixtures and an injected partial-delete failure
in a COPY of the module. This is fault-injection evidence, not a claim that an
organic filesystem failure happened on the user's computer. The files and
production installation are never targets of destructive tests.

This does not make all file operations crash-atomic or secure against concurrent
hostile OS modifications. Two-file external effects cannot generally be made a
single transaction by a JavaScript lock. Independent OS sandboxing, process-tree
termination, full secret-redaction and broader fault tests remain separate gates.
