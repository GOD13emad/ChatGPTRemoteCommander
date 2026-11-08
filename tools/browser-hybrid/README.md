# Commander V1-04 — Hybrid Browser CLI

A working owner-local browser automation product. The run modes use open-source engines, not a new scraping model:

- `auto`: Playwright 1.65.0 on a Chromium/Edge browser when available, then the existing Commander CDP engine, then Firefox/geckodriver.
- `playwright`: explicitly require Playwright Chromium, no fallback.
- `chromium`: Playwright Chromium if installed, otherwise Commander CDP.
- `firefox`: official Selenium WebDriver 4.51 on Windows; the already-verified Commander Firefox WebDriver/geckodriver on Linux. Both use independent managed profiles.

Playwright, Selenium and GeckoDriver are trusted open-source packages. Selenium uses the system Firefox; Playwright uses the system Chromium/Edge. This avoids downloading or reinventing browser engines.

The utility runs an **independent managed browser**. It never attaches to a personal signed-in browser, reads browser credential stores, sends passwords/cookies, or silently takes the user's desktop.

## Install in this directory

```
npm ci --ignore-scripts --no-audit --no-fund
node cli.mjs doctor
node cli.mjs smoke --engine=auto
node cli.mjs smoke --engine=firefox
node cli.mjs run --engine=auto --url=https://example.com --steps=example-workflow.json --screenshot=example.png
```

The default `smoke` test starts a temporary, loopback-only HTML server and proves navigation, fill, click, text verification, image capture, redaction and cleanup. The real-site command uses Example Domain and creates `example.png` only if the path does not already exist.

For a portable user-local copy outside the repository, set `RC_BROWSER_CORE` to the **absolute path** of the installed Commander's `src/browser-tools.mjs` before using the native CDP or Firefox backend. `RC_BROWSER_DEPS` can point to an existing trusted Node package directory containing `playwright` or `playwright-core` (e.g. the preexisting `browser-hybrid/v1` runtime); installing a duplicate package is unnecessary in that case. Playwright Chromium launches a separate headless process and does not require a custom core module.

Workflows are JSON arrays of at most 32 steps: `navigate`, `fill`, `click`, `wait`, `expectText`, `expectTitle` or `screenshot`. No arbitrary JavaScript evaluation, personal profile mounting, password extraction, implicit uploads/downloads or unbounded background agents. Each flow closes its owned browser in `finally`. Screenshot output is an ordinary local PNG.

## Scope and acceptance

This tool is a **source/portable canary**, not the signed Version 12 system installer. The repository's separate `browser_owner_route_plan` and guarded file-transfer APIs remain fail-closed until native V1-01 trusted grants and V1-03 same-owner consent arrive. Stagehand 4.4 (if already installed and configured) can supply an optional model-driven planning layer over a separately authorized Chromium session, but no key or user browser session is assumed by this CLI. The production V1-08 writer owns release deployment and rollback.
