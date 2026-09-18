# GUI acceptance gates — v0.5.0 RC1

**Do not promote v0.5.0 until both no-input and interactive acceptance pass on the exact RC commit, followed by real Secure MCP Tunnel / ChatGPT verification.**

## Automated Windows runner

`test/rc1-acceptance.ps1` creates a detached temporary worktree from `release/v0.5.0-rc1`. It never installs that candidate over the active runtime, never uses tunnel credentials, and never touches port 47831 during the interactive GUI test.

### Gate A — exact-snapshot no-input validation

Run from PowerShell 7 without Administrator:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/release/v0.5.0-rc1/test/rc1-acceptance.ps1'))) -ProjectRoot 'PATH_TO_EXISTING_REPO'
```

This fetches the RC ref, creates a detached temporary worktree, records the exact commit and merge-base, then runs:

- full branch `git diff --check`;
- `npm run check` (including PowerShell parser checks and the **no-input** native Win32/C# layout gate);
- `npm test` (core, Power, concurrency, filesystem, config, GUI-contract and HTTP regressions);
- `npm run audit` (current tree and reachable Git history secret/developer-path scan).

Success marker:

```text
RC1_NO_INPUT_PASS
```

No screenshot, mouse, keyboard, tunnel, credential, network-setting, reboot or active-runtime mutation is part of Gate A.

## Gate B — disposable interactive Windows GUI

Only after Gate A passes, run the same script with explicit input authorization:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/release/v0.5.0-rc1/test/rc1-acceptance.ps1'))) -ProjectRoot 'PATH_TO_EXISTING_REPO' -Interactive -AuthorizeGuiInput
```

The runner:

1. chooses an unused test port in `48031..48080` (never 47831);
2. starts the RC candidate with an isolated test config and **no shell/process/filesystem power beyond its temporary test root**;
3. opens only `test/gui-disposable-app.ps1`, a throwaway Windows Form with known test controls;
4. discovers the monitor containing that form;
5. uses the **actual MCP endpoint** to run `gui_status → gui_session_begin → gui_screenshot → one lease+frame action → screenshot`;
6. verifies a real button click from the disposable app's independent state file;
7. proves a used frame cannot be replayed;
8. types and independently verifies Persian + Japanese + emoji text;
9. verifies `CTRL+A` + replacement text;
10. verifies mouse drag down/up events;
11. stores actual before/after screenshots with SHA-256;
12. creates local `var/GUI_STOP`, confirms GUI availability is blocked, removes it locally, then confirms recovery;
13. ends the GUI lease and stops only the isolated test server/form.

Success marker:

```text
RC1_INTERACTIVE_GUI_PASS
```

Evidence is retained under the active repo's `var/RC1_ACCEPTANCE/<timestamp>/` even if a test fails.

## Gate C — manual/native boundary checks

Gate B proves normal user-session screen/input behavior on the tested machine. Also record:

- Windows display scaling and monitor topology reported by `gui_status`;
- behavior when focus is deliberately changed after a screenshot (old frame must be refused);
- physical Escape during a bounded drag/hold when safe to test;
- locked/disconnected desktop must report unavailable rather than success;
- do **not** disable UAC, UIPI, anti-cheat or OS protections to make a test pass.

## Gate D — real ChatGPT / Secure MCP Tunnel

After the RC candidate passes locally, install/update from the exact accepted artifact in a controlled maintenance step, preserve credential hashes, then Refresh / Scan Tools on the exact ChatGPT Custom App.

Required real-path evidence:

1. `system_status` reports v0.5.0, correct device, instance and GUI policy;
2. `gui_status` reports the intended interactive Windows session;
3. `gui_session_begin` returns a lease;
4. `gui_screenshot` renders as an image in ChatGPT;
5. one controlled input against the disposable acceptance app succeeds using `lease + frame`;
6. a fresh screenshot visibly confirms the result;
7. a second ChatGPT account/tunnel cannot acquire another GUI lease while the first holds it;
8. both account tunnels still report ready after restart/update;
9. Runtime API key / credential files were never pasted into chat and their hashes remain unchanged across update.

## Gate E — release

Only after A-D pass:

- squash/promote the reviewed RC tree;
- build Release assets from that exact commit;
- include stable + versioned Plugin ZIP and SHA256 manifest;
- verify Windows and Linux one-line installers from `releases/latest`;
- verify Plugin marketplace/install and tool scan;
- tag and publish `v0.5.0`;
- merge/update `main` and project brain with exact evidence.

Native GUI control in v0.5.0 is Windows-only. Secure Desktop/UAC, lock-screen bypass, anti-cheat bypass, raw-input guarantees and high-speed real-time gameplay are explicitly outside the supported claim.
