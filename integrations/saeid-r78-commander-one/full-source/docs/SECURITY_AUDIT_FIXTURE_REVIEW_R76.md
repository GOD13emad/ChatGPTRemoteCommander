# Full-history audit: immutable invalid-test provenance

The audit continues to scan all tracked files and `git log --all -p` across every available branch and tag. The public corpus used for this review contained 547 refs, 2,308 commits and 32,745,295 patch bytes. A smaller local bundle did not contain the same unrelated V2 history, explaining why its result could not substitute for hosted full-ref acceptance.

Eleven historical diff lines were reviewed as invalid test inputs, not external credentials:

| Fixture | Immutable commits | Lines | Classification |
| --- | --- | ---: | --- |
| Invalid private-key headers | `d890bd978b07aa738ceeef97bd6af2782538bac1` | 2 | Negative HTTPS fixtures; the source blob contains no private-key footer, complete PEM block or parseable key. |
| Fixed Bearer test inputs | `27c84a7db84efb863348f39384221b7c378a7871`, `e9f1681a9ad85c4d4a34c31425df96bf24b15567`, `456e37e2553b4268b3ee0b22cd193be00911ef87` | 7 | Hardcoded mock-verifier inputs in `test/v2-oauth-v1-mcp-dispatcher.test.mjs`; no production issuer or external credential. |
| Secret-rejection input | `5b713ab4f34883f5b916b0009caabafde63a255d`, `fab67310c53f0a2e50b1568d062c0a0bc65ad02d` | 2 | Explicit `POSSIBLE_SECRET` rejection assertion in `test/v2-capability-gap-registry.test.mjs`. Removed lines were reviewed against parent blobs. |

Exceptions require the exact finding type, immutable commit, path and full-line fingerprint. There is no current-file exception, wildcard, category-wide waiver or reduction of history coverage. Bearer context removes only the exact reviewed fixture line for that rule, preserving detection of adjacent or cross-line unrelated values. History and refs are not rewritten or deleted.

`test/security-audit-provenance.test.mjs` independently locks the eleven-entry metadata set and tests real generated private-key detection, new Bearer values, adjacent different types, chunk splits and changed provenance. It uses repository `test/security-audit.mjs` and Git on PATH. When public fixture commits are available, it retrieves their lines only into memory and checks exact/decorated/chunked acceptance plus wrong commit/path/prefix/line rejection. A shallow clone may skip only that historical-positive case; setting `RC_SECURITY_AUDIT_REQUIRE_PUBLIC_FIXTURES=1` makes missing fixture history fail explicitly. All negative controls remain active.

These corrections do not establish whole-product security or release acceptance. Hosted CI must qualify the final public commit. No raw fixture token or private-key text is included in this review.
