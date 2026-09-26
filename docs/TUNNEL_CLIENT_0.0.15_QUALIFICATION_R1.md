# tunnel-client v0.0.15 Qualification Plan R1

## Upstream facts captured 2026-09-26

- Release: `v0.0.15`
- Published: 2026-09-25T04:40:41Z
- Annotated tag object: `f34e8247f17fc964deeac25aead143f6640224cc`
- Tag target commit: `a390c168ff1b2d14e73a95991c186c6aba3ff5a0`
- Delta from v0.0.14: 111 commits.
- Relevant changed areas include runtime health/supervision, redundant pollers, max-inflight tests, routing correction, stdio/tool E2E coverage and client capability handling.

Selected official asset digests:
- full Windows amd64 ZIP: `sha256:3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1`
- full Linux amd64 ZIP: `sha256:8c836dc5d68d68b663d9a5c5b28ff9fa780d9f7a3fffb1c306880b8f32fab5f1`
- runtime Windows amd64 ZIP: `sha256:aa5ddb14dddd602fa59f3e6f4401aa8a79a218e341466226b7434127dff65dbc`
- runtime Linux amd64 ZIP: `sha256:f26f8b3ee6c335e38fa5cfbe6ce5635f53738f08a26eecf07d6cebacab4a1abf`
- SHA256SUMS.txt: `sha256:8a32bbcd724468f1874f12d5b0dedb6e6b07dfe5aa323cf5b4c070a5a81b0b4e`

## Do not auto-promote

The v0.0.15 delta is large enough that "latest" is not sufficient evidence. Candidate-first qualification is mandatory.

## Candidate qualification sequence

1. Download exact platform asset into isolated candidate directory.
2. Verify asset digest against release metadata and SHA256SUMS.
3. Verify `--version` and binary provenance.
4. Run local MCP server without changing canonical route.
5. Run tunnel-client doctor/health/readiness diagnostics.
6. Run short MCP request canaries.
7. Run bounded parallel requests and max-inflight tests.
8. Exercise a forced local MCP timeout and confirm later requests still succeed.
9. Exercise tunnel reconnect/control-plane idle reset where safely reproducible.
10. Verify shutdown/restart does not leave duplicate pollers.
11. Verify multi-profile isolation.
12. Run Commander check/test/audit with candidate tunnel config where applicable.
13. Compare logs for deadline drops/post failures against v0.0.14 baseline.
14. Promote route candidate-first only if all acceptance gates pass.
15. Preserve rollback binary/config until live canaries pass.

## Acceptance gates

- no regression in short request latency/availability;
- no shared transport corruption after one timed-out request;
- no duplicate pollers after restart;
- no cross-profile route leakage;
- health/readiness semantics are stable;
- Commander long work is still detached before tunnel deadline;
- zero new 413 or Commander-caused response deadline drops during qualification;
- exact hash/version recorded in PROJECT_KNOWLEDGE_EVIDENCE.

## Important boundary

A newer tunnel client does not remove the need for Commander-side durable execution/delivery. Tunnel response deadlines are transport policy; long project completion must survive independently of one request/response lifetime.
