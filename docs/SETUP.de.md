# ChatGPT Remote Commander — aktuelles Setup

> Verbindliche Anleitung: [START_HERE.md](../START_HERE.md). Ein KI-Assistent soll diese Datei zuerst lesen und keine alten Setup-Wege mischen.

Standard Mode ist die sicherere Voreinstellung. Full/Power Mode ist nur für einen vertrauenswürdigen Rechner gedacht und aktiviert vollständigen Dateisystem-, Shell- und Prozesszugriff.

**Windows Standard**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

**Windows Power**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

**Linux**

```bash
curl -fsSL https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --start-server
```

Danach Secure MCP Tunnel und Runtime API Key erstellen. Den Key niemals in den Chat einfügen; nur lokal in die verdeckte Eingabe. In ChatGPT eine Custom App mit Connection = Tunnel, Authentication = None und Scan Tools erstellen.

Icon: [plugin-icon.png](../assets/plugin-icon.png). Plugin-Anleitung: [PLUGIN_SETUP.md](PLUGIN_SETUP.md).

FINAL PASS erst nach MCP health, Tunnel ready, erfolgreichem Tool-Scan und echtem `system_status`-Aufruf.