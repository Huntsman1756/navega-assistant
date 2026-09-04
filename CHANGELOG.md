# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [0.0.7-p0-g1-baseline] - 2026-09-04

### Status
- New pre-G1 validation baseline. **This** is the exact artifact used in human
  validation. It is a runtime-correctness closure against official Chrome
  extension APIs and mature upstream OSS; it fixes plumbing issues that would
  otherwise surface as false G1 failures. The previous `v0.0.6-p0-g1-baseline`
  baseline remains immutable. No product features were added.

### Fixed
- **A — Per-frame isolated injection.** Replaced the fragile
  `chrome.scripting.executeScript({target:{tabId, allFrames:true}})` capture
  with explicit per-frame injection:
  - enumerate frames via `chrome.webNavigation.getAllFrames({tabId})`;
  - inject **separately per frame** with `target:{tabId, frameIds:[frameId]}`;
  - each frame is isolated with `Promise.allSettled`, so one failed child frame
    can NEVER fail the top page or another accessible frame;
  - a frame that produced no snapshot is represented explicitly as unavailable
    (never empty);
  - the top frame is attempted independently; if IT cannot be accessed the
    capture surfaces a page-level access error that triggers the per-origin
    permission UX.
- **B — Preserve the exact question across the permission flow.** The old retry
  called `askHelp()` again after the textarea had been cleared, so the original
  intent was replaced by `DEFAULT_QUESTION`. Now an explicit
  `PendingHelpRequest` stores the exact question + minimal tab/origin context; a
  grant re-runs the EXACT question and captures a FRESH `PageContext`. No stale
  snapshot, no duplicate user turns, no default fallback. Denial sends no model
  request and expires the pending operation. If the user navigates to a
  different origin before granting, the old question is NOT applied to the wrong
  origin.
- **C — Correlate frame messages with the captured tab.** The snapshot listener
  now rejects any message whose `sender.tab.id` does not match the captured
  `tabId`, and each capture uses a short-lived token echoed back by the content
  script, so a late/stale message from a previous capture, another window or an
  unrelated extension message can never populate the current `PageContext`.
- **D — Frame prioritisation before `MAX_FRAMES`.** Deterministic frame ordering
  is now TOP frame, then ACCESSIBLE child frames, then UNAVAILABLE child frames
  (stable within each class), applied before `MAX_FRAMES`, so an inaccessible
  advertising iframe can no longer crowd out a useful accessible child frame.
- **E — Real global page-context budget.** `boundContext` now accounts for frame
  metadata, elements, accessible names, roles/tags/states, the snapshot envelope,
  page/title/origin/URL **and visibleText**, with ELEMENTS (controls) taking
  priority over LOW-priority visible text. The whole serialized `PageContext`
  stays deterministically bounded (`MAX_TOTAL_CONTEXT_CHARACTERS`), top frame
  gets priority, and child frames consume the remaining budget.
- **F — Secret-safety contract vs visible text.** A secret can appear as plain
  page text (e.g. “Tu código de verificación es 938271”), not only as an input
  value. Added conservative, phrase-gated visible-text redaction
  (`redactSensitiveVisibleText`): a digit run is redacted only when immediately
  preceded by a strong secret-context phrase. A date, price, postal/order number
  is NOT redacted solely by digit length. Security docs now distinguish
  GUARANTEED (raw secret field values never serialized) from HIGH-CONFIDENCE
  / defence-in-depth (contextual visible-text redaction).

### Tests
- New frame-isolated capture unit suite (`capture.test.ts`): top+A+B+C scenario
  (B unreachable) => A/C still captured, B unavailable; top-inaccessible =>
  page-level failure; independent per-frame attempts; same-tab accepted, other
  tab ignored, malformed snapshot ignored, stale-token message cannot populate a
  new capture.
- New frame-priority + global-budget tests (`frames.test.ts`): accessible frame
  survives ahead of unavailable frames before `MAX_FRAMES`; unavailable metadata
  retained when budget allows; visibleText counts toward the serialized budget;
  large article text cannot crowd out controls; deterministic; multi-frame
  payload bounded.
- New permission-retry tests (`controller.test.ts`): exact question preserved
  through a grant; fresh PageContext after grant; no duplicate user turns;
  denial sends no model request; navigating to a different origin before grant
  is not applied to the wrong origin.
- New secret-text tests (`extractor.test.ts`/`sanitizer.ts`): verification-code
  visible text redacted; a date not redacted; an order number not treated as an
  OTP solely by digit length.
- Browser E2E extended: real bundle assembled through `buildPageContext`;
  multi-frame context bounded + accessible controls retained; the EXACT original
  question survives a site-permission grant. Existing active-tab URL and
  help-session follow-up E2E remain green.

### Security / privacy
- No `tabs` permission. No permanent `<all_urls>`. No `debugger`/CDP. No
  autonomous actions, highlighting, telemetry or browsing history added.
- `permissions.addHostAccessRequest` (Chrome 133+) was audited but NOT adopted
  (minimum Chrome is 116); the explicit per-origin permission UX is preserved.

## [0.0.6-p0-g1-baseline] - 2026-09-04

### Status
- New pre-G1 validation baseline. **This** is the exact artifact used in human
  validation. It fixes a **total-study blocker** found in the live Chrome smoke
  test of `v0.0.5-p0-g1-baseline`. The previous `v0.0.5-p0-g1-baseline` baseline
  remains immutable.

### Fixed
- **Active-page URL discovery (no `tabs` permission)**: the Side Panel used
  `chrome.tabs.query(...)` and relied on `Tab.url`, but without the `tabs`
  permission `Tab.url` is `undefined` unless an `activeTab` grant is valid
  (e.g. the user clicked the action icon). Opening the Side Panel alone (or
  switching tabs while it is open) therefore left `tab.url` empty and a normal
  HTTPS page (e.g. GitHub.com) was mis-classified as `unsupported`.
- Resolution: when `tab.url` is absent, the extension reads the top-level frame
  URL via `chrome.webNavigation.getFrame({ tabId, frameId: 0 })` (only needs the
  already-declared `webNavigation` permission). An ordinary HTTPS page is then
  classified `supported` and falls into the explicit per-origin permission
  flow. No `tabs` permission, no permanent `<all_urls>`, no `debugger`.

### Tests
- New pure `resolveActiveTab` regression (chrome-free unit): `tab.url` present
  vs. `undefined` (getFrame fallback), degrade-to-`unsupported` on failure, and
  `classifyPage("https://…") === "supported"`.
- New browser E2E: when `Tab.url` is undefined, Navega resolves the page via
  `webNavigation` and does **not** report an unsupported page, but instead shows
  the per-origin permission prompt.

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
