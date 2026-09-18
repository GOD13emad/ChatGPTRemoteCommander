# ChatGPT Remote Commander — Klick-für-Klick-Einrichtung

> Ein öffentliches GitHub-Repository bedeutet **nicht**, dass sich jeder mit dem PC des Autors verbinden kann. Dafür sind ein autorisierter Tunnel, Workspace/Plugin-Zugriff und ein laufender `tunnel-client` auf dem Ziel-PC erforderlich.

## Direkte Installation mit einem Befehl

Fügen Sie einen dieser Befehle in PowerShell ein. Standard ist standardmäßig sicher; Power Mode aktiviert auf einem vertrauenswürdigen PC vollständigen Datei-, Shell- und Prozesszugriff.

**Standard:**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

**Power Mode:**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

## 1. Auf Windows installieren

1. Repository öffnen: https://github.com/GOD13emad/ChatGPTRemoteCommander
2. **Code** → **Download ZIP** klicken oder mit Git klonen.
3. Projektordner entpacken/öffnen.
4. Falls nötig Node.js 22+ und PowerShell 7 installieren.
5. PowerShell 7 im Projektordner öffnen.
6. Ausführen:

```powershell
npm run check
npm test
npm start
```

7. http://127.0.0.1:47831/health öffnen und `ok: true` prüfen.

## 2. Secure MCP Tunnel erstellen

1. Bei OpenAI Platform anmelden.
2. Öffnen: https://platform.openai.com/settings/organization/tunnels
3. **Create tunnel** klicken.
4. Einen Namen wie `ChatGPT Remote Commander` vergeben.
5. Die besitzende Platform organization zuordnen.
6. Den ChatGPT workspace zuordnen, der den Tunnel sehen/verwenden soll.
7. Speichern und `tunnel_id` kopieren.
8. Erstellen/Bearbeiten benötigt **Tunnels Read + Manage**; Ausführen/Auswählen benötigt **Tunnels Read + Use**.
## 3. Runtime API Key erstellen und Tunnel starten

1. Öffnen: https://platform.openai.com/api-keys
2. Einen eingeschränkten Runtime API Key nur mit den nötigen Tunnel-Rechten erstellen.
3. Den Schlüssel niemals in Chats, GitHub, Screenshots oder Projektdateien einfügen.
4. Falls nötig den neuesten tunnel-client laden: https://github.com/openai/tunnel-client/releases/latest
5. Während der MCP Server läuft, ein zweites PowerShell-7-Fenster öffnen und ausführen:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. `tunnel_id` und danach den API Key eingeben; die Schlüsseleingabe ist verborgen.
7. Das Fenster geöffnet lassen; der Tunnel muss während der Nutzung healthy/ready bleiben.

## 4. Plugin/App in ChatGPT erstellen

1. Öffnen: https://chatgpt.com/plugins
2. Auf **+** klicken.
3. Einen Namen wie `ChatGPT Remote Commander` eingeben.
4. Unter **Connection** **Tunnel** wählen.
5. Den erstellten Tunnel auswählen oder eine gültige tunnel ID einfügen.
6. Für diesen Server **None / No authentication** wählen, nicht Mixed/OAuth.
7. Risikohinweis und Berechtigungen prüfen.
8. Falls vorhanden Scan/Refresh Tools ausführen und dann **Create** klicken.
9. Einen neuen Chat öffnen und die App auswählen oder mit `@mention` aufrufen.
10. Test: `Run system_status and report the active capabilities.`

## 5. Power Mode und zweites Konto

Die öffentliche `config.json` ist standardmäßig sicher. Full Control darf nur lokal in `config.local.json` aktiviert werden; diese Datei wird von Git ignoriert. Permanente Löschung ausgeschaltet lassen; shutdown/restart/logoff bleiben blockiert.

Für einen Freund oder ein zweites Konto einen separaten Tunnel in dessen Konto/Workspace erstellen und dessen tunnel-client auf demselben Ziel-PC ausführen. Den eigenen Runtime API Key nicht teilen. Laut aktueller OpenAI-Dokumentation unterstützt Pro custom MCP read/fetch; vollständiges write/modify ist derzeit für Business und Enterprise/Edu vorgesehen.

## Fehlerbehebung

- Tunnel nicht sichtbar: ChatGPT-workspace-Zuordnung und **Tunnels Read + Use** prüfen.
- OAuth-discovery-Fehler: Authentication = **None** setzen.
- `FORBIDDEN: This conversation does not support developer MCPs`: neuen Chat öffnen, auch im selben Project, und die App früh aufrufen.
- Alte Tool-Liste nach Update: Custom App refreshen oder neu erstellen, damit das aktuelle Schema gescannt wird.

Offizielle Dokumentation: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels und https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

## v0.3: mehrere Computer, mehrere Konten, parallele Chats und kein erneutes Eingeben der Tunnel-Daten

- Ein ChatGPT-Konto kann mehrere Computer steuern: Installieren Sie das Projekt auf jedem Computer und erstellen Sie pro Gerät einen eigenen Secure MCP Tunnel.
- Mehrere ChatGPT-Konten können einen Computer verwenden: Registrieren Sie jedes Konto mit einem eigenen Tunnel Profile; der Health-Port wird automatisch gewählt.
- Mehrere Chats können denselben MCP gleichzeitig verwenden; Änderungen am selben Pfad werden serialisiert, um Schreibkonflikte zu reduzieren.

Einmalige Registrierung und Autostart unter Windows:

```powershell
.\enable-autostart.ps1 -Profile chatgpt-remote-commander
```

Einmalige Registrierung und Autostart unter Linux:

```bash
./enable-autostart-linux.sh --profile "$(hostname)"
```

Danach startet der lokale Supervisor den MCP und alle registrierten Tunnel beim Anmelden automatisch. Tunnel ID, lokale Adresse/Port und Runtime API Key müssen nicht erneut eingegeben werden.
