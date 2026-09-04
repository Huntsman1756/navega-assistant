# Guided Web Assistant

> **Experimental product-validation prototype.** Not production-ready. Do not
> use on sensitive flows or publish as production software.

A guided-navigation assistant for people with low digital confidence or limited
familiarity with web interfaces. It observes, understands, explains and
eventually highlights — **the human remains the executor**.

## What it does

- Opens from a Chromium **Side Panel**.
- Observes the current tab **after an explicit user action**.
- Extracts a compact, sanitized, **DOM-derived** `AccessibleDOMSnapshot`.
- Sends it to a **self-hostable backend**.
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
Human product validation: PENDING
P1 development: NOT STARTED
```

This version is an experimental validation prototype. It is not intended for
production or unattended use.

The version identifier `0.0.1-p0` expresses that we are before a stable
release. Roadmap: see `docs/ROADMAP.md`. The next gate is **G1 — P0 Human
Product Validation** (see `docs/VALIDATION-PLAN.md`).

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

- Only a **sanitized** snapshot plus the user's question leave the browser.
- Input values (password, OTP, card numbers, tokens) are never serialized.
- No telemetry, analytics SDK or crash reporting by default.
- P0 validation data stays local unless explicitly exported. See
  `docs/PRIVACY.md`.

## Security model

- Least-privilege manifest: `activeTab`, `scripting`, `storage`, `sidePanel`.
  No `debugger`, no `<all_urls>`.
- Page content is treated as untrusted input.
- Strict, versioned schemas (`additionalProperties: false`).
- Structured output is not a complete safety boundary; an instruction-safety
  layer blocks/replaces requests for secrets.
- No `click`/`type`/`submit` primitives exist.

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
