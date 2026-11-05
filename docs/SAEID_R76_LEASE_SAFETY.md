# R76 isolated root-lease safety candidate

This is a scoped Saeid source candidate based on commit 51848ade674c7a6e3975fa28f88f882ee53058f0. It does not change any installed runtime, production Router, owner grant, model provider or active job.

The R75 root-lease implementation garbage-collected expired rows even while an earlier dispatch could still be running. The minimal fix retains expired and uncertain claims, checks renewal/ownership loss, and refuses final acceptance while a claim remains. Finalization continues to report explicit pause/cancel first, under the same lease transaction. All existing plan APIs and workflow-autonomy exports remain intact.

Eight no-effect regressions cover expiry overlap, missing/foreign ownership, reopen, caller-only APPLIED not clearing a claim, ordinary completion, cached receipts and latched renewal loss. A separate retry-budget accounting unit intentionally disables lease enforcement only in its disposable fixture; default-on lease regressions independently assert that a second unknown effect cannot run. Control/crash tests now require unresolved claims to remain blocking.

Trusted native process-tree cessation and authenticated intended-chat ACK are separate open acceptance gates. No generic MCP caller can clear an orphan by asserting that an effect was applied or absent. This candidate deliberately does not invent a native cessation receipt or a permanent recovery implementation.

Integrated impacted regression: 202 PASS, 0 FAIL, 1 platform skip. The separately frozen CommanderOne R65-derived candidate also includes a strict typed Windows-token-proof quarantine guard; 29 PASS, 0 FAIL, 1 native-broker-not-enrolled skip. Those source/fixture results are not production OAuth, native input, OS-login, installer or Stable acceptance.
