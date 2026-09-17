# ChatGPT Remote Commander — пошаговая настройка

> Публичный репозиторий GitHub **не** означает, что любой человек может подключиться к компьютеру автора. Нужны разрешённый Tunnel, доступ Workspace/Plugin и запущенный `tunnel-client` на целевом ПК.

## 1. Установка на Windows

1. Откройте: https://github.com/GOD13emad/ChatGPTRemoteCommander
2. Нажмите **Code** → **Download ZIP** или клонируйте через Git.
3. Распакуйте и откройте папку проекта.
4. При необходимости установите Node.js 22+ и PowerShell 7.
5. Откройте PowerShell 7 в папке проекта.
6. Выполните:

```powershell
npm run check
npm test
npm start
```

7. Откройте http://127.0.0.1:47831/health и убедитесь, что `ok: true`.

## 2. Создание Secure MCP Tunnel

1. Войдите в OpenAI Platform.
2. Откройте: https://platform.openai.com/settings/organization/tunnels
3. Нажмите **Create tunnel**.
4. Задайте имя, например `ChatGPT Remote Commander`.
5. Привяжите Platform organization, которой принадлежит Tunnel.
6. Привяжите ChatGPT workspace, который должен видеть/использовать Tunnel.
7. Сохраните и скопируйте `tunnel_id`.
8. Создание/изменение требует **Tunnels Read + Manage**; запуск/выбор — **Tunnels Read + Use**.
## 3. Runtime API Key и запуск Tunnel

1. Откройте: https://platform.openai.com/api-keys
2. Создайте ограниченный Runtime API Key только с нужными разрешениями Tunnel.
3. Никогда не вставляйте ключ в чат, GitHub, скриншоты или файлы проекта.
4. При необходимости скачайте последний tunnel-client: https://github.com/openai/tunnel-client/releases/latest
5. Пока MCP Server работает, откройте второе окно PowerShell 7 и выполните:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. Введите `tunnel_id`, затем API Key; ввод ключа скрыт.
7. Оставьте окно открытым; Tunnel должен оставаться healthy/ready во время работы ChatGPT.

## 4. Создание Plugin/App в ChatGPT

1. Откройте: https://chatgpt.com/plugins
2. Нажмите **+**.
3. Укажите имя, например `ChatGPT Remote Commander`.
4. В **Connection** выберите **Tunnel**.
5. Выберите созданный Tunnel или вставьте действительный tunnel ID.
6. Для этого сервера выберите **None / No authentication**, а не Mixed/OAuth.
7. Проверьте предупреждение о риске и разрешения.
8. Если доступно, выполните Scan/Refresh Tools и нажмите **Create**.
9. Откройте новый чат и выберите приложение или вызовите его через `@mention`.
10. Тест: `Run system_status and report the active capabilities.`

## 5. Power Mode и второй аккаунт

Публичный `config.json` безопасен по умолчанию. Full Control включайте только локально в `config.local.json`, который игнорируется Git. Постоянное удаление лучше оставить выключенным; shutdown/restart/logoff остаются заблокированными.

Для друга или второго аккаунта создайте отдельный Tunnel в его аккаунте/Workspace и запустите его tunnel-client на том же целевом ПК. Не передавайте свой Runtime API Key. Согласно текущей документации OpenAI, Pro поддерживает custom MCP read/fetch; полный write/modify сейчас доступен для Business и Enterprise/Edu.

## Устранение неполадок

- Tunnel не виден: проверьте привязку к целевому ChatGPT workspace и право **Tunnels Read + Use**.
- Ошибка OAuth discovery: установите Authentication = **None**.
- `FORBIDDEN: This conversation does not support developer MCPs`: создайте новый чат, в том числе внутри того же Project, и вызовите приложение в начале.
- После обновления видны старые инструменты: Refresh или пересоздайте custom app для повторного сканирования schema.

Официальная документация: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels и https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
