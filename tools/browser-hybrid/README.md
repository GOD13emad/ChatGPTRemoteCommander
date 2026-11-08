# Commander V1-04 — Hybrid Browser CLI

A working owner-local browser automation product. The run modes use open-source engines, not a new scraping model:

- `auto`: Playwright 1.65.0 on a Chromium/Edge browser when available, then the existing Commander CDP engine, then Firefox/geckodriver.
- `playwright`: explicitly require Playwright Chromium, no fallback.
- `chromium`: Playwright Chromium if installed, otherwise Commander CDP.
- `firefox`: Selenium WebDriver 4.51 on Windows; the existing Commander Firefox WebDriver/geckodriver on Linux. Both use isolated managed profiles.
- `stagehand`: Browserbase Stagehand 4.4 local browser SDK (Chromium) with deterministic locators, DOM assertions and screenshots. Explicit opt-in; no AI provider or account token is used.

Playwright, Selenium and GeckoDriver are trusted open-source packages. Selenium uses the system Firefox; Playwright uses the system Chromium/Edge. This avoids downloading or reinventing browser engines.

The utility runs an **independent managed browser**. It never attaches to a personal signed-in browser, reads browser credential stores, sends passwords/cookies, or silently takes the user's desktop.

## Install in this directory

```
npm ci --ignore-scripts --no-audit --no-fund
node cli.mjs doctor
node cli.mjs smoke --engine=auto
node cli.mjs smoke --engine=firefox
node cli.mjs smoke --engine=stagehand
node cli.mjs run --engine=auto --url=https://example.com --steps=example-workflow.json --screenshot=example.png
```

The default `smoke` test starts a temporary, loopback-only HTML server and proves navigation, fill, click, text verification, image capture, redaction and cleanup. The real-site command uses Example Domain and creates `example.png` only if the path does not already exist.

For a portable user-local copy outside the repository, set `RC_BROWSER_CORE` to the **absolute path** of the installed Commander's `src/browser-tools.mjs` before using the native CDP or Firefox backend. `RC_BROWSER_DEPS` can point to an existing trusted Node package directory containing `playwright` or `playwright-core` (e.g. the preexisting `browser-hybrid/v1` runtime); installing a duplicate package is unnecessary in that case. Playwright Chromium launches a separate headless process and does not require a custom core module.

Workflows are JSON arrays of at most 32 steps: `navigate`, `fill`, `click`, `wait`, `expectText`, `expectTitle` or `screenshot`. No arbitrary JavaScript evaluation, personal profile mounting, password extraction, implicit uploads/downloads or unbounded background agents. Each flow closes its owned browser in `finally`. Screenshot output is an ordinary local PNG.

## Optional local AI observation (host-only Ollama)

A **real** Stagehand V4 `observe()` integration can be exercised against a synthetic localhost HTML fixture, with no personal browser session or external page:

```bash
# Requires an Ollama daemon at http://127.0.0.1:11434 and a locally installed model.
npm run ai:smoke
# Example when a different local model is installed:
RC_OLLAMA_MODEL=qwen3.5:4b node stagehand-ollama-smoke.mjs
```

`ollama-provider.mjs` accepts only `127.0.0.1:11434/api/chat`, text-only messages, structured JSON output, bounded prompts and inference timeout. It uses `think:false`, no cloud credentials, and rejects arbitrary remote endpoints. AI observation only *selects* the synthetic fixture's input; deterministic Browser SDK locators verify the selector and result. It does **not** grant autonomous actions against private pages. Successful end-to-end observations were verified on Emad PC with `qwen3.5:4b` and Emad Laptop with `qwen3:4b-instruct`; Emad Server's trial exceeded the inference deadline. Treat slow/unavailable local models as `NOT_READY`, not as a completed Agent. The regular `auto` engine is non-AI.

## Scope and acceptance

This tool is a **source/portable canary**, not the signed Version 12 system installer. The repository's separate `browser_owner_route_plan` and guarded file-transfer APIs remain fail-closed until native V1-01 trusted grants and V1-03 same-owner consent arrive. Stagehand 4.4 is installed as a pinned dependency and has a verified deterministic, local-only backend selected with `--engine=stagehand`. Stagehand `act()` / `extract()` with an AI model is deliberately not activated: no provider key is installed, no page data is sent to a model, and any future model-directed automation must have an explicit trusted provider, bounded origin scope and owner consent. The production V1-08 writer owns release deployment and rollback.
