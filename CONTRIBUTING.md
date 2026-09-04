# Contributing

Thanks for your interest. Please read this before opening a PR.

## Product constraint (read first)

Guided Web Assistant is a **guided-navigation** assistant, **not** an
autonomous browser agent. The human remains in control.

Do **not** add runtime primitives for clicking, typing, submitting, purchasing,
deleting, sending, executing arbitrary JavaScript, or remote browser control.
Do **not** add broad permissions (`<all_urls>`, `debugger`) “for later”.

If a proposal requires such capabilities, it must first go through a new
threat-model review (see `docs/THREAT-MODEL.md`).

## Project principles

- simpler, more auditable, least privilege, less data, fewer dependencies
- explicit failure and deterministic behaviour
- provider independence and self-hostability
- fail safely: if the system does not know, it says so

## Setup

```bash
pnpm install
pnpm build
pnpm -r typecheck
pnpm -r test
```

Playwright browsers (for E2E):

```bash
pnpm --filter @guided-web/extension exec playwright install chromium
```

## Coding conventions

- TypeScript, strict mode, monorepo (`apps/*`, `packages/*`).
- Vanilla TypeScript for page-injected code; avoid React in content scripts.
- Prefer small, narrow dependencies. Ask “why is this needed?”.
- No comments unless they add meaning; follow existing style.
- Do not commit real secrets, keys or participant data.

## How to contribute

1. Open an issue describing the problem/P0 evidence.
2. Branch from `main`.
3. Make coherent, small commits.
4. Add tests. Ensure `pnpm -r typecheck` and `pnpm -r test` pass.
5. Ensure the appropriate security invariants still hold (`docs/SECURITY-INVARIANTS.md`).
6. Add/reuse documented sessions to `docs/validation/` templates if relevant.
   Never commit real participant data (use `P01`, `P02`, …).

## Code provenance

If you adapt code from an upstream project, follow the procedure in
`docs/UPSTREAM-REUSE.md` and update `THIRD_PARTY_NOTICES.md`.

## Security

For vulnerabilities, see `SECURITY.md`.
