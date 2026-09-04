# Upstream Reuse Policy

Guided Web Assistant is **not a fork** of any autonomous browser agent. Upstream
projects are studied for algorithms and patterns only; the operator/executor
runtime is intentionally not imported.

## Where our code comes from

Unless recorded in `THIRD_PARTY_NOTICES.md`, code in this repository is
original to this project. Anything adapted from upstream MUST be recorded here
with the exact repository, license, compatibility note and attribution.

## Candidate upstreams (studied; not imported wholesale)

### nanobrowser
- Could study/adapt: Manifest V3 patterns, extension messaging, Side Panel
  architecture, frame-routing lessons, iframe-related failure handling.
- **Do NOT import:** planners, autonomous agents, executors, autonomous browser
  actions, multi-agent infrastructure.

### browser-use
- Study: interactive-element filtering, visibility heuristics, DOM
  representation, accessibility-oriented representation, Shadow DOM concepts.
- **Do NOT port runtime architecture** that depends on CDP, Playwright,
  Puppeteer, browser automation, `backendDOMNodeId`, or autonomous action
  execution.
- Playwright is allowed as a **test tool** only; it is not a runtime dependency.

### dom-accessibility-api
- Evaluate as a possible direct dependency for accessible-name/description
  calculation and DOM accessibility semantics.
- **Status:** not yet adopted. P0 implements a light, built-in accessible-name
  heuristic. A known limitation: it is less accurate than a specialized library
  for complex/ARIA widgets. Adoption is an open decision.

### Overlay / highlighter projects
- Study overlay geometry, isolation, scrolling, resizing, Shadow DOM
  encapsulation. Do not blindly copy.

### Accessibility Insights
- Use as an accessibility reference and QA/architecture inspiration. Not a
  runtime dependency unless there is a clear justified reason.

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
