# Privacy

ChatGPT Remote Commander is open-source software that a user runs on a computer they control.

The project itself does not operate a hosted data collection service. Local audit logs, backups, configuration, tunnel profiles, and saved credentials remain on the user's machine unless the user separately sends or syncs them elsewhere.

When used with OpenAI products, requests and responses are subject to the applicable OpenAI product and workspace policies. Secure MCP Tunnel transports MCP requests between supported OpenAI products and the user's private MCP server.

Runtime API keys and tunnel credentials must not be committed to this repository or pasted into chat. Windows persistent enrollment stores the Runtime API key with current-user DPAPI. Linux uses a user-only local credential file outside the repository.

Users are responsible for reviewing the tools they enable, the files and systems those tools can access, and the policies of any connected workspace or service.
