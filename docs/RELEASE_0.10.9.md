Remote Commander v0.10.9
========================

This patch release hardens lifecycle and retention behavior observed on real Windows hosts after v0.10.8.

Qualification containment
-------------------------
Windows update gates run inside a native Job Object with KILL_ON_JOB_CLOSE. PASS, FAIL, timeout, wrapper termination, and deliberate child -> grandchild leak cases are covered. A successful qualification is rejected if descendants survive the gate.

Browser lifecycle
-----------------
Isolated Commander browser sessions persist a private lease marker. Startup reconciliation reaps only exact Commander-owned isolated-* profiles whose owner is dead or lease expired. Persistent Commander profiles and user browser profiles are excluded.

Storage and recovery
--------------------
Windows backup maintenance verifies archives before deleting open snapshots, then applies bounded age/count/byte archive retention while preserving minimum rollback points. Workflow startup recovery is paged and bounded beyond the historical first-page ceiling. Release cleanup retries are bounded and emit process ownership evidence when a release remains locked.

Acceptance
----------
Publication requires full Windows check/test/audit, hosted Windows and Ubuntu CI, Linux exact-ref qualification, candidate-first live rollout with zero qualification/browser orphan growth, and immutable release asset verification.
