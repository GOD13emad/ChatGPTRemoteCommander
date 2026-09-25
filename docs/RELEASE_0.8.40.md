# v0.8.40 qualification

Status: CANDIDATE, 2026-09-25.

v0.8.40 is the release successor to published v0.8.37. It carries the hardened background-browser work from the unpublished v0.8.39 tag and adds durable **background-first command operations**. The historical v0.8.38 and v0.8.39 tags are intentionally not moved.

For long-running or high-output command work, `operation_start` validates and reserves one logical request, returns an operation ID quickly, and runs the prepared allowlisted project command or Power Mode shell in a detached worker. `operation_status` and `operation_result` are bounded read paths; `operation_cancel` addresses only the exact Commander-owned operation. Stable request IDs make a lost acknowledgement idempotent; changing inputs under an existing request ID is a conflict. `UNCERTAIN` is a stop/reconcile state, never automatic retry authority.

Output capture is file-backed and policy-bounded. Receipts retain total stdout/stderr byte counts and SHA-256 over the complete observed stream even when captured bytes are truncated. If descendants inherit stdio after the direct child exits, Commander waits only a bounded drain interval and records `outputComplete=false` rather than stranding a completed effect.

Windows durability follows receipt-first recovery: a matching terminal `result.json` is completion authority and `state.json` is a repairable projection. Atomic state replacement bounded-retries transient `EPERM/EACCES/EBUSY` failures. This correction followed the project reassessment rule after the same false-uncertainty family repeated; a direct diagnostic captured the exact `EPERM` rename failure with a valid `SUCCEEDED` receipt.

The implementation is benchmarked against the MCP 2026-07-28 experimental Tasks extension, which provides standardized durable task state/poll/cancel. ChatGPT Plugin-path Tasks negotiation remains UNVERIFIED, so v0.8.40 keeps the minimal custom `operation_*` compatibility surface rather than claiming native Tasks support. Node child-process exit/close semantics also informed the bounded stdio-drain guard.

| Gate | Status |
| --- | --- |
| Pre-version Windows full `npm test` | PASS — 373 PASS / 5 SKIP / 0 FAIL; GUI 75/75; all tail contracts PASS |
| Pre-version Windows full `npm run check` | PASS — 152 PASS / 4 SKIP / 0 FAIL; GUI 75/75; source integrity PASS |
| Pre-version repository security audit | PASS |
| Async focused stress | PASS — 80/80 before final root-cause closeout; 45/45 after stdio hardening |
| Direct race diagnostic | PASS — 30/30 after receipt/rename/stdio corrections |
| Exact v0.8.40 Windows check/test/audit | PASS — test 373/5/0, check 152/4/0, GUI 75/75, runtime/source-integrity/security audit PASS |
| Exact v0.8.40 Linux check/test/audit | PENDING |
| Remote PR/hosted CI | PENDING |
| Pinned fresh/repeated installers | PENDING |
| Reproducible release assets / digest match | PENDING |
| Immutable GitHub publication | PENDING |
| Candidate-first Windows/Linux rollout | PENDING |

The release does not bypass MFA, CAPTCHA, WebAuthn, organizational monitoring, endpoint policy, Secure Desktop/UAC, anti-cheat/protected input, or OS permissions. It does not turn Project Engine into an OS sandbox and does not grant autonomous workflows browser/shell authority beyond their existing explicit configuration.

Method references:
- MCP Tasks extension: <https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks>
- Node child process `exit`: <https://nodejs.org/api/child_process.html#event-exit>
- Node child process `close`: <https://nodejs.org/api/child_process.html#event-close>
