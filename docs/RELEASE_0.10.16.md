Remote Commander v0.10.16

Purpose
-------
v0.10.16 turns the Windows packaging surface into one product instead of several Start Menu utilities. It introduces a single-file Windows Setup bootstrap for fresh Windows systems, with explicit Core-only versus Control & Monitoring installation modes and post-install multi-profile onboarding.

Change
------
- Windows Start Menu now publishes one Remote Commander application. Profiles & Access, Operations Monitor, and Admin Runtime stay inside the product shell instead of appearing as separate applications.
- The Windows desktop icon asset is rebuilt as a standards-compliant multi-size ICO and is used consistently by the product shell and Setup.
- The new Inno Setup bootstrap installs Commander on a fresh x64 Windows system, installs verified machine prerequisites when missing, and keeps per-user Commander/profile state in the original user context.
- Setup offers Commander Core or Commander + Control & Monitoring. A desktop shortcut remains optional.
- Setup accepts one or more profile names and launches a dedicated post-install profile enrollment UI. Runtime API keys are passed in memory and are never placed on a child-process command line.
- Profile enrollment retains the existing fail-closed tunnel validation and DPAPI persistence boundary.
- The release workflow builds the single-file Setup on a pinned Windows runner toolchain, adds its SHA-256 to the release checksum manifest, and publishes it together with the existing immutable release assets.
- The Setup source includes a compile-time optional Remote Commander Browser component. The component is exposed only when a verified standalone Browser installer is supplied to the build.

Browser boundary
----------------
The current Remote Commander Browser remains a separate pre-release line and is not bundled into v0.10.16. The installed v0.8.0-rc.4 Browser can be launched from Commander, but its Commander Companion is read-only and the Browser is not yet a fully bidirectional Commander backend. The existing Commander browser automation backend remains the separately qualified Chromium/CDP path. Bundling the Browser before its standalone installer and integration contract are stable would turn an unproven pre-release dependency into a production dependency, so v0.10.16 intentionally keeps that boundary explicit.

Release discipline
------------------
v0.10.15 remains immutable. v0.10.16 may be promoted only after exact-head Windows qualification, hosted CI and Windows Server canary PASS, Linux laptop and Amirreza Server exact-head acceptance, immutable tag/release publication, and post-release live readback. The single-file Setup is a release asset only after those gates pass.

Signing
-------
The build records Authenticode status. If no organization-controlled code-signing certificate is available at release time, the Setup remains functionally installable but Windows may show an Unknown Publisher/SmartScreen warning. A self-signed certificate is not treated as production signing evidence.

Known non-goals
---------------
This release does not change browser session/login automation policy, scheduler semantics, physical reboot/AC-loss behavior, Linux GUI architecture, or tunnel credential authority. Physical power-return validation remains a separate hardware/operations gate.
