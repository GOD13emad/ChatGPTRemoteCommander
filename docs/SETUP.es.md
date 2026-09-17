# ChatGPT Remote Commander — Configuración clic a clic

> Que el repositorio de GitHub sea público **no** permite que cualquiera se conecte al PC del autor. Se necesita un Tunnel autorizado, acceso al Workspace/Plugin y `tunnel-client` ejecutándose en el PC objetivo.

## 1. Instalar en Windows

1. Abre: https://github.com/GOD13emad/ChatGPTRemoteCommander
2. Haz clic en **Code** → **Download ZIP**, o clona con Git.
3. Extrae y abre la carpeta del proyecto.
4. Instala Node.js 22+ y PowerShell 7 si hace falta.
5. Abre PowerShell 7 dentro de la carpeta.
6. Ejecuta:

```powershell
npm run check
npm test
npm start
```

7. Abre http://127.0.0.1:47831/health y confirma `ok: true`.

## 2. Crear Secure MCP Tunnel

1. Inicia sesión en OpenAI Platform.
2. Abre https://platform.openai.com/settings/organization/tunnels
3. Pulsa **Create tunnel**.
4. Usa un nombre como `ChatGPT Remote Commander`.
5. Asocia la Platform organization propietaria del Tunnel.
6. Asocia el ChatGPT workspace que debe verlo y usarlo.
7. Guarda y copia el `tunnel_id`.
8. Crear/editar requiere **Tunnels Read + Manage**; ejecutar/seleccionar requiere **Tunnels Read + Use**.
## 3. Crear la Runtime API Key y arrancar el Tunnel

1. Abre https://platform.openai.com/api-keys
2. Crea una Runtime API Key restringida con solo los permisos de Tunnel necesarios.
3. Nunca pegues la clave en chats, GitHub, capturas ni archivos del proyecto.
4. Si hace falta, descarga el tunnel-client más reciente: https://github.com/openai/tunnel-client/releases/latest
5. Con MCP Server aún activo, abre otra ventana de PowerShell 7 y ejecuta:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. Introduce `tunnel_id` y luego la API Key cuando se soliciten; la entrada de la clave está oculta.
7. Mantén esa ventana abierta; el Tunnel debe permanecer healthy/ready durante el uso.

## 4. Crear el Plugin/App en ChatGPT

1. Abre https://chatgpt.com/plugins
2. Pulsa **+**.
3. Escribe un nombre como `ChatGPT Remote Commander`.
4. En **Connection**, elige **Tunnel**.
5. Selecciona el Tunnel creado o introduce un tunnel ID válido.
6. Para este servidor usa **None / No authentication**, no Mixed/OAuth.
7. Revisa el aviso de riesgo y los permisos.
8. Ejecuta Scan/Refresh Tools si aparece y pulsa **Create**.
9. Abre un chat nuevo y selecciona o menciona con `@` la app.
10. Prueba: `Run system_status and report the active capabilities.`

## 5. Power Mode y otra cuenta

El `config.json` público es seguro por defecto. Full Control solo debe activarse en el `config.local.json` local e ignorado por Git. Mantén desactivado el borrado permanente; shutdown/restart/logoff siguen bloqueados.

Para un amigo o segunda cuenta, crea un Tunnel separado en su cuenta/Workspace y ejecuta ese tunnel-client en el mismo PC objetivo. No compartas tu Runtime API Key. Según la documentación actual de OpenAI, Pro admite custom MCP de read/fetch; write/modify completo está actualmente en Business y Enterprise/Edu.

## Solución de problemas

- Tunnel no visible: verifica la asociación con el ChatGPT workspace y **Tunnels Read + Use**.
- Error de OAuth discovery: usa Authentication = **None**.
- `FORBIDDEN: This conversation does not support developer MCPs`: abre un chat nuevo, incluso dentro del mismo Project, e invoca la app al principio.
- Herramientas antiguas tras actualizar: Refresh o recrea la app para volver a escanear el schema.

Documentación oficial: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels y https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
