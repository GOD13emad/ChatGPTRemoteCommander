# R79 — bounded native issuer host, source handoff

**PASS_NATIVE_HOST_LOAD_AND_ORDINARY_NEGATIVES_ONLY. Not installed, enrolled or a successful owner login.** Native candidate `G:/CodexWork/RC1R79Issuer/native/CommanderNativeIssuer.exe`: 4,123,136 bytes; SHA256 `e7b86f31531dc2f2a2afeda3cab5c717726a0eddc852ed27c2114c1f659f4469`. Actual NativeAOT compilation and finite protocol qualification passed. No listener, private key, authority-policy path, UAC, service, public HTTP endpoint, route, project job or GUI was opened/changed by qualification.

## Exact source and dependency authority

The active source is `src/` plus `SOURCE_INPUT_MANIFEST.json` SHA256 `10c81512377c5034763ffd5016ff83cebf583142f0762915d93e769f987dcae1`. It links six frozen R78 exchangeC/StoreB/J sources by reference, not a new full source/cache copy. Shared source publication: commit `5bdbd9c`. Shared `../commander-one-integration-r78/RETURN_R78.zip`: SHA256 `3e3442499c71a3adcdf5dfc23061a6e7f8be13605747d4b41bf8d834f07c5784`, 5,253,297 bytes. R78 is sealed and unchanged.

Build input is the explicit **build-time** `FrozenR78SourceRoot` property. The project itself checks every linked file's expected SHA256 before compilation. There is no request/runtime-selected source root or input executable. `SOURCE_INPUT_MANIFEST.json` records each required logical relative path. For transfer, obtain the exact R78 source files through that admission/publication and reconstruct those logical paths; a successful ZIP download is transport only, not protected enrollment or target-host acceptance. Do not assume an arbitrary ZIP extraction root has the build layout.

`BUILD_ADMISSION_A.json` admits the short G staging/cache references before creation. The build rechecked687 already-admitted expanded Microsoft build-package files and reused the R78 signed10.0.14 cache without copying it or downloading a new dependency. New outputs remain under `G:/CodexWork/RC1R79Issuer`, owned by this project. No project output tree was created on C. Do not put compiler caches or pin-test fixtures into Return.

## Implemented host boundary

The default executable accepts only `--diagnose` or `--serve-once`. Serving first requires actual elevated SYSTEM, system integrity and session0 from the kernel, **before any policy/key path access or pipe creation**. An enrolled local administrator remains the trusted deployment authority; Full Power, a JSON `system`/`approved`/`pid` field, a chat ID or conversation header is not identity. No signed-conversation assertion or cloud identity dependency was invented.

The proposed server is one local named-pipe connection and one request, not a service/scheduler. It has a60-second connection deadline,5-second bounded first-frame/reply deadlines and a32KiB length-prefixed JSON maximum. Fixed actions are `authorize` (native producer begin or consent-complete), `exchange`, `state` and `revoke`; no arbitrary signing, shell, program, file path, executor or retry API exists. It reuses the exact R78 fixed action classes. Native owner consent, client private_key_jwt, PKCE, one-use code and durable no-replay rules remain enforced there. Parsing valid fixture syntax never dispatches those actions.

The pipe source uses explicit `FIRST_PIPE_INSTANCE`, `PIPE_REJECT_REMOTE_CLIENTS`, a non-inheritable handle and a protected descriptor. SYSTEM gets full control. The enrolled owner's individual rights mask `0x0012019B` excludes `FILE_CREATE_PIPE_INSTANCE` (bit4), avoiding the generic-write/create-instance equivalence. An existing pipe name is an error, never removed, attached to or retried.

Before input, the source captures and holds the kernel-reported client PID, native process handle/creation time, token handle and exact protected native image file handle/hash. It requires the protected owner's SID and configured local session, a fixed admitted native image under the protected program directory, no CLR header and System32 dependent-load flags. **Only after the bounded first frame has actually been read** does it obtain the pipe's impersonation context, verify owner/session and demand the action. It checks held generation/path/liveness again before dispatch/reply. An owner-admin role additionally requires actual elevated/high-integrity Administrators membership in both process and pipe impersonation tokens; an oauth-proxy role cannot revoke.

Peer rules, owner SID/session, host image hash and native/OAuth policy hashes must come from the protected host policy. That file, both linked policy files and the admitted host image are held open without sharing write/delete for the host lifetime. Every peer/action revalidation also re-reads and hashes the native/OAuth policy paths against the admitted host bytes. Frozen R78 objects additionally enforce their own loaded policy bytes. This is a source-level consistency correction, not a claim of a tested positive protected SYSTEM deployment.

