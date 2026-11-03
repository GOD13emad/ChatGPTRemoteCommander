# R34 — Windows Control Center native UI candidate

This change overlays responsive native WinForms visual elements onto **accepted production source** `362375c464948be3001b307650c13fc3353ed05b`, without copying the older 0.10.21 Preview branch or modifying installed Commander.

The new `DashboardChrome.cs` is presentation-only: metrics, local profile filter, dark/light system palette, rounded cards and accessibility labels. Existing routing/health/network commands remain in `Program.cs`. A Router HTTP 200 indicates it responds, **not identity/security acceptance**. Active operations show UNVERIFIED unless independently measured. Profile/Task mutations and Browser launching keep prior authority controls.

## Gates
- Emad Windows .NET10 build PASS, **0 warnings / 0 errors**; raw log SHA256 `5d5a01735413c2740d7bb44994b0644260219d9e6144237f8d8f30a55d80a566`.
- Native WinForms structure/theme/filter/accessibility tests PASS without opening a user window; receipt log SHA256 `587de2b4ca94bc432b409b06aa969ee4959e52273a046ca03d111425a2ac2797`.
- Hosted Windows CI mandatory, + all source safety tests.
- **Physical Native visual acceptance OPEN**: earlier offscreen R33 `DrawToBitmap` gave an empty-looking frame because no controls were Shown; that is a failed/inconclusive visual test, not acceptance.
- Exact source comparison against main and independent real dashboard scope before merge; no boot configuration, router, user profile or browser session modifications.

**Release:** Draft-only. No auto-install/merge until visual, rollback, signing and four-host availability gates pass. Current system Core remains `v0.10.20`.
