# Code signing policy — proposed (not yet approved)

**Status:** DRAFT / REVIEW REQUIRED / NO PROMOTE. The Remote Commander Windows packages have **not** received SignPath Foundation approval or a trusted publisher Authenticode signature. GitHub Sigstore artifact attestations and published SHA-256 checksums verify build provenance; neither makes Windows show a trusted publisher.

## Project and intended signing provider

Source and release repository: [GOD13emad/ChatGPTRemoteCommander](https://github.com/GOD13emad/ChatGPTRemoteCommander). The source is published under MIT; the project's public display brand, TandemVector Labs, is **not** evidence of a registered certificate-holder legal identity.

The prospective free OSS route is: **“Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/)”**. This statement describes the *proposed provider*, not a service already granted to the project. No application, certificate, signing request, or approval is claimed.

The project may continue distributing individually approved *unsigned* preview releases with explicit warnings, checksums and build attestations. No development, pull-request or historical Preview artifact is thereby approved as Stable.

## Roles (for approval by the project and SignPath)

- **Source maintainer / release custodian:** [@GOD13emad](https://github.com/GOD13emad), as identified in [Publisher and maintainers](PUBLISHER_AND_MAINTAINERS.md).
- **Supporting maintainer / possible independent reviewer:** [@mohammadmohammadzadeh19960-code](https://github.com/mohammadmohammadzadeh19960-code). A requested review or a COMMENTED review is **not** an approval.
- **Signing approver(s): NOT YET ASSIGNED.** An authorized human project member must be assigned in the SignPath policy and approve **each** request after validating its source and artifacts. Source authorship and GitHub administrator access are not proof of a separate approval.
- **MFA compliance:** not independently verified for all participants and must be established before enrollment.

## Proposed source, review and release constraints

1. Build only from an immutable reviewed source commit in this public repository using a verified, isolated, source-pinned build pipeline. Changes to the build workflow and dependency resolution require review as code.
2. Keep required PR approvals, tests, supply-chain scanning, exact package digests, and platform provenance on the **same** candidate. An intentionally skipped test is not accepted as PASS.
3. Preserve upstream OSS authoring boundaries; do not sign another project's executable as though the Commander team produced it. Included third-party components retain their own licensing and origin.
4. Verify an accepted Windows native install, application behavior, owner-controlled rollback and install/update UX independently of source-only QA. Do not publish or repoint Stable until the separately recorded full release gates are accepted.
5. Obtain an explicit human SignPath signing approval for each eligible candidate and verify the resulting Authenticode signature **after signing**. Only then call the installer signed.
6. Record the exact release tag, source commit, signing policy, artifact hash, signer certificate identity, provenance and any approved exceptions. Do not store signing secrets in source or the package.

## Privacy, security and scope

The project supports user-configured ChatGPT / Secure MCP Tunnel connections and, when enabled by an authorized owner, high-impact shell, filesystem, GUI and browser operations. **Do not** claim that Remote Commander never transfers information to networked systems. See [Proposed privacy and network notice](PRIVACY_NOTICE.md) and [Security](../SECURITY.md). Any third-party provider and its relevant privacy policy must be disclosed, and the operator must retain suitable opt-out, uninstall and consent mechanisms.

The project also needs provider review against SignPath Foundation's restrictions on hacking tools, end-user privacy and security, installer disclosure and signed software scope. Legitimate owner-authorized remote administration does **not** itself establish or deny eligibility.

## Open admission checks

- [ ] Verify **all shipped components** and licenses/attribution obligations, not merely npm development packages or the presence of SPDX files. Some bundled tunnel SPDX packages have `licenseDeclared=NOASSERTION`; the separate vendor license report is not a legal determination.
- [ ] Review and approve the network/privacy notice, concrete data transfer, retention and disable/uninstall paths; present applicable disclosures in the real installer.
- [ ] Verify MFA, assigned project authors/reviewers/approvers and independent review protection.
- [ ] Obtain SignPath Foundation's actual eligibility determination, including the product's remote administration and Full Power capabilities.
- [ ] Integrate the accepted SignPath artifact configuration with exact GitHub source and build provenance; perform one scoped test-sign and independent signature verification.
- [ ] Keep native owner acceptance, rollback, publisher approval and Stable promotion separate.

**Authority boundary:** This draft proposes process only. It grants no new runtime, OS, account, signing, download or release permission. Official provider requirements: [SignPath Foundation conditions](https://signpath.org/terms).
