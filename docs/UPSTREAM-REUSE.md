# Upstream Reuse Policy

Guided Web Assistant is **not a fork** of any autonomous browser agent. Upstream
projects are studied for algorithms and patterns only; the operator/executor
runtime is intentionally not imported.

## Where our code comes from

Unless recorded in `THIRD_PARTY_NOTICES.md`, code in this repository is
original to this project. Anything adapted from upstream MUST be recorded here
with the exact repository, license, compatibility note and attribution.

## Adopted / direct dependency

### dom-accessibility-api
- **Repository:** <https://github.com/eps1lon/dom-accessibility-api>
- **License:** MIT
- **Inspected revision:** tag `v0.7.1` (npm release 0.7.1; default branch commit
  `a1828981f407b6cd6dc9d7b1046a618af93d0270`).
- **Status:** direct runtime dependency of `@guided-web/accessible-dom`.
- **Reused directly:** `computeAccessibleName`, `getRole`, `isInaccessible`,
  `isDisabled`.
- **What was NOT reused:** none of its test suite, build tooling, or any
  autonomous-agent infrastructure (it has none). Only the standard, published
  API functions are imported.
- **Compatibility / security note:** `getRole` returns `null` for
  `<input type="password">`; we add a minimal role fallback (`textbox`) for that
  narrow compatibility gap. The accessible-name calculation never reads an
  input's live value, so it cannot leak a password/OTP/card value; the sanitizer
  in `packages/accessible-dom/src/sanitizer.ts` remains the authoritative
  data-leak boundary and is applied across the top document, frames and shadow
  roots.

## Studied for concepts only (not imported)

### nanobrowser
- **Repository:** <https://github.com/nanobrowser/nanobrowser>
- **License:** Apache-2.0
- **Inspected revision:** default branch commit
  `24a14b76e14a9c30fd84878ca7985049d1e7d064`.
- **Studied:** open Shadow DOM traversal patterns, frame/root boundaries,
  iframe failure handling, compact DOM representation, visibility/interactivity
  concepts.
- **Reused:** design/reference only. We did not copy code; we re-implemented
  root-aware traversal and frame representation in our own MV3 content-script
  boundary.
- **Not reused:** planner, navigator, executor, autonomous actions,
  debugger/CDP runtime, Playwright runtime, multi-agent architecture, arbitrary
  model-selected selectors.

### Page Assist
- **Repository:** <https://github.com/n4ze3m/page-assist>
- **License:** MIT
- **Inspected revision:** default branch commit
  `7a5bc71ce7a9fcb736dcce471cef5aea10d7faad`.
- **Studied:** page-context budgeting, context truncation, content
  prioritization.
- **Reused:** concept only — deterministic relevance ranking and explicit
  context budgets.
- **Not reused:** the broad permanent host-permission model, side-panel
  extraction details, any extension host that requests `<all_urls>`.

### browser-use
- **Repository:** <https://github.com/browser-use/browser-use>
- **License:** MIT
- **Inspected revision:** default branch commit
  `fe5ad353091fa2ed5499b94e8fe21094bc2e9e5a`.
- **Studied:** interactive-element relevance, visibility heuristics, element
  prioritization, DOM simplification.
- **Reused:** concept only (deterministic relevance before truncation).
- **Not reused / not ported:** Python/CDP/Playwright/Puppeteer automation
  runtime, `backendDOMNodeId`, autonomous action execution, browser control.

## Official Chrome references audited (pre-G1 runtime closure)

These official references materially shaped the pre-G1 runtime-correctness
closure. No code was imported from them; they were audited for exact MV3
behaviour and are the source of the engineering decisions below.

### chrome.scripting.executeScript
- **Reference:** <https://developer.chrome.com/docs/extensions/reference/api/scripting>
- **Key fact:** `executeScript` accepts `target.frameIds: number[]` (specific
  frames) and `frameIds`/`allFrames` are mutually exclusive. The main frame id
  is always `0`.
- **How used:** we inject the extractor **separately per frame** with an explicit
  `frameIds:[frameId]` instead of `allFrames:true`. A child iframe for which the
  extension lacks permission can therefore never make the whole injection
  fail; each frame is isolated with `Promise.allSettled`.

### chrome.webNavigation
- **Reference:** <https://developer.chrome.com/docs/extensions/reference/api/webNavigation>
  (and `chrome.webNavigation.getAllFrames`/`getFrame`)
- **Key fact:** `getAllFrames({tabId})` returns `{frameId, parentFrameId, url}`;
  main frame has `parentFrameId === -1`.
- **How used:** to enumerate the frame tree for per-frame injection and to
  resolve the active top-frame URL when `tab.url` is unavailable (no `tabs`
  permission). The `webNavigation` permission is retained because these runtime
  paths require it; it may produce install/onboarding permission messaging.

### chrome.permissions.addHostAccessRequest
- **Reference:** <https://developer.chrome.com/docs/extensions/reference/api/permissions>
- **Key fact:** `addHostAccessRequest` is **Chrome 133+** (MV3).
- **Decision:** our `minimum_chrome_version` is **116**, so we did **not** adopt
  it. The existing explicit per-origin `permissions.request` UX is preserved.
  `addHostAccessRequest` is documented as a possible future simplification, not
  a current dependency. We did not add `tabs`, permanent `<all_urls>`, or
  `debugger`.

## Code provenance procedure

Before copying code from any upstream repository:
1. Verify the exact repository.
2. Verify the license.
3. Verify compatibility with this project.
4. Record the source in this file.
5. Add attribution where required.
6. Update `THIRD_PARTY_NOTICES.md`.

Prefer adapting concepts over copying large modules. Do not copy code from
repositories whose identity or license cannot be verified.
