# R79 independent host review — first frozen source

Status: FAIL_SOURCE_REVIEW for first source manifest `83c51792656fde69d6c716b31a88d32b4287a3471566c4f1582956c6f59ea763`. Source-only findings; no listener, native authority, test, enrollment, installation or UAC action was executed by reviewer.

## A1 — impersonation precedes first bounded pipe read

`Program.cs` (`3c576bfe549e364063409568f1f57f61f27796ca13ed4cd33d9c99f379de9ef3`) calls `KernelPeer.Authenticate` immediately after connection, before `ReadFrame`. Authentication invokes `PipeIdentity`/`RunAsClient`. The documented Windows impersonation context belongs to the last message read, and the .NET example first reads the request before impersonating. This ordering can deny the initial legitimate peer because its message token is not yet established. Existing ordinary-token negative qualification cannot establish the positive pipe path.

Correction: preserve kernel PID/process-generation binding, read only a strictly bounded frame with a finite deadline and no parse/dispatch, then authenticate the pipe impersonation context before parsing/authorizing/dispatch. A simpler read-first ordering must also preserve connection-time generation consistency. Never substitute caller-supplied JSON identity or weaken impersonation requirements.

Primary sources: [Win32 ImpersonateNamedPipeClient](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient), [NET RunAsClient example](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeserverstream.runasclient?view=net-10.0). The conclusion is a source ordering inference from documented semantics; no positive native peer experiment was authorized here.

## A2 — pinned host policy can diverge from policies actually opened by producer/exchange

`HostPolicy.cs` (`40ab3f35149d37fa796de331669923f34d41904fdd4aa2c37ed87f94dfadff0f`) verifies native/OAuth policy hashes once in `LoadProtected`, closes those handles, then `Program` opens producer/exchange separately. Concurrent protected configuration replacement between these operations can make those objects load different policy bytes. `HostPolicy.Revalidate` currently verifies only the host-policy file, so it does not detect this mismatch at peer demand. This is a configuration-consistency race, not a demonstrated ordinary-user ACL bypass.

Correction: every host revalidation must re-read/verify both protected native/OAuth policy hashes against the admitted host-policy pins. The producer/exchange's existing per-operation fresh byte-equality checks must remain. Source tests can inspect the pure policy-binding helper; positive protected-policy acceptance remains a separate gate.

## Narrow boundaries already present

Exact four-action protocol has no generic signing/shell endpoint, rejects JSON identity/approval additions, enforces32KiB frames and deadlines. Host mode requires actual SYSTEM/session0 before protected reads/pipe creation. Process handle/PID/FILETIME, process-token SID/session, pipe impersonation SID/session and protected native image path/hash are independently checked; owner-admin additionally requires actual elevated/admin/high-integrity process and pipe facts. Pipe first-instance/remote rejection/owner-only rights are explicit. These are static boundaries, not proof of real positive kernel identity or installed protected load-chain behavior.

Default production project explicitly links the six frozen R78 inputs, hashes those at compile time, uses NativeAOT and System32-only loader flags; fixture QA is separately opted into the build and no managed companion is admitted by source. Deployment and actual peer enrollment remain STOP until exact native binary/load-chain and protected acceptance evidence exists. The full R78 suite must not be replayed for these narrow host corrections.
