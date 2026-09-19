# ChatGPT Remote Commander — configuración actual

> Fuente única: [START_HERE.md](../START_HERE.md). Un asistente de IA debe leer ese archivo primero y no mezclar métodos antiguos.

Standard es la opción más segura. Full/Power Mode es sólo para un equipo de confianza y habilita acceso completo a archivos, Shell y procesos.

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

Después crea Secure MCP Tunnel y Runtime API Key. Nunca pegues la clave en el chat; introdúcela sólo en el prompt local oculto. Crea una Custom App en ChatGPT con Connection = Tunnel, Authentication = None y Scan Tools.

Icono: [plugin-icon.png](../assets/plugin-icon.png). Plugin: [PLUGIN_SETUP.md](PLUGIN_SETUP.md).

FINAL PASS requiere MCP health, Tunnel ready, Scan Tools y una llamada real a `system_status`.