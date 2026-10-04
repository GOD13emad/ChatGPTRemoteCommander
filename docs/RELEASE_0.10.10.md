Remote Commander v0.10.10
=========================

This patch release fixes bounded durable-delivery compaction and adds Windows filesystem-enumeration safeguards discovered during an owner-host kernel-resource incident. Repeated maintenance passes continue through the full eligible delivery history, while Commander-native recursive enumeration refuses a bare Windows volume root and synchronous search has an explicit entry-visit ceiling.

Durable delivery compaction
---------------------------
The compactor no longer consumes its per-call scan budget on verified artifacts that are already stored as gzip archives. Repeated bounded calls now advance to later plain artifacts while preserving every delivery record, correlation binding, acknowledgement state, and exact artifact bytes.


Windows kernel-pressure prevention
----------------------------------
Commander-native `list_directory` and `search_files` now refuse recursive enumeration when the requested target is a bare Windows volume root. Synchronous `search_files` is additionally capped at 5,000 visited entries and reports `visitedEntries` / `visitLimitHit`, preserving bounded work even inside Full Power.

The Windows updater also honors a reversible local `maintenance/auto-update-paused.json` sentinel for unattended updates while still allowing an explicit owner `-Force` run. This prevents a degraded host from repeatedly re-running expensive qualification before recovery.

Host evidence boundary
----------------------
On the affected Emad-PC host, System PID 4 and kernel-pool resource counts were abnormally high and local process-lifecycle qualification became contradictory. Matching Microsoft issue reports make `wcifs` a leading attribution, but local stack-level attribution is not proven. The release therefore records an owner-only recovery runbook and does not claim that v0.10.10 repairs the Windows kernel/filter defect itself.

Safety invariants
-----------------
Compaction remains storage-only. It does not synthesize acknowledgement, mark completed-undelivered history as delivered, mutate logical delivery rows, compact active leases, or include unresolved/dead-letter records. Archived reads remain transparent and content-hash verified.

Server installer version coherence
----------------------------------
Windows and Linux server installers now default to the same v0.10.10 release identity as the main installers. The Windows bootstrap User-Agent is also version-aligned. Installer contract tests fail if these defaults drift again.

Regression
----------
A new regression creates multiple completed deliveries and runs compaction repeatedly with a limit of one. Every pass must archive the next eligible artifact, all logical states remain completed-undelivered, and no plain artifact remains after the final pass.

Acceptance
----------
Publication requires the normal repository check/test/audit gates, hosted Windows and Ubuntu CI, Linux and Windows Server install canaries, healthy-host exact-ref/candidate qualification, and immutable release asset verification. Emad-PC local promotion remains separately blocked until owner-performed host recovery and a fresh post-recovery baseline.