Responses contain only the fixed typed result or sanitized error code. Raw requests, codes, JWTs, private paths and exception text are not logged. A lost response does not rerun an action. A disconnected client after dispatch may leave a consumed/uncertain auth transaction; the source does not promise recovery of a lost code/token or manufacture a success acknowledgement.

## Actual evidence

`qa/a/RECEIPT.json` records ordinary-user NativeAOT compilation (no warnings emitted), PE CLR directory0, dependent-load flags2048/System32 and an extracted `asInvoker`, `uiAccess=false` manifest. The actual diagnostic observed non-SYSTEM, non-elevated, non-admin integrityRID8192; actual `--serve-once` exited2 / `HOST_SYSTEM_TOKEN_REQUIRED` before authority paths/listener. Binary pre/post SHA256 matched. **20 targeted native parser/framing cases passed**, including rejecting caller SYSTEM/PID/approval fields, arbitrary signing/shell actions, duplicate schema, oversized/truncated frames and the real ordinary-token SYSTEM guard.

`qa/b/RECEIPT.json` records two additional expected build-admission failures: missing build-time frozen root and one intentionally altered, self-owned frozen-source fixture. Both exit1 at the intended project guard. Only six small dependency copies under the private short test root were used for that transport fixture; the sealed R78 sources and current host sources remained equal. Neither test runs issuer code. This is not a repeated full943 suite.

Kernel peer positive/negative pipe interactions, actual SYSTEM policy/key opening, protected image/ACL acceptance and actual local owner approval remain **UNPROVEN**. No real pipe was created during these tests. Metadata and ordinary denial cannot establish that the host is operational for a real client.

## Failure learning and independent review

The initial source is preserved in `source-history-a/` with original manifest SHA `83c51792656fde69d6c716b31a88d32b4287a3471566c4f1582956c6f59ea763`; it is superseded / DO NOT RUN. Independent review found two source blockers before accepted build:

* **A1:** the first version called pipe impersonation before reading a client message. Windows uses the security context of the **last message read**. The corrected source pins the kernel process first, then reads bounded bytes, then verifies the pipe identity before parse/dispatch. No JSON identity substitute or real-listener experiment was used.
* **A2:** closing the admitted policy files before the R78 objects opened them allowed a load/use mismatch. The corrected source holds host/native/OAuth/image handles for its lifetime and rechecks both policy hashes on every revalidation. Own policy bytes in the R78 classes remain independently checked.

These are source API/context and configuration-lifetime failures, not installed-host incidents. No failed native input or job was repeated. Reviewer evidence lives under `reviews/independent-host/`; parent finalization owns its registration and final archive inclusion. Consume neither A/B runner again. Source expansion stops at this bounded host/load gate.

## Still open before deployment or FINAL

No protected bootstrap/enrollment, trusted publisher/artifact signing, actual SYSTEM launch, enrolled native proxy/admin client, service installation, private key, transport binding, real owner UI or live OAuth test exists. The host correctly fails closed without that environment. There is no new proxy/HTTP/service implementation hidden behind the policy shape. Future clients must independently authenticate the server too; this revision does not supply them.

The current host is an ordinary writable build artifact; **DO NOT INSTALL / DO NOT RUN AS SYSTEM** merely because compilation/negative tests pass. A reviewed protected native deployment must admit exact source/artifact hashes, directory/code/key ownership and load chain, minimum Windows support, narrow fixed peer/actions, actual owner identity, explicit OS setup/rollback and separate owner approval. Local administrator/system compromise, joint rollback of all protected state and OS power-loss integrity are not solved by a hash manifest or this candidate. Standalone StoreB's late-expiry limitation remains unchanged; R78 exchangeC's held-receipt/post-consumption deadline only qualifies its composition.

Next parent action: reconcile final source/binary/evidence pins with independent review, publish the additive source delta and one compact Return/continuation package. Keep current Commander, installed capabilities and active work unchanged. Real protected deployment is a separate gate, not an automatic promotion.

## Primary sources used for corrections

* [GetNamedPipeClientProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid)
* [ImpersonateNamedPipeClient uses the last message read](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient)
* [RunAsClient and reversion](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeserverstream.runasclient?view=net-10.0)
* [Named-pipe ACLs and create-instance rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
* [File sharing lifetime](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare?view=net-10.0)

Documentation establishes API behavior, not a positive protected runtime receipt.
