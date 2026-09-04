# Tests

Test topology:

- **Unit / schema / sanitization / policy / provider** live next to the code:
  - `packages/protocol/src/*.test.ts`
  - `packages/accessible-dom/src/*.test.ts`
  - `packages/security-policy/src/*.test.ts`
  - `packages/provider/src/*.test.ts`
- **Session / permission / conversation UI** live in the extension:
  - `apps/extension/src/session/session.test.ts`
  - `apps/extension/src/permissions/permissions.test.ts`
  - `apps/extension/src/sidepanel/controller.test.ts`
  - `apps/extension/src/service-worker/logic.test.ts`
- **Integration + security** live in `apps/api/src/*.test.ts` (routes + security
  + prompt regressions).
- **Browser E2E** lives in `apps/extension/e2e/` (Playwright), including the
  conversation vertical slice, frame-aware + shadow + relevance extraction
  scenarios, and the permission-denied/access-required scenario.
- **Accessibility / Shadow DOM / frames / relevance** coverage also lives in
  `packages/accessible-dom/src/*.test.ts` (extractor, traversal, relevance,
  frames).

## Fixtures

Deterministic fixture pages are in `tests/fixtures/` (fake data only):

- `login.html` — simple login form
- `password-recovery.html` — password recovery / OTP
- `product.html` — product page
- `admin-form.html` — generic administrative form
- `spa.html` — SPA-style dynamic page
- `prompt-injection.html` — malicious page text
- `long.html` — long/noisy page with a relevant control deep in the DOM
- `shadow.html` — page with an interactive control inside an open Shadow Root
- `iframe.html` / `iframe-child.html` — top page + same-origin iframe
- `iframe-shadow.html` / `iframe-shadow-child.html` — iframe + Shadow DOM
  combination

## Running

```bash
pnpm -r test          # unit + integration
pnpm test:e2e         # browser E2E
pnpm security:check   # bundle/permission/secret checks
```
