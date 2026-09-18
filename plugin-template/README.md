# ChatGPT Remote Commander plugin template

This folder is a template for a private/local/workspace Plugin that references an already-created ChatGPT custom MCP app.

1. Complete the MCP app setup in `../START_HERE.md`.
2. Copy this template to a private working directory or controlled workspace repository.
3. Bind the registered app with `./bind-app.ps1 -AppId "asdk_app_..."` or `./bind-app.sh asdk_app_...`.
4. Keep the generated `.app.json` private when it contains workspace-specific identifiers.
5. Import/test the plugin using the current OpenAI plugin workflow described in `../docs/PLUGIN_SETUP.md`.
6. For ChatGPT Work, use `WORK_INSTALL_PROMPT.md` after the MCP app has been registered and scanned successfully.

Before app binding, `plugin.json` is a valid skill-only template. The bind helper creates `.app.json` and adds the app reference to the private copy. The template includes a workflow skill and ready icon/logo assets.
