# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [0.0.5-p0-g1-baseline] - 2026-09-04

### Status
- New pre-G1 validation baseline. **This** is the exact artifact used in human
  validation. It hardens the DOM-extraction infrastructure (commodity
  infrastructure only — no new product concepts). The previous
  `v0.0.4-p0-g1-baseline` baseline remains immutable.

### Added / hardened
- **Standards-based accessible semantics**: `dom-accessibility-api` (MIT, v0.7.1)
  is now a direct runtime dependency; accessible names, roles, disabled state
  and (in)visibility use the W3C accname / ARIA semantics instead of hand-rolled
  heuristics. A minimal role fallback covers the `getRole` gap for
  `input[type=password]`.
- **Open Shadow DOM traversal**: root-aware traversal descends into every OPEN
  ShadowRoot (including nested ones) with deterministic ordering and no element
  duplication. CLOSED shadow roots are never bypassed; their contents remain
  UNAVAILABLE_TO_DOM. The same sanitization and accessible semantics apply
  inside shadow roots.
- **Frame-aware extraction**: the current page is now a bounded, versioned
  `PageContext` (`FrameSnapshot` per frame). The top frame is always
  distinguishable; same-origin frames are independent contexts; an inaccessible
  cross-origin frame is represented explicitly as unavailable (never empty), and
  cannot break the whole page. Frame origin stays explicit; frames are never
  merged. Protocol version bumped to `3` and request now carries `context`.
- **Deterministic relevance / context budgeting**: candidates are ranked by
  browser/page semantics (focused > alert/error/dialog > visible interactive >
  form fields > stateful > landmarks/headings > navigation > boilerplate)
  BEFORE truncation, with duplicate-boilerplate suppression. Explicit budgets:
  per-snapshot elements, visible text, total characters, and total frames.
- **Prompt**: updated to describe the fresh, frame-aware page representation,
  treat inaccessible frames as unavailable (not empty), forbid inventing
  controls, and keep page content as untrusted data. One physical action per
  turn remains.
- **New deterministic fixtures**: `long.html` (noisy/long), `shadow.html`
  (open Shadow DOM), `iframe.html` + `iframe-child.html`, `iframe-shadow.html`
  + `iframe-shadow-child.html` (iframe + shadow combinations).
- **Permissions**: added `webNavigation` (MV3, non-debugger/CDP) so the
  extension can enumerate frames and represent unreachable child frames as
  unavailable. No `debugger`, no permanent `<all_urls>`.

### Security / privacy
- Secret fields (password/OTP/card) are never serialized as values; the
  sanitizer is authoritative and applies across the top document, frames and
  shadow roots. Defensive redaction of card/OTP-looking runs in accessible
  names.
- No highlighting, vision, autonomous actions, browsing history, telemetry,
  click/type/submit primitives, or model-controlled JavaScript execution added.
- No raw secret values, no API key in the extension bundle; backend provider
  secret remains backend-only.

## [0.0.4-p0-g1-baseline] - 2026-09-04

### Status
- New pre-G1 validation baseline. **This** is the exact artifact used in human
  validation. Adds a bounded, ephemeral current-help-session conversation and a
  per-origin permission UX. The previous `v0.0.3-p0-g1-baseline` baseline
  remains immutable.

### Added
- **Current Help Session** (session-scoped conversational continuity):
  - versioned `HelpSession` / `HelpTurn` protocol types
  - object/ephemeral session model bounded to ≤ 10 recent turns (deterministic
    trimming)
  - captures the original goal and most-recent origin
  - authoritative in the Side Panel, recovered via `chrome.storage.session`
  - **Nueva ayuda** resets the session without touching unrelated browser data
- **Conversation UI**: side panel shows the ongoing help conversation (Tú /
  Navega), auto-scrolls, Enter submits / Shift+Enter newline, loading state, no
  double-submit, and an error state that preserves prior turns
- **Per-origin permission UX**: missing site access triggers a clear
  “Permitir aquí” prompt instead of an opaque technical error; grants retry
  safely; browser-protected pages (`chrome://`, `edge://`, Web Store) degrade
  cleanly
- **Model context**: the backend prompt now receives the recent conversation as
  explicit PREVIOUS HELP CONTEXT, marks page content as untrusted data, and
  reinforces one physical action per turn
- Protocol `PROTOCOL_VERSION` bumped to 2; request now carries `session`

### Security / privacy
- Secret redaction helpers applied to user-typed secrets before retention
- `HelpSessionSchema` rejects unknown roles/fields (cannot inject conversation
  roles); page text cannot become a system instruction
- Broad host capability declared **optionally** only (`*://*/*`), never granted
  by default; no permanent `<all_urls>`
- No highlighting, vision, autonomous actions, browsing history or telemetry
  added

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
