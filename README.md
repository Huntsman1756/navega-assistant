# Guided Web Assistant

> **Experimental product-validation prototype.** Not production-ready. Do not
> use on sensitive flows or publish as production software.

A guided-navigation assistant for people with low digital confidence or limited
familiarity with web interfaces. It observes, understands, explains and
eventually highlights — **the human remains the executor**.

## What it does

- Opens from a Chromium **Side Panel**.
- Keeps a small, **ephemeral** current help session so it can answer short
  follow-ups like “ya estoy” or “¿y ahora?” (this is a bounded help
  conversation, **not** a browsing history).
- Observes the current tab **after an explicit user action**.
- Extracts a compact, sanitized, **DOM-derived** `AccessibleDOMSnapshot` (fresh
  on every request).
- Sends it plus the recent conversation to a **self-hostable backend**.
- Calls a **configurable AI provider** and returns **one simple instruction**.

## What it deliberately does NOT do

It is **not** an autonomous browser agent. There are no runtime primitives for:

- clicking, typing, submitting, purchasing, deleting, sending
- executing arbitrary JavaScript
- remote control of the browser

These do not exist in the architecture — not merely disabled by prompt.

The system does **not** (in P0):

- autonomous continuation
- automatic highlighting
- voice
- trusted-contact delivery
- automatic vision routing

## Current status

```text
P0 prototype implementation: COMPLETE
Source-release readiness: PASS
OSS publication hygiene: PASS
Pre-G1 validation baseline: FROZEN (v0.0.7-p0-g1-baseline)
Human product validation: READY TO START (G1)
P1 development: BLOCKED (product evidence pending)
```

This version is an experimental validation prototype. It is not intended for
production or unattended use.

The version identifier `0.0.7-p0-g1-baseline` marks the exact implementation
that is used in human validation. It hardens the runtime so one inaccessible
child frame can never fail capture of the top page (per-frame isolated
injection with `frameIds`, never `allFrames:true`), preserves the exact user
question across a site-permission grant, correlates frame snapshots to the
captured tab, prioritises accessible frames and bounds the whole serialized
context (including visible text) with a deterministic global budget. It keeps
the small, ephemeral current-help-session conversation and per-origin
permission UX; it does **not** add highlighting, autonomous actions or browsing
history. Roadmap: see `docs/ROADMAP.md`. The next gate is **G1 — P0 Human
Product Validation** (see `docs/VALIDATION-PLAN.md`). During G1 the engineering
baseline is frozen; the decisive artifact is the consolidated G1 report
(`docs/validation/G1-REPORT-TEMPLATE.md`).

## Supported browsers

- Chromium-based: **Chrome** and **Edge** (Manifest V3, Side Panel API,
  minimum Chrome 116).

## Architecture

```
Extension (Side Panel + service worker + on-demand content extraction)
        │ sanitized snapshot + question
        ▼
Self-hostable backend
        │
   Schemas / Policy / Provider
        │
        ▼
  AI Provider API
```

See `docs/TARGET-ARCHITECTURE.md` for the full target vs current distinction.

## Local development

Prerequisites: Node.js ≥ 20 and pnpm ≥ 10.

```bash
pnpm install
pnpm verify     # lint + typecheck + tests + build + security checks
pnpm test:e2e   # browser E2E (Playwright)
```

### Run the backend

```bash
cp .env.example .env   # defaults to AI_PROVIDER=mock
pnpm --filter @guided-web/api dev
```

### Load the extension in Chrome/Edge

1. `pnpm build` (produces `apps/extension/dist`).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. **Load unpacked** and select `apps/extension/dist`.
5. Click the **Guided Web Assistant** icon to open the Side Panel.
6. Open a fixture page (or any page) and ask “I don’t know what to do here.”

## Backend setup

The backend is self-hostable. Provider configuration is environment-based
(`apps/api/src/config.ts`):

```text
AI_PROVIDER=mock            # or "openai-compatible"
AI_BASE_URL=...
AI_API_KEY=...
AI_MODEL=...
PORT=8787
```

## Provider setup

- **mock** — deterministic, offline, no API required. Default for tests and the
  P0 demo.
- **openai-compatible** — any OpenAI-compatible `/chat/completions` endpoint.
  **nan.builders** is configured through this interface (set `AI_BASE_URL` and
  `AI_MODEL`), not hard-coded.

The browser extension **never** receives `AI_API_KEY`. The key exists only in
backend configuration.

## Privacy model

- A **sanitized** snapshot, the current question and a **short, bounded** recent
  help conversation leave the browser.
- The current help session is **ephemeral** and is **not** a browsing history.
  It lives in the Side Panel plus `chrome.storage.session` (cleared on restart),
  never `chrome.storage.local`.
- Input values (password, OTP, card numbers, tokens) are never serialized, and
  high-confidence secret-looking visible text is redacted; user-typed secrets are
  redacted before being stored in the conversation.
- The **Nueva ayuda** button clears the current help session.
- No telemetry, analytics SDK or crash reporting by default.
- P0 validation data stays local unless explicitly exported. See
  `docs/PRIVACY.md`.

## Security model

- Least-privilege manifest: `activeTab`, `scripting`, `storage`, `sidePanel`,
  `webNavigation` (needed to enumerate frames and resolve the top-frame URL
  without the `tabs` permission), plus host access only to `http://localhost/*`
  and `http://127.0.0.1/*` (the self-hosted backend and local fixture pages). No
  `debugger`, no permanent `<all_urls>`. A broad host capability is declared
  **optionally** only, never granted by default; the user grants individual
  sites explicitly.
- Frame capture is **per-frame isolated**: the extension enumerates frames and
  injects each separately with explicit `frameIds` (never `allFrames:true`), so
  one inaccessible advertising/tracking child frame can never prevent capture of
  the top page or other accessible frames. Unavailable frames are reported
  explicitly (never as empty).
- Page content is treated as untrusted input, and page/session text can never
  inject conversation roles or override system policy.
- Strict, versioned schemas (`additionalProperties: false`, `PROTOCOL_VERSION 3`).
- Structured output is not a complete safety boundary; an instruction-safety
  layer blocks/replaces requests for secrets.
- No `click`/`type`/`submit`/`executeJavaScript` primitives exist.

See `docs/SECURITY-INVARIANTS.md` and `docs/THREAT-MODEL.md`.

## Contributing

Read `CONTRIBUTING.md`. The key constraint: this project is intentionally
**not** an autonomous browser agent. Any contribution that adds autonomous
browser-action capabilities or broad permissions is out of scope and will be
rejected without a new threat-model review.

## Reporting vulnerabilities

See `SECURITY.md`. Do not open a public issue for security issues.

## License

Apache-2.0. See `LICENSE`.

### Explicit local provider startup

Both `pnpm --filter @guided-web/api dev` and `pnpm --filter @guided-web/api start`
load the repository-root `.env` using Node's native `--env-file`. A missing file,
missing provider selection, or incomplete real-provider configuration fails clearly.
Process environment overrides env-file values: unset stale `AI_*` overrides before G1.
Use Node 22 or newer. Tests/CI explicitly use mock and never load the operator key.
For G1 set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL=https://api.nan.builders/v1`,
`AI_MODEL=qwen3.6`, and a backend-only `AI_API_KEY` in the ignored root `.env`.
Check `http://127.0.0.1:8787/health` for provider/model identity before opening Chrome.
The server binds explicitly to `127.0.0.1`; there is no P0 remote-listen mode.
