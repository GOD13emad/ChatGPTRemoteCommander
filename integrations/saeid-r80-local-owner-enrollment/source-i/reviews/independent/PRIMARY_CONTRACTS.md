# R80 finite native enrollment/proxy review contracts

Scope: source and existing QA review only. The reviewer does not register/start tasks, elevate processes, enroll keys, alter installed Commander or inspect/stop/replay active project jobs. R78/R79 are sealed dependencies. Prior R76 installer lifecycle/CAS preservation is conceptual precedent, not an existing trusted native enrollment; no further R76 runtime/QA-tree scan is needed.

## Task ownership and invocation

Microsoft's [Security Contexts for Tasks](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks) separates read/write/delete/execute permission on registered tasks. A fixed on-demand task may grant the owner read+execute while reserving modification to SYSTEM/Administrators. Elevated task creation itself needs the appropriate credentials; SYSTEM's task run level is not an alternative user-authentication check. This is an ordinary-proxy invocation requirement, not an invitation to general privileged execution.

The [RegisterTaskDefinition contract](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-itaskfolder-registertaskdefinition) accepts task SDDL and defines create, update, no-principal-ACE and registration-trigger flags. Exact fixed task names/actions and no triggers/restart policy avoid periodic execution or blind replay. Existing unknown tasks must not be silently overwritten. The returned/registered XML and stored security descriptor need reconciliation, not merely assuming the requested values were installed.

The [SetSecurityDescriptor contract](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-iregisteredtask-setsecuritydescriptor) permits explicit task ACLs and TASK_DONT_ADD_PRINCIPAL_ACE. Do not deny SYSTEM; preserve SYSTEM/Administrators authority and a protected security-descriptor owner. Making the ordinary owner's SID the descriptor owner can undermine a nominal read/execute-only DACL through owner security-descriptor rights; the concrete installed descriptor must be checked.

The ordinary proxy must be able to invoke that exact enrolled task for R79's one-shot lifecycle. A fixed protected System32 `schtasks.exe /run /TN <fixed name>` is sufficient if implemented without arbitrary program/task/arguments supplied by a request, with bounded launch/connection and no retry after an uncertain result. Task-start success alone is not server authentication or effect success. Authenticate the actual kernel server process/token/image/generation before writing a frame.

## Pipe token and protected-file lifetime

[Task Security Hardening](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-security-hardening) notes default task privilege handling can omit SeImpersonatePrivilege. The [pipe impersonation contract](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient) permits identification-level context without treating JSON as authority. Coordinate the client's explicit Identification impersonation level with frozen R79's requirement and verify actual positive permissions later; no fallback to a claimed SYSTEM response is acceptable.

R79's first-read correction remains required: hold kernel peer identity, read bounded bytes, inspect pipe identity, then parse/authorize/dispatch. [RunAsClient](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.namedpipeserverstream.runasclient?view=net-10.0) is not a substitute for reading the connection's message context.

[FileShare](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare?view=net-10.0) and [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) define incompatible writer/delete/rename exclusion for retained read-only sharing. Source/image/key/path admissions must persist through copy, activation and response, with fresh hash/owner/reparse validation where the path is reopened. Protected placement and a pinned NativeAOT load chain are distinct from a hash on a writable managed test DLL.

## Concrete acceptance boundary

Review frozen bootstrap+proxy sources and finite pure/native ordinary negative QA first. Then the parent can present the owner's actual UAC approval for that concrete build/install/rollback plan. Do not create an impossible signed-conversation requirement: authenticate local owner, kernel host and fixed action/client grants at their actual boundaries; conversation identity can remain explicitly unauthenticated.

Positive kernel-peer exchange, actual ordinary task invoke permissions, protected task/policy/key/load-chain acceptance, owner login, rollback and current installed operational behavior remain UNPROVEN until real bounded acceptance receipts exist. Only the affected gate closes on a new failure; no duplicate943-test suite or speculative global control is required.
