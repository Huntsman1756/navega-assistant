# Tests

Test topology:

- **Unit / schema / sanitization / policy / provider** live next to the code:
  - `packages/protocol/src/*.test.ts`
  - `packages/accessible-dom/src/*.test.ts`
  - `packages/security-policy/src/*.test.ts`
  - `packages/provider/src/*.test.ts`
- **Integration + security** live in `apps/api/src/*.test.ts` (routes + security).
- **Browser E2E** lives in `apps/extension/e2e/` (Playwright).

## Fixtures

Deterministic fixture pages are in `tests/fixtures/` (fake data only):

- `login.html` — simple login form
- `password-recovery.html` — password recovery / OTP
- `product.html` — product page
- `admin-form.html` — generic administrative form
- `spa.html` — SPA-style dynamic page
- `prompt-injection.html` — malicious page text

## Running

```bash
pnpm -r test          # unit + integration
pnpm test:e2e         # browser E2E
pnpm security:check   # bundle/permission/secret checks
```
