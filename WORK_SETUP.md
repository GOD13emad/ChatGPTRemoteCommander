# WORK_SETUP — ChatGPT Work / Codex guided setup

Use this file when the user gives ChatGPT Work or Codex the repository URL and asks it to complete setup, create/install the Plugin, and reach a real FINAL PASS.

Repository:
https://github.com/GOD13emad/ChatGPTRemoteCommander

## Authority

Read `START_HERE.md` first. It is the machine/tunnel/app source of truth. This file adds the Work/Plugin path.

Do not confuse Work's cloud computer with the user's target computer. Until the Remote Commander MCP app is connected, target-machine commands must run through an authorized local surface or be executed by the user.

Never request Runtime API keys, tunnel credentials, bearer tokens, or private keys in chat. Secrets are entered only in local hidden prompts.

## 1. Complete machine + tunnel + app setup

Work should:
1. explain Standard versus Full/Power Mode and let the user choose;
2. use the latest Release installer asset from `START_HERE.md`;
3. verify `INSTALL_PASS`, MCP health, and requested mode;
4. guide Secure MCP Tunnel creation and persistent enrollment;
5. create the ChatGPT custom MCP app with Connection = Tunnel;
6. use None / No authentication for this server;
7. run Scan Tools;
8. verify a real `system_status` call from a fresh supported chat/Work task.

Full/Power Mode is for a trusted computer. It enables full filesystem access, shell execution, process control, binary operations, recursive search, backups, and persistent terminals. It is not an OS sandbox.

## 2. Repository Plugin bootstrap

This repository includes:
- `.agents/plugins/marketplace.json`
- `plugin-template/`
- `.codex/config.toml`

For local ChatGPT Desktop / Codex development, add the GitHub marketplace:

```bash
codex plugin marketplace add GOD13emad/ChatGPTRemoteCommander --ref main
```

Then install the repository Plugin from that marketplace with:

```bash
codex plugin add chatgpt-remote-commander@chatgpt-remote-commander
```

You can verify it with `codex plugin list`. Reload ChatGPT Desktop if required; the Plugin then appears under the **ChatGPT Remote Commander** marketplace/source. The repository policy marks the local Plugin installed by default and the trusted-project Codex config enables it. Product/workspace policy and explicit user/admin confirmation still take precedence.

## 3. Create the app-bound Plugin in Work

After the registered MCP app exists and its tool scan passes, obtain its technical identifier from the ChatGPT developer/plugin UI.

For the Work `@plugin-creator` workflow, OpenAI currently documents using the technical identifier shown as `plugin_asdk_app_...`.

In ChatGPT Work, run:

```text
@plugin-creator create a plugin for ChatGPT and Codex using my MCP server.
Use REGISTERED_PLUGIN_ASDK_APP_ID and name it ChatGPT Remote Commander.
Use the workflow skill and icon/logo assets from:
https://github.com/GOD13emad/ChatGPTRemoteCommander/tree/main/plugin-template
Include a personal marketplace entry so I can install and test it locally.
Keep the existing MCP app connection and authentication settings unchanged.
Do not include any Runtime API key, tunnel credential, bearer token, or private key.
```

Replace `REGISTERED_PLUGIN_ASDK_APP_ID` with the actual `plugin_asdk_app_...` identifier for the already-registered MCP app.

Work should review the generated package:
- `.app.json` maps to the correct registered app;
- the plugin manifest references `./.app.json`;
- the Remote Commander skill is included;
- icon/logo assets are included;
- no secret is embedded.

## 4. Install the generated Plugin

If plugin-creator created a personal marketplace entry:
1. reload ChatGPT if required;
2. open Plugins;
3. select the personal/local marketplace source;
4. select **ChatGPT Remote Commander**;
5. select **Install plugin**.

If Work surfaces an install control in the conversation, it may present that control directly after the user explicitly asked for installation. Do not bypass the product's install confirmation, workspace policy, administrator approval, or app authorization.

After installation, open a fresh Work task and ask:

`@ChatGPT Remote Commander run system_status and report version, mode, platform, shell, and concurrency state.`

For Full/Power Mode, also run read-only `power_status`.

## 5. Managed workspace GitHub marketplace

An eligible workspace admin can import this repository:

1. Workspace settings → Plugins.
2. Add → Import marketplace.
3. Source: `https://github.com/GOD13emad/ChatGPTRemoteCommander`
4. Path: leave empty because `.agents/plugins/marketplace.json` is at repository root.
5. Branch: `main` for ongoing sync, or a fixed release tag for pinned deployment.
6. Import the marketplace.
7. Review the imported Plugin and configure installation policy for intended roles.
8. Ensure the custom Remote Commander MCP app is enabled for the same roles.
9. Use **Sync now** when an immediate GitHub refresh is needed.

GitHub marketplace import syncs Plugin content. It does not create the Secure MCP Tunnel, create the MCP app, grant app access, or authenticate users. Workspace import also applies workspace policy rather than blindly trusting repository policy values.

## 6. Private/workspace manual app binding

For a private copy of `plugin-template/`, bind the already-registered app ID with:

```powershell
.\bind-app.ps1 -AppId "asdk_app_YOUR_ID"
```

or:

```bash
./bind-app.sh asdk_app_YOUR_ID
```

The bind helpers accept app IDs beginning with `asdk_app_`, `connector_`, or `templated_apps_`. They create `.app.json` and add `extensions.com.openai.apps = "./.app.json"` to the private copy.

Do not commit a workspace-specific `.app.json` into this public repository unless that mapping is intentionally public.

## 7. Work operating rules after installation

When Full/Power Mode is active, Work can perform substantial tasks such as builds, tests, debugging, project edits, process management, and persistent terminal workflows.

Work must still:
- inspect state before mutation;
- preserve unrelated files;
- use normal product confirmations for important actions;
- avoid DNS/firewall/VPN/network changes unless explicitly requested;
- avoid reboot/shutdown/logoff unless explicitly requested and supported;
- run regression checks after mutation;
- report evidence, not unsupported PASS claims.

## FINAL PASS in Work

Do not stop at Plugin creation. Confirm:
- latest installer PASS;
- MCP health PASS;
- tunnel ready PASS;
- persistent enrollment PASS;
- custom MCP app Scan Tools PASS;
- repository/plugin package validation PASS;
- Plugin installed, or the product presents the final explicit user/admin install approval;
- a fresh Work task invokes real `system_status`;
- Power users can invoke read-only `power_status`;
- no secrets were pasted into chat or committed;
- update and stop/start flows are documented.

If the current surface cannot complete an install/admin action, state exactly which UI approval remains and complete everything else.

Official references:
- https://help.openai.com/en/articles/20001256/
- https://help.openai.com/en/articles/20001504
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/quickstart
