# ChatGPT Remote Commander — installation actuelle

> Source de vérité: [START_HERE.md](../START_HERE.md). Un assistant IA doit lire ce fichier en premier et ne pas mélanger les anciennes procédures.

Standard est le choix le plus sûr. Full/Power Mode est réservé à une machine de confiance et active l'accès complet aux fichiers, au Shell et aux processus.

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
curl -fsSL --connect-timeout 15 --max-time 180 https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --start-server
```

Créez ensuite Secure MCP Tunnel et Runtime API Key. Ne collez jamais la clé dans le chat; saisissez-la uniquement dans l'invite locale masquée. Créez une Custom App ChatGPT avec Connection = Tunnel, Authentication = None et Scan Tools.

Icône: [plugin-icon.png](../assets/plugin-icon.png). Plugin: [PLUGIN_SETUP.md](PLUGIN_SETUP.md).

FINAL PASS nécessite MCP health, Tunnel ready, Scan Tools et un appel réel à `system_status`.