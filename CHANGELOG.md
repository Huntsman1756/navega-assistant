# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [0.0.3-p0-g1-baseline] - 2026-09-04

### Status
- Pre-G1 validation baseline. This is the EXACT artifact used in human
  validation. Nothing more should change while G1 runs.

### Validation-baseline changes
- Spanish validation UI (Side Panel)
- Enter-to-submit interaction
- Corrected `localhost` backend host permission (`http://localhost/*`)
- Configurable JSON-mode support for the OpenAI-compatible provider
- Spanish instruction-safety patterns and Spanish replacement message
- nan.builders provider configuration guidance (OpenAI-compatible)

No highlighting, vision, autonomous actions or P1 functionality added.

## [0.0.2-p0] - 2026-09-04

### Status
- P0 prototype implementation complete; G0.5 OSS publication hygiene complete.
- Repository is public. Human product validation still pending.

### Security / supply-chain hardening (no functional P0 change)
- Resolved all 18 Dependabot advisories:
  - `vitest` → 3.2.x (fixes GHSA-5xrq-8626-4rwp, critical)
  - `happy-dom` → 20.x (fixes GHSA-37j7-fg3j-429f critical and high advisories)
  - `esbuild` → >=0.25.0 (fixes GHSA-67mh-4wv8-2f99, medium)
  - `vite` → >=6.4.3 (fixes medium/high dev-server advisories)
- Added a workspace-level `pnpm.overrides` policy to pin `vite` and `esbuild`
  to patched versions across the whole tree (including transitive tooling).
- Bumped GitHub Actions: `actions/checkout` v7, `actions/setup-node` v7,
  `pnpm/action-setup` v6.
- Normalized `esbuild` devDependency to `^0.25.0` so the manifests match the
  override policy (see `docs/DEPENDENCY-POLICY.md`).
- Changed repository visibility to public.

### Notes
- No functional changes to the P0 prototype; purely supply-chain/tooling.

## [0.0.1-p0] - 2026-09-04

### Status
- P0 prototype implementation complete (source-release checkpoint).
- Human product validation pending.

### Added
- P0 product-validation prototype: Guided Web Assistant

### Highlights
- MV3 Chromium extension (Side Panel) with least-privilege permissions
  (`activeTab`, `scripting`, `storage`, `sidePanel`)
- On-demand, sanitized, DOM-derived `AccessibleDOMSnapshot` extraction
- Strict, versioned shared schemas
- Provider abstraction with `mock` and `openai-compatible` providers
  (nan.builders configurable through the OpenAI-compatible interface)
- Self-hostable backend with strict validation, instruction safety and
  conversation-simplicity checks
- Deterministic fixture pages (login, recovery, product, admin form, SPA,
  prompt-injection)
- Unit, schema, sanitization, policy, integration, security and browser E2E tests
- Open-source repository metadata and CI

### Intentionally not implemented (P0)
- autonomous continuation, automatic highlighting, voice, trusted contact,
  automatic vision routing, target resolution, MutationObserver-driven diffs
