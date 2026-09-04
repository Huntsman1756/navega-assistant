# P0 Specification (Implemented)

> Experimental product-validation prototype. Not production-ready.

## Goal

A minimal assistant that:
- opens from a Chromium extension (Side Panel);
- observes the current tab **after an explicit user action**;
- extracts a compact, sanitized, DOM-derived **AccessibleDOMSnapshot**;
- receives a user question;
- sends the safe context to the self-hostable backend;
- calls a configurable AI provider;
- returns **one simple instruction/explanation**;
- optionally records an operator validation outcome locally.

## Deliberately NOT implemented in P0

- autonomous continuation
- complex target resolution
- automatic highlighting
- voice
- trusted-contact delivery
- complex iframe handling
- sophisticated Shadow DOM support
- automatic vision routing (DOM_PLUS_VISION is an operator-chosen experimental mode)

## Product boundary

No runtime primitive for `click`, `type`, `submit`, `purchase`, `delete`,
`send`, `executeJavaScript`, or arbitrary remote control. Playwright is a test
tool only.

## AccessibleDOMSnapshot

A compact, accessibility-oriented, DOM-derived representation. It is **not** the
browser's native Accessibility Tree and does not use `chrome.debugger`/CDP.

```ts
interface AccessibleDOMSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  page: { url: string; origin: string; title: string };
  elements: AccessibleElement[];
  visibleText?: string[];
}
```

Element IDs are diagnostic identifiers only. They are NOT stable across
rerenders (P1 introduces robust target identity).

## Sanitization

- Never serialize input values.
- Detect and exclude password/OTP/card/token secrets.
- Exclude hidden inputs and script/style content.
- Described as data minimization + defence in depth.

## Pipeline

```text
raw provider output
        ↓
JSON parsing
        ↓
strict schema validation (additionalProperties: false)
        ↓
instruction safety checks
        ↓
conversation simplicity checks
        ↓
assistant UI
```

## Decision vocabulary

```ts
type P0AssistantDecision =
  | { kind: "explain"; message: string }
  | { kind: "ask_user"; message: string }
  | { kind: "cannot_help"; reason: string; message: string };
```

## Extension permissions

`activeTab`, `scripting`, `storage`, `sidePanel`. No `debugger`, no `<all_urls>`.

## Validation recording

A local, optional operator outcome field. Never uploaded by default.
