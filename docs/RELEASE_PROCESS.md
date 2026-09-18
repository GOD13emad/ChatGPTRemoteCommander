# v0.5.0 release process

This is the maintainer path from an audited release candidate to a public Release. It does not replace `START_HERE.md` for normal users.

## 1. Freeze the candidate

- Work from `release/v0.5.0-rc1`.
- Reconcile current `main`; do not delete newer tests/features.
- Squash release-candidate development noise before acceptance so reachable release history contains no transient broken installer or personal path.
- Record the exact candidate commit.

## 2. Local exact-snapshot acceptance

On a trusted Windows test machine, run `test/rc1-acceptance.ps1`.

First no-input:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/release/v0.5.0-rc1/test/rc1-acceptance.ps1'))) -ProjectRoot 'PATH_TO_EXISTING_REPO'
```

Require `RC1_NO_INPUT_PASS`.

Then explicitly authorize the disposable GUI test:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/release/v0.5.0-rc1/test/rc1-acceptance.ps1'))) -ProjectRoot 'PATH_TO_EXISTING_REPO' -Interactive -AuthorizeGuiInput
```

Require `RC1_INTERACTIVE_GUI_PASS`. Preserve the emitted `summary.json`, screenshots and logs.

Any code change after this invalidates acceptance and requires a rerun.

## 3. Controlled target update + real ChatGPT path

Using the exact accepted commit, perform the controlled maintenance update. Before update record SHA-256 of enrolled credential files without printing their contents.

Verify:

- `system_status` reports the accepted v0.5.0 commit's runtime identity;
- both existing tunnel health endpoints return ready;
- Custom App tool refresh exposes the GUI session/frame tools;
- ChatGPT renders a real `gui_screenshot` image;
- one controlled action on the disposable acceptance app succeeds with the matching lease+frame;
- a fresh screenshot visibly confirms the result;
- a second account cannot obtain a GUI lease while the first lease is active;
- after restart both tunnels recover;
- credential file hashes are unchanged.

Copy `docs/REMOTE_ACCEPTANCE.example.json`, fill only evidence-backed values, and never store API keys or credential contents in it.

## 4. Build exact release artifacts

From the same accepted commit:

```powershell
.\tools\build-release.ps1 `
  -AcceptanceSummary 'PATH_TO_LOCAL_RC1_SUMMARY.json' `
  -RemoteAcceptanceSummary 'PATH_TO_REMOTE_ACCEPTANCE.json'
```

The builder refuses a commit mismatch and reruns check/test/audit. It stamps the exact commit into both installers, packages only tracked Plugin files, creates manifest/checksums, and calls the independent verifier.

Require both:

```text
RELEASE_VERIFY_PASS
RELEASE_BUILD_PASS
```

## 5. Publish

- Tag the exact accepted commit as `v0.5.0`.
- Upload the generated assets without rebuilding them.
- Confirm `RELEASE_MANIFEST.json` sourceCommit equals the tag commit.
- Confirm `SHA256SUMS.txt` from the published assets.
- Run `verify-release.ps1` against downloaded published assets.
- Test the public `releases/latest` Windows installer in a clean/controlled location.
- Test the Linux one-line installer path without claiming native Linux GUI support.
- Test the published stable Plugin ZIP and Marketplace sync.

Only then merge/promote the accepted tree to `main` if not already identical and mark v0.5.0 FINAL.

## 6. Never promote on these signals alone

None of these is FINAL acceptance by itself:

- GitHub Actions status (current account billing may prevent jobs from starting);
- `SECURITY_AUDIT_PASS`;
- MCP health only;
- tunnel ready only;
- tool discovery only;
- native API returning "submitted";
- Codex Plugin installed/enabled;
- source review without real screenshot/action verification.

See `docs/AUDIT_RC1.md` and `docs/GUI_ACCEPTANCE.md`.
