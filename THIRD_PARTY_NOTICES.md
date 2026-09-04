# Third Party Notices

This project builds on the following third-party libraries. Their licenses are
reproduced or linked below.

## Runtime dependencies

- **zod** — MIT License. Used for strict schema validation in
  `@guided-web/protocol`.
- **hono** — MIT License. Used by the backend HTTP layer.
- **@hono/node-server** — MIT License. Node adapter for Hono.
- **dom-accessibility-api** — MIT License
  (<https://github.com/eps1lon/dom-accessibility-api>, v0.7.1). Used for
  standards-based accessible-name/role/disabled/inaccessible computation in
  `@guided-web/accessible-dom`. See `docs/UPSTREAM-REUSE.md`.

## Development / tooling dependencies

- **typescript**, **vitest**, **esbuild**, **tsx**, **@playwright/test**,
  **happy-dom**, **@types/chrome**, **@types/node** — various (MIT/Apache-2.0).
  Reused under their respective licenses. Playwright is a **test tool only**.

## npm cache / note

See `pnpm-lock.yaml` for the complete dependency graph and versions.

## Notices

- The only upstream code adopted as a runtime dependency is
  `dom-accessibility-api` (MIT). The other upstream projects studied for this
  hardening pass (nanobrowser, Page Assist, browser-use) were used for concepts
  only and contributed no copied code. See `docs/UPSTREAM-REUSE.md`.
