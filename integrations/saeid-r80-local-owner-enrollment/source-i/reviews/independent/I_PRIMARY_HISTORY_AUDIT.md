# R80 I: bounded failure-pattern and primary-contract audit

Scope: read-only source review of the next bootstrap/launcher revision. No elevation, task registration, enrollment, probe runtime mode, input injection or replay was performed by this reviewer. H and its evidence remain historical and unchanged.

## Evidence and causal boundaries

The parent reports that one H apply was consumed, returned exit 2, and created no enrollment roots/task. Its elevated stderr was not captured. Therefore a specific H error code is **unobserved**, not confirmed by inference. The parent also reports a read-only actual ancestor ACL observation containing the exact Windows TrustedInstaller SID. Independently inspected H source confirms that `ProtectedInstall.Ancestors` rejects every allow rule with `DeleteSubdirectoriesAndFiles` except SYSTEM and Administrators, while the same file's `ProtectSystemTool` already admits that exact TrustedInstaller SID through `OsTrusted`. This is a **confirmed source compatibility defect** and a probable explanation of the observed early H failure; it does not reconstruct missing stderr.

The separate hidden-form observation is parent evidence: the launcher's process remained running, but its own form was not visible. Inspected H source starts its timer from `Shown` without an explicit native show/visibility check. A hidden startup window state can therefore conceal the local status UI. This UI issue is independent of ancestor ACL admission and does not establish whether a UAC prompt was accepted or the apply succeeded.

## Narrow correction and relevant history

Use the already-existing exact `OsTrusted` principal predicate for the fixed OS ancestor delete-authority check. Keep no-reparse checks, exclusive target creation, all per-file protected ACL checks and the private-key trust set unchanged. Do not change Program Files ownership/ACLs, admit arbitrary service SIDs, or relax protected key/policy readers. The same environment contract must be checked during the ordinary read-only preflight, so a deterministic host mismatch is visible before an elevated apply is consumed.

Earlier R80 journal-empty and inherited receipt-ACL defects arose because fixture setup bypassed part of the real production file-lifecycle contract. I should address this recurring **fixture/host admission drift** at the relevant shared preflight boundary, with finite source tests plus the actual read-only ancestor check; another large fixture suite is not evidence of actual enrollment. H partial-task retirement selection remains required and should be unchanged. A new fixed sanitized phase/code outcome improves observability; it must not write credentials, keys, bearer tokens, project content or arbitrary exception text.

For the parent launcher, explicitly show only its own form and verify native visibility before starting preflight. This is UI readiness, not authority or user approval. Preserve exact plan/image pins, CreateNew consumed-attempt records, real owner UAC and no-retry behavior. A ShowWindow return of zero means previously hidden, not a failed show. A positive IsWindowVisible means the window/ancestors carry WS_VISIBLE; it does not prove unobscured presentation or human attention.

## Primary sources

- [Microsoft: About Windows Resource Protection](https://learn.microsoft.com/en-us/windows/win32/wfp/about-windows-file-protection): Windows uses TrustedInstaller for protected OS resources. This supports the identity's legitimate OS role, not a claim that every local path has a particular default ACL.
- [Microsoft: ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow): startup information can override the first show; SW_SHOW displays the specified window; the return describes previous visibility.
- [Microsoft: IsWindowVisible](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindowvisible): checks visibility style on the window and ancestors, with possible obscuration by other windows.
- [Microsoft: Form.Shown](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.form.shown): raised on the first display; not a durable independent indication of the native window's current visible state.

Final I acceptance requires exact frozen source/artifact/receipt pins and review of the actual changed code. This audit neither authorizes nor executes another UAC attempt.
