# Roadmap

The full target architecture is documented in `TARGET-ARCHITECTURE.md`. This
file tracks the delivery phases and their current status.

## P0 — Product Validation (CURRENT: implemented)

Minimal assistant: extension Side Panel, on-demand sanitized snapshot, a
**bounded, ephemeral current-help-session conversation**, a per-origin
permission UX, backend, configurable provider, one simple instruction. No
autonomous continuation, no highlight, no voice, no trusted contact, no
browsing history.

**Goal:** gather directional evidence about DOM-derived sufficiency, including
short conversational follow-ups and entry/access friction.

## P1 — Guided Highlight Prototype (NEXT)

**Documented, NOT implemented.**

Expected additions:
- `targetId`, `snapshotId`
- basic target registry
- highlight overlay
- stale-response protection
- manual “done / continue” interaction
- structured highlight decisions

**Purpose:** compare text-only guidance versus text + visual highlight.

## P2 — Assisted Navigation MVP (DOCUMENTED)

**Documented, NOT implemented.**

Expected additions:
- Side Panel production UX
- robust target fingerprints
- target resolver
- MutationObserver
- semantic diff
- SPA continuity
- per-frame collectors
- open Shadow DOM traversal
- voice, push-to-talk, TTS cancellation/barge-in
- vision fallback
- local screenshot redaction
- risk policies
- resilient session state
- backend budgets + advanced rate limiting
- escalation package
- trusted-contact UX

## Future / explicitly out of scope

Autonomous clicking, typing, submission, payments, banking operations, digital
signatures, remote desktop, browser RPA, unattended workflows, general-purpose
browser agent, multi-agent browsing.

> Any future proposal to introduce such capabilities MUST require a new
> threat-model review.
