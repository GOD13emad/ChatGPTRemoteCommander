# Host-only native cessation source handoff (R76)

Status: independently reviewed source slice and scoped Windows QA; NOT a product release, installer, live executor integration, or historical orphan recovery. No public MCP tool is added and the constructor verifier defaults to null.

## Exact integration boundary

Apply patches/workflow-native-cessation-r76.patch ONLY to src/workflow-store.mjs SHA256 974f8f82491b5f871c24668074261c48ddae3604d8d13dd20116a7668d2321cf. Expected result SHA256 ac0d844cdf17a0afcbfccfc2b56376195321885fb24f3c99473d02fbb9838a13. Refuse another base; do not blindly apply to main. Add the included src/owned-native-cessation.mjs and test files without replacing unrelated source. All existing exports and autonomy/roadmap APIs are preserved.

The source patch adds a nullable host-injected native verifier, read-only preflight, exact lease/operation/root/store compare-and-swap release and append-only release-evidence rows. The oracle accepts only its own trusted nativeRunner invocation, binds the launch lease fingerprint, privately snapshots state/arguments, rechecks lease/control after awaited policy, and requires a reviewed fixed local-job-contained action policy before launch. A native Job Object does not fence service-submitted or remote work. Such effects require another independently trusted fence.

The host adapter must obtain the actual current executing intent from the private store. The generic dispatch callback snapshot may predate intent registration. Never reconstruct a current operation binding from caller input. No service, registry, account, network rule, credential or native broker is installed by this source handoff.

## Reproduction and actual evidence

The exact slice was qualified on Windows x64 / Node 24.19.0: 21 tests, 21 PASS, 0 FAIL, 0 SKIP. This includes a real disposable native child writing an owned effect file once, kernel-assigned-before-resume Job cleanup, native PID plus creation FILETIME, a ready disposable descendant confirmed absent after cleanup, exact witness CAS release, separate post-state verification and cached no-replay. Negative cases cover missing/forged/stale witnesses, changed lease before/during verification, revoked/changed lease or pause during awaited policy, and mutable caller args/root. A separate counter-only no-effect test explicitly disables lease coordination; it is not production recovery acceptance.

Existing dependency pins, not included binaries:

- native-process.mjs: 643ad9a2534041066943bafa322bfb2ecc38670e789f86374a150e23c9f765a6
- model-contract.mjs: 6298f5be3acaf072a0c0eaf81d228640931d670c9be9d8077d0fa1d0b7b8b902
- commander-job-guard.exe: c8021a570a8b6bcfacbb1ce769a4f6a2e9de44bc41e52ec446a90b458a7f386a

Set RC_R76_NATIVE_RUNTIME_ROOT to an independently trusted directory containing those exact dependencies. Keep any temporary output under an isolated owned QA root. Run node --test with the three included test files after exact-base integration. Without Windows and that explicit native runtime, native cases are SKIP, never native PASS. No model, paid provider, real project job or production process is needed.

The local qualification JSON SHA256 is b038b312916687e8aa105de7ab02d14f4245aad091b32a808632160469e3ccda; log SHA256 967bb70e1578daee02f573ac1b70018bf9dc0b1743ef523927be375fe0871d8d. Independent read-only source-review SHA256 c48462bf83eceb4d58353441ee37d74ca58adf9f0ea8ac53bdca1131cc492524. These are evidence anchors, not public raw output attachments or independent binary publisher attestation.

## Explicit open gates

- No production executor or public tool is wired to this callback.
- The oracle witness is in memory, with a 30-second fresh verification window. The SQLite audit stores a digest, not a reconstructable durable proof body. Cold restart, existing unbound historical orphans, durable proof storage and owner-native production adapter acceptance remain OPEN. Missing evidence fails closed; no old lease or operation is cleared by this handoff.
- Any change in the exact launch lease fingerprint, including ordinary long-job heartbeat renewal, fails closed. Long-renewing jobs need a separately qualified stable owner/attempt binding. This is not universal executor fencing.
- A fixed-action containment policy is mandatory; arbitrary shell/app/network effects are not covered by local process death. Full Power is not a containment proof or authenticated ChatGPT identity.
- Real intended-chat ACK, fleet installation, OS login/reboot acceptance and Stable release remain separate.

Prior failing QA retained locally: the first fixture used a pre-intent snapshot and then was corrected to require actual executing/native evidence. Later descendant fixtures incorrectly required an explicit kill label; actual cessation was established by ready PID plus absent process and job-empty cleanup. The exact kill/exit cause remains unproved and is not needed for that narrower fact. No failed receipt was relabeled PASS and no production action was replayed.

Rollback: source-only integration uses the recorded exact base and existing repository rollback. Do not release any live root lease without the independently trusted bound proof and current CAS checks.

Exact-byte patch application uses `git -c core.autocrlf=false apply --check patches/workflow-native-cessation-r76.patch` and then the same command without `--check`. This scoped setting preserves the tested LF bytes without changing user/global Git configuration. Always verify the expected post-SHA; a CRLF-converted working file has different bytes even when code is equivalent.
