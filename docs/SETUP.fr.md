# ChatGPT Remote Commander — Installation clic par clic

> Un dépôt GitHub public ne permet **pas** à tout le monde de se connecter au PC de l'auteur. Il faut un Tunnel autorisé, l'accès au Workspace/Plugin et `tunnel-client` en cours d'exécution sur le PC cible.

## Installation directe en une commande

Collez une de ces commandes dans PowerShell. Standard est sécurisé par défaut ; Power Mode active le contrôle complet des fichiers, du Shell et des processus sur un PC de confiance.

**Standard:**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

**Power Mode:**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

## 1. Installer sur Windows

1. Ouvrez : https://github.com/GOD13emad/ChatGPTRemoteCommander
2. Cliquez sur **Code** → **Download ZIP**, ou clonez avec Git.
3. Extrayez et ouvrez le dossier du projet.
4. Installez Node.js 22+ et PowerShell 7 si nécessaire.
5. Ouvrez PowerShell 7 dans le dossier du projet.
6. Exécutez :

```powershell
npm run check
npm test
npm start
```

7. Ouvrez http://127.0.0.1:47831/health et vérifiez `ok: true`.

## 2. Créer le Secure MCP Tunnel

1. Connectez-vous à OpenAI Platform.
2. Ouvrez https://platform.openai.com/settings/organization/tunnels
3. Cliquez sur **Create tunnel**.
4. Donnez un nom, par exemple `ChatGPT Remote Commander`.
5. Associez la Platform organization propriétaire du Tunnel.
6. Associez le ChatGPT workspace qui doit voir/utiliser le Tunnel.
7. Enregistrez et copiez le `tunnel_id`.
8. Créer/modifier exige **Tunnels Read + Manage** ; exécuter/sélectionner exige **Tunnels Read + Use**.
## 3. Créer la Runtime API Key et démarrer le Tunnel

1. Ouvrez https://platform.openai.com/api-keys
2. Créez une Runtime API Key restreinte avec uniquement les permissions Tunnel nécessaires.
3. Ne collez jamais cette clé dans un chat, GitHub, une capture d'écran ou un fichier du projet.
4. Si nécessaire, téléchargez le dernier tunnel-client : https://github.com/openai/tunnel-client/releases/latest
5. Avec le MCP Server toujours actif, ouvrez une deuxième fenêtre PowerShell 7 et exécutez :

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. Entrez `tunnel_id`, puis l'API Key lorsqu'ils sont demandés ; la saisie de la clé est masquée.
7. Gardez cette fenêtre ouverte ; le Tunnel doit rester healthy/ready pendant l'utilisation.

## 4. Créer le Plugin/App dans ChatGPT

1. Ouvrez https://chatgpt.com/plugins
2. Cliquez sur **+**.
3. Entrez un nom tel que `ChatGPT Remote Commander`.
4. Dans **Connection**, choisissez **Tunnel**.
5. Sélectionnez le Tunnel créé ou collez un tunnel ID valide.
6. Pour ce serveur, choisissez **None / No authentication**, pas Mixed/OAuth.
7. Vérifiez l'avertissement de risque et les permissions.
8. Lancez Scan/Refresh Tools si disponible, puis cliquez sur **Create**.
9. Ouvrez un nouveau chat et sélectionnez ou `@mention` l'app.
10. Testez : `Run system_status and report the active capabilities.`

## 5. Power Mode et deuxième compte

Le `config.json` public est sûr par défaut. Full Control doit être activé uniquement dans le `config.local.json` local, ignoré par Git. Gardez la suppression permanente désactivée ; shutdown/restart/logoff restent bloqués.

Pour un ami ou un second compte, créez un Tunnel séparé dans son compte/Workspace et exécutez son tunnel-client sur le même PC cible. Ne partagez pas votre Runtime API Key. Selon la documentation OpenAI actuelle, Pro prend en charge les custom MCP read/fetch ; le write/modify complet est actuellement réservé à Business et Enterprise/Edu.

## Dépannage

- Tunnel invisible : vérifiez l'association au ChatGPT workspace et **Tunnels Read + Use**.
- Erreur OAuth discovery : utilisez Authentication = **None**.
- `FORBIDDEN: This conversation does not support developer MCPs` : ouvrez un nouveau chat, même dans le même Project, et invoquez l'app tôt.
- Outils anciens après mise à jour : Refresh ou recréez l'app pour rescanner le schema.

Documentation officielle : https://developers.openai.com/api/docs/guides/secure-mcp-tunnels et https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

## v0.3 : plusieurs ordinateurs, plusieurs comptes, chats simultanés et sans ressaisie du tunnel

- Un compte ChatGPT peut contrôler plusieurs ordinateurs : installez le projet sur chaque machine et créez un Secure MCP Tunnel distinct pour chaque appareil.
- Plusieurs comptes ChatGPT peuvent utiliser un même ordinateur : enregistrez chaque compte avec un Tunnel Profile différent ; le port de santé est choisi automatiquement.
- Plusieurs chats peuvent utiliser le même MCP simultanément ; les modifications visant le même chemin sont sérialisées afin de réduire les conflits d'écriture.

Enregistrement unique et démarrage automatique sous Windows :

```powershell
.\enable-autostart.ps1 -Profile chatgpt-remote-commander
```

Enregistrement unique et démarrage automatique sous Linux :

```bash
./enable-autostart-linux.sh --profile "$(hostname)"
```

Ensuite, le superviseur local démarre automatiquement le MCP et les tunnels enregistrés à la connexion. Il n'est plus nécessaire de ressaisir le Tunnel ID, l'adresse/port local ou la Runtime API Key.
