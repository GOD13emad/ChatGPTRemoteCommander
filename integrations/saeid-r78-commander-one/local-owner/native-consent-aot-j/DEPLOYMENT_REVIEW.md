# J source: explicit system DLL search

Status: **PASS_NATIVE_SYSTEM32_SEARCH_SOURCE_AND_NEGATIVES_NOT_DEPLOYED**. This is a new source-derived NativeAOT candidate; H source and binary remain unchanged history. J is the proposed helper direction for parent review, not an installed authority or approval to run elevated.

Native candidate: `G:/CodexWork/RC1R78AuthAot/j/native/CommanderOwnerConsent.exe`, 3,538,432 bytes, SHA256 `1ae194557963771ebc0b74d5590542fd3013494985a3a266963da4b0048b84c4`.

## Concrete changes and evidence

`SystemDllPolicy.cs` adds assembly-level `DefaultDllImportSearchPaths(System32)` for lazy P/Invoke resolution. The NativeAOT compiler's direct P/Invokes are resolved by the OS loader and **ignore that attribute**, so the linker also sets `/DEPENDENTLOADFLAG:0x800`. This independent distinction follows the official NativeAOT interop and MSVC linker documentation; no guard was replaced by an environment variable.

`qa-j/RECEIPT.json` records actual ordinary-user NativeAOT publication using the already-admitted five official Microsoft10.0.14 packages, without a new download or OS installation. The source and short build staging were admitted first. Native PE parsing and dumpbin show the actual dependent-load flags equal2048/0x800 and the CLR data directory is zero. The derived source is identical to H except the search policy file and project include/link flag.

Actual direct import inventory is classified against this machine's read-only KnownDLL registry. ADVAPI32/KERNEL32/ole32 are listed as KnownDLLs; bcrypt/CRYPT32/ncrypt exist in System32 and rely on the OS-dependent search flag; API-set contracts are classified as virtual API sets rather than missing physical files. This is classification of metadata, not a claim of recursively observed protected module loading or every OS DLL's provenance.

The embedded manifest was actually extracted with the existing Windows SDK `mt.exe`. It contains Common Controls v6 and `asInvoker`, `uiAccess=false`. No auto-elevation or UAC launcher is added. This proves resource metadata, **not an actual activated SxS UI path**. The machine reports Windows10-family build26300; the documented dependent-loader flag applies on Windows10 RS1 and later.

Actual J diagnostics ran with kernel-resolved System32 as working directory: filtered token (`Elevated=false`, type3, non-admin, integrityRID8192); request entry denies `REAL_UAC_REQUIRED` before authority paths, keys or UI. Because this source change affects loading, the harmless managed-startup-hook negative was repeated on J; its pinned hook did not run. The positive control is the previously executed H managed fixture, explicitly reused as history rather than claimed rerun. No planted unmanaged DLL attack was exercised. No user session was driven.

## Required future launch/deployment contract

Before any elevation: independently admit the exact helper source/native artifact; install executable and authority/key/state paths with reviewed protected ownership/DACLs; reject reparse and untrusted parent-delete routes; verify intended owner, issuer and current enrollment; prepare rollback; and obtain the owner's real native consent. No elevated setup or launcher is supplied in this source slice.

A future reviewed native launcher must use the **absolute protected executable path**, fresh artifact hash and identity, the kernel's canonical System32 working directory, and an explicit minimal environment with trustworthy system-directory values. It must not inherit owner-writable DLL/PATH locations or arbitrary runtime/profiler/startup-hook settings. Clearing an environment variable inside Main cannot repair pre-Main loading. The protected application directory, native loader/SxS policy, actual owner/elevation/session, key ACL, broker peer identity and endpoint admission remain independent gates; Full Power is not any of them.

These restrictions reduce specific DLL search paths. They do not prove an unattackable native loader, prevent an already elevated administrator from modifying the system, or establish physical-human input. No protected deployment, real UAC, owner key, prompt, positive TaskDialog interaction, persistent service, token issuance, live OAuth or installed Commander change occurred.

Next: parent peer review and selection of J helper source plus `../protected-issuer-state` producer source; then complete protected native issuer integration and exact deployment/rollback proposal before any owner-visible native approval. Current compiled DLL fixture and writable managed outputs remain DO NOT ELEVATE. The single J runner is consumed / DO NOT RUN AGAIN; parent alone packages and registers.

## Primary sources

* [DefaultDllImportSearchPathsAttribute](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.defaultdllimportsearchpathsattribute?view=net-10.0)
* [NativeAOT direct P/Invoke ignores this attribute](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/interop)
* [MSVC DEPENDENTLOADFLAG](https://learn.microsoft.com/en-us/cpp/build/reference/dependentloadflag?view=msvc-170)
* [Windows DLL search, KnownDLLs, API sets and SxS](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order)
* [Application manifest semantics](https://learn.microsoft.com/en-us/windows/win32/sbscs/application-manifests)

References support API behavior; actual acceptance remains limited to the recorded metadata and ordinary-user negative executions.
