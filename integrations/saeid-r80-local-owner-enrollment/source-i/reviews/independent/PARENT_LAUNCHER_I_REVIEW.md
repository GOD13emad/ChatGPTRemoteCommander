# Parent launcher I independent source review

**PASS_SCOPED_SOURCE_REVIEW** for exact source SHA `ed04517409cd8073f5d845741881440bc31eeeba84895b591d654fbf0d00df16` at `00_DELIVERY/OPEN_REVIEWED_OWNER_ENROLLMENT_R80_I_ONCE.ps1`.

The narrow UI fix calls ShowWindow(SW_SHOW=5) on this launcher's own form, ignores the previous-visibility return, and requires IsWindowVisible before starting the timer or consuming preflight/UAC. New LIVE_I paths preserve H. Held plan/image hash boundaries, CreateNew intent records, baseline checks, real UAC and no-retry child lifecycle remain intact.

Microsoft's [ShowWindow contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow) permits startup information to override the first show and defines the return as previous visibility. [IsWindowVisible](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iswindowvisible) checks WS_VISIBLE, not unobscured display or human attention. The source uses those contracts correctly.

No runtime action was executed by this reviewer. The final I plan and rebuilt role closure are separate acceptance inputs; this verdict does not validate future plan bytes or authorize replay. H's consumed exit 2 remains unchanged. Actual I UI/UAC/enrollment/task/rollback/login acceptance is UNPROVEN.
