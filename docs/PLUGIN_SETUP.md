# Plugin setup for ChatGPT Remote Commander

This document covers the **Plugin** layer. For the actual private computer connection, complete `START_HERE.md` first and create the custom MCP app through Secure MCP Tunnel.

## App versus Plugin

The custom MCP **app** is the registered ChatGPT connection to the Remote Commander MCP server.

A **Plugin** is packaging around workflows and presentation. It can include skills, icons, prompts, and a reference to an existing registered app.

### Windows GUI Control capability

When the registered app exposes the v0.5 `gui_*` tools, the Plugin can perform graphical interaction directly through Remote Commander. Screenshots are MCP image content, while mouse/keyboard/window actions are separate privileged tools guarded by an exclusive lease and a short-lived single-use frame token.

The Plugin skill must use `gui_session_begin` before capture/input, pass both `lease` and `frame` to one mutation, verify with a new screenshot, and end the lease. It must never clear the owner's local emergency-stop file.

This is Windows-only and opt-in in v0.5. It does not bypass Secure Desktop/UAC, lock screen, anti-cheat/protected input, or real-time latency constraints. Native Computer Use remains an optional fallback rather than a hard prerequisite.

The repository contains:
- `plugin-template/plugin.json` — portable Agent Plugins manifest;
- `plugin-template/.app.json.example` — workspace-specific app mapping template;
- `plugin-template/skills/remote-commander/SKILL.md` — workflow guidance;
- `plugin-template/assets/icon.png` and `logo.png` — ready visual assets.

## 1. Create and test the custom MCP app first

Follow `START_HERE.md` through the real `system_status` tool test.

Do not build the Plugin layer around an app that has not already passed its MCP tool scan.

## 2. Get the registered app ID

The ID used by `.app.json` must identify the exact registered ChatGPT Remote Commander app, not the plugin and not a similarly named Directory app. Verify the app's tool scan contains this project's `system_status` before binding.

Supported app ID prefixes currently include:
- `asdk_app_`
- `connector_`
- `templated_apps_`

If an admin URL contains a form such as `plugin_asdk_app_...`, use the underlying app ID beginning at `asdk_app_`.

## 3. Prepare a private/workspace app-bound Plugin

Preferred: use the latest-Release one-liner from `WORK_SETUP.md`; no repository checkout is required. The self-contained installer accepts either the ChatGPT technical `plugin_...` identifier or the underlying App ID, downloads `plugin-template.zip` from the latest Release when needed, creates a private per-user copy, binds it, adds a personal marketplace, installs the Plugin through Codex, and verifies the result. The repository-local `install-work-plugin.ps1/.sh` commands remain available for development/offline use with a local template.

OpenAI's `.app.json` format requires the underlying App ID. If the UI/URL shows `plugin_asdk_app_example`, the App ID stored in `.app.json` is `asdk_app_example`.

For a manual workflow, copy `plugin-template/` to a private working directory or controlled workspace repository and bind it with one of the supplied helpers:

```powershell
.\bind-app.ps1 -AppId "asdk_app_YOUR_ID"
```

or:

```bash
./bind-app.sh asdk_app_YOUR_ID
```

The helper creates `.app.json` and adds `extensions.com.openai.apps = "./.app.json"` to that private copy. The resulting mapping is:

```json
{
  "apps": {
    "remote-commander": {
      "id": "asdk_app_REPLACE_WITH_YOUR_APP_ID",
      "required": true
    }
  }
}
```

Do not commit a workspace-specific app ID into this public repository unless you intentionally want that mapping public.

## 4. Plugin manifest and icon

The supplied `plugin.json` uses the portable Agent Plugins schema and OpenAI-specific interface metadata. It is valid as a skill-only template before any workspace-specific app ID is added. Run the supplied bind helper on a private copy to add the `apps` mapping.

It defines:
- display name;
- descriptions;
- Productivity category;
- Read and Write capabilities;
- starter prompts;
- brand color;
- composer icon;
- logo;
- optional app binding after the private copy is configured.

Use the provided PNG assets as-is, or replace them with your own assets while keeping the manifest paths correct.

## 5. Test privately

For supported local ChatGPT Desktop/Codex testing, this repository already exposes `.agents/plugins/marketplace.json`. Add the GitHub marketplace with `codex plugin marketplace add GOD13emad/ChatGPTRemoteCommander --ref main`, then run `codex plugin add chatgpt-remote-commander@chatgpt-remote-commander`. Verify with `codex plugin list` and reload ChatGPT Desktop if required. The repository also marks the Plugin installed-by-default for local marketplace use; product policy or user approval can still control installation.

For workspace distribution, admins can import a supported GitHub marketplace or publish a local plugin to the workspace. App access and authentication are still controlled by the workspace; importing a plugin does not grant access to the app.

After installing the plugin, review the included app's permission setting. On an eligible trusted-machine setup, the user may explicitly choose **Allow all actions** for the app to reduce repeated confirmation prompts; OpenAI marks this as elevated risk and workspace/action/safety controls still apply.

Then:
1. Open a fresh chat.
2. Select or @mention the plugin/app when needed.
3. Run `system_status`.
4. For Power Mode, run read-only `power_status`.
5. Confirm write actions require the expected permissions/confirmations.

## 6. Public Plugin Directory limitation

Secure MCP Tunnel is designed for private MCP connectivity and development/testing. It does **not** provide the stable public HTTPS MCP endpoint required for a public MCP-backed Plugin Directory submission.

To publish this project as a public MCP-backed plugin, first provide a production public HTTPS MCP endpoint and satisfy the current submission requirements, including developer identity, policy/support URLs, accurate tool annotations, positive and negative test cases, and OpenAI review.

Do not expose a personal Power Mode computer directly to the public internet to satisfy this requirement.

## 7. Current official references

- Plugin packaging: https://developers.openai.com/plugins/build/plugins
- Plugin submission: https://developers.openai.com/plugins/deploy/submission
- GitHub marketplace import: https://help.openai.com/en/articles/20001504
- Plugin overview: https://help.openai.com/en/articles/20001256/
- Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels


### Native Computer Use fallback

Native Computer Use remains a fallback for graphical tasks when the Remote Commander GUI backend is unavailable, unsupported, or intentionally disabled. It is not a substitute for proving that the selected Remote Commander app reaches the intended computer.
