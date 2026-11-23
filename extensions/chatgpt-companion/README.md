# Commander Chat Companion (v0.1.0 integration candidate)
This **opt-in** MV3 extension is bundled with the **same** Remote Commander setup. It can be loaded in Commander-owned Electron Chromium (the experimental internal Browser Core) or, **manually** by the owner, into Chrome, Edge and Brave. Firefox requires a separately signed/tested package. It observes *only* exact ChatGPT conversation URL state, never message contents, cookies, or local files.

The companion service is a loopback-only, unprivileged pairing bridge within the existing Commander unified GUI. Start Commander, click **Start companion**, then **New pairing code**, copy the displayed code and enter it in the extension popup. For the internal Browser Core, first select **Open ChatGPT in Browser Core** and then **Pair internal extension**; Electron does not necessarily expose Chrome's action toolbar. A browser can be disconnected in the popup. Tokens are per extension origin and stored in chrome.storage.local; pairing codes expire after 5 minutes. Pairing is needed after Commander GUI restarts in this candidate.

This is **NOT** CoS's complete conversation automation or a production ChatGPT session attestation. No automatic sending, granting tools, Full Access, background chat continuation, screen control or migration of existing browser profiles is enabled. CoS inspiration: https://github.com/totec448-spec/chat-on-steroids (MIT); no upstream source code is copied.

## Chromium load unpacked
Open chrome://extensions (Chrome), edge://extensions (Edge), or brave://extensions (Brave); enable Developer mode, choose Load unpacked, and select this **chatgpt-companion** directory. Activate the requested limited permissions. Do **not** extract/transfer personal browser cookies.

## Source identity and rollback
The source directory is included in the unified source manifest and audited by the standard installer. Disabling the extension in the browser or closing Commander stops the bridge without affecting any active v0.11 Core/Tunnel. Existing production migrations remain NO_PROMOTE.

Internal Electron Browser Core allows only the named first-party sign-in popups in its separate persistent session; unknown popups and non-HTTPS navigation are rejected. Electron only supports a subset of MV3 extension APIs: if the embedded extension fails to load, the native URL-presence observer is the fallback, with no false claim of automated chat control.
