# Privacy and network disclosures — proposed review draft

**Status:** DRAFT, NOT AN APPROVED PRODUCT PRIVACY POLICY. This notice records known data paths and explicit verification gaps for review prior to any SignPath Foundation application or new publisher signing claim. It does not replace the privacy terms of services that an operator chooses to connect.

## User-configured access and data

Remote Commander is an owner-controlled MCP server connecting configured ChatGPT accounts to approved computers through per-account/per-host Secure MCP Tunnel profiles. Depending on the selected permissions, requests and responses can contain paths, local file data, terminal output, process status, browser or GUI/screenshot content, and workflow state. These may include confidential information. Enable only the requested capabilities, trusted accounts and host profiles; application-level Full Power is **not** Windows Administrator or Linux root.

The software stores locally enrolled API-key references, profile configuration and operational state according to its platform-specific storage controls; see [Security](../SECURITY.md) and [Installation](../START_HERE.md). Do not commit credentials, private screen content, tool output or sensitive logs to Git repositories.

## Network transmission

An enrolled Secure MCP Tunnel and its associated ChatGPT service are network connections. User-authorized tool calls and their results are sent through that configured channel. Installation and updates may download source code, package assets, runtime prerequisites and provenance data from GitHub and respective vendor services. Commands executed by an authorized owner, browser automation and connected extensions may themselves access other network endpoints.

**No blanket offline/no-telemetry guarantee is made.** A source, network and runtime review is still required before a publisher-approved policy can state whether any automatic telemetry, analytics, crash reporting, retention or update polling is present in every supported installer mode. That review must also identify any transfer not expressly chosen by the operator, display required warnings during installation, and provide a tested way to disable such functions.

## Controls and security responsibilities

Operators can select restricted capabilities, decline privileged grants, disconnect/revoke enrolled Tunnel access, stop the service or uninstall according to the current install documentation. Full Power, multiple accounts on the same privileged instance and GUI/shell automation have security implications described in [Security](../SECURITY.md). Controls must be reverified for each published installer and supported OS; statements here do not certify their operation in the unaccepted 0.12 candidate.

Relevant third-party disclosures must be confirmed for the actually used services, including [OpenAI's privacy policy](https://openai.com/policies/privacy-policy/) and [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Other enabled network providers and their terms must be added after a concrete component/data-flow inventory, not guessed from library names.

## Before adoption

- [ ] Trace default and optional outbound network flows in actual Windows and Linux native packages, including install, login, update, tunneling, browser features and telemetry.
- [ ] Identify categories of data sent, endpoints and purposes, local/remote storage locations, retention, deletion and data subjects.
- [ ] Show and validate installer disclosures and disable/opt-out mechanisms for non-user-requested data transfer.
- [ ] Verify uninstall, revocation and secret-protection behavior on the installed native product.
- [ ] Obtain owner/legal review and link the accepted policy from the project homepage, downloads and release pages.

**Until approved, this page is a review artifact, not a certification of data handling or a statement that SignPath has accepted the project.**
