# Remote Commander Core v0.10.24 — source qualification candidate

## Source and provenance
This source-only candidate derives from protected main commit a9afa6e7b62ad4570c8ea46bee7b2df8ba58243b. There is no v0.10.24 tag, installer or GitHub Release at branch creation. The immutable v0.10.23 Draft at its earlier exact tagged source remains unchanged. Published Core Stable is v0.10.20, Browser Stable v0.8.1.

## Included corrections
- PR #221: Router source/status bootstrap locked to exact loopback/port/path, redirects forbidden; complete Git history audit reads in bounded streaming mode.
- PR #222: deferred path HTTP test readiness checks the exact fixture identity with a bounded overall time limit.
- PR #223: Coucou outbound hook inherits only a neutral filesystem root, not project cwd, and Windows UNC hooks are refused; optional display remains off by default.
- PR #226: Control Center verifies exact Router/profile/backend identity before reporting healthy. Offscreen native WinForms and protected-main CI qualified source behavior.

## Windows installer: UNSIGNED — no new-version distribution approval
An unsigned candidate has no Authenticode publisher identity. SmartScreen / Smart App Control may warn or block. GitHub attestation and SHA256 provenance are not OS-signing and do not replace Authenticode. The v0.10.24 version-scoped policy currently disallows unsigned distribution, even with GitHub provenance. A separate explicit owner decision or a valid publisher signature is needed before a new annotated tag and any Draft/Stable publication. Do not bypass OS protections or silently carry forward the v0.10.23 exception.

## Open acceptance and safe hold
Native owner Windows Control Center/CEF login and profile preservation, Persian RTL/HiDPI visual acceptance, historical J01 uncertain input (never replay or clear), data-preserving serial fleet rollout, authenticated same-chat Work ACK, runner consent, Mesh power-loss/soak, Saeid Windows and private R478 transfer remain unaccepted. Linux owner v0.10.23 promotion+rollback and previous two-host 10GiB Mesh tests retain only their historical version-scoped evidence.

This branch does not install, promote, tag or publish anything. Require exact new versioned assets, independent Sigstore verification, full CI, owner-native and rollback acceptance before any release decision.
