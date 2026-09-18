# Prompt for ChatGPT Work

Paste the block below into ChatGPT Work after opening the GitHub repository.

```text
Set up and finalize ChatGPT Remote Commander from:
https://github.com/GOD13emad/ChatGPTRemoteCommander

Read START_HERE.md first and use it as the single source of truth.
Also read WORK_SETUP.md before packaging or installing the Plugin.

Work checkpoint-by-checkpoint until FINAL PASS.
Explain Standard versus Full/Power Mode and let me choose.
Never ask me to paste Runtime API keys, tunnel credentials, bearer tokens, or private keys into chat.
Use latest Release installer assets, not cached raw/main installers.
Do not make network, firewall, VPN, DNS, reboot, shutdown, or logoff changes unless I explicitly request them.
For live GUI tasks such as actually playing a game, verify that Computer Use / graphical screen control is available in this Work task. Remote Commander alone is backend control and must not be presented as live visual mouse/keyboard/gameplay control.

After the MCP app is registered and system_status works:
1. if you have an authorized command path to the target computer, prefer the repository's install-work-plugin.ps1/.sh with the registered plugin_asdk_app... technical ID; it creates and installs the app-bound personal Plugin automatically;
2. otherwise use @plugin-creator with the registered plugin_asdk_app... technical ID;
3. name the Plugin ChatGPT Remote Commander and include the supplied skill/icon/logo assets;
4. create or use a personal marketplace entry;
5. validate that .app.json contains the underlying asdk_app_/connector_/templated_apps_ ID, never the plugin_ wrapper;
6. offer/install the Plugin through the normal ChatGPT install flow;
7. open a fresh Work task and verify system_status through the installed Plugin/app.

Do not call the job complete until the machine, tunnel, app, Plugin, installation, and real tool invocation all pass.
```
