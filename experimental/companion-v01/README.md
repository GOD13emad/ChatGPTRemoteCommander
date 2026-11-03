# Companion V01 exact source snapshot

This directory preserves the Commander companion source from PR #99 commit `715f99ae229e9e44ccc2e2b4ad6e6c3531b442da` byte-for-byte for audit and continuation.

It is deliberately **not production-wired** in v0.10.6. Hosted Windows qualification recorded `COMPANION_ACL_INVALID` for the actual isolated private-profile export, and historical source tests also carried a 0.10.4 runtime expectation after the official core moved to 0.10.5. Those failures are preserved rather than weakened or hidden.

Do not copy these files over the top-level runtime. A later revision may promote them only after native Windows private-file ownership/ACL qualification, updated baseline-version tests, hosted Windows/Ubuntu CI, and server-install canaries all pass on one exact tree.
