Remote Commander v0.10.10
=========================

This patch release fixes bounded durable-delivery compaction so repeated maintenance passes continue through the full eligible history instead of stalling on the first page of artifacts that were already archived.

Durable delivery compaction
---------------------------
The compactor no longer consumes its per-call scan budget on verified artifacts that are already stored as gzip archives. Repeated bounded calls now advance to later plain artifacts while preserving every delivery record, correlation binding, acknowledgement state, and exact artifact bytes.

Safety invariants
-----------------
Compaction remains storage-only. It does not synthesize acknowledgement, mark completed-undelivered history as delivered, mutate logical delivery rows, compact active leases, or include unresolved/dead-letter records. Archived reads remain transparent and content-hash verified.

Regression
----------
A new regression creates multiple completed deliveries and runs compaction repeatedly with a limit of one. Every pass must archive the next eligible artifact, all logical states remain completed-undelivered, and no plain artifact remains after the final pass.

Acceptance
----------
Publication requires the normal repository check/test/audit gates, hosted Windows and Ubuntu CI, Linux exact-ref qualification, candidate-first live rollout, and immutable release asset verification.
