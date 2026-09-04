# Privacy Model

## Actors

```ts
type UserRole =
  | "assisted_user"
  | "trusted_contact";
```

- **Assisted user:** the person with low digital confidence who uses the
  assistant to understand a web page. They remain in control of the browser.
- **Trusted contact:** a person the assisted user may later ask for help. In
  the target architecture they may install/configure the extension, configure
  usability preferences, and receive explicitly shared escalation packages.

The Trusted Contact MUST NOT automatically view conversations, visited URLs,
browsing history, sessions, screenshots or activity of the assisted user. There
is no hidden “family dashboard”.

## What leaves the browser (P0)

Only a **sanitized, compact DOM-derived snapshot**, the user's current question
and a **short, bounded recent help conversation** are sent to the
self-hostable backend. Specifically, the snapshot:

- contains roles, accessible names, interactive flags and element states;
- **never** contains input values (password, OTP, card numbers, tokens);
- excludes hidden inputs and script/style content;
- redacts **high-confidence** secret-looking visible text (a strong
  secret-context phrase immediately preceding a digit run, e.g.
  “Tu código de verificación es 938271”). A date, price, postal/order number is
  deliberately not redacted solely because it contains digits.

The current help conversation is bounded (the most recent ~10 turns), never
contains page snapshots, and is never used to build a browsing history or a
behavioural profile. The backend constructs the prompt and calls the configured
AI provider.

## Current Help Session (≠ Browsing History)

The assistant keeps a small, **ephemeral**, session-scoped memory of the current
help task so it can answer short follow-ups like “ya estoy” or “¿y ahora?”. This
is **not** a browsing history.

**What is kept**

- A short, bounded recent conversation (up to ~10 turns): user questions and the
  assistant's replies, with timestamps.
- An optional `goal` (the original user intent) and the most recent page origin.
- Stored **only** in the Side Panel live state and, as a recoverable checkpoint,
  in `chrome.storage.session` (which clears on browser restart).

**What is NEVER kept**

- Browsing history or a list of visited URLs/pages.
- Page snapshots inside the conversation (the DOM is always captured fresh per
  request and never stored as history).
- Full email/page contents as historical state.
- A permanent behavioural profile or cross-session memory.
- Secret values. If a user accidentally types a password/OTP/card value into the
  question box, it is redacted before it is stored in the conversation.

**Where and how long**

- Side Panel: authoritative live state for the current help task.
- `chrome.storage.session`: ephemeral, cleared on browser restart.
- **Not** `chrome.storage.local`: no permanent user activity history.

**How to clear it**

- The “Nueva ayuda” button clears the goal and conversation and starts a fresh
  session. It does not clear unrelated browser data.

## Data minimization and defence in depth

- We never serialize input values by default. For a textbox the state is
  represented as `{ "role": "textbox", "state": { "empty": false } }`, never
  `{ "value": "user secret here" }`.
- We detect and exclude password fields, OTP fields, card-number/CVV fields,
  authorization tokens and session identifiers.
- **Guaranteed:** raw values of secret-bearing form fields are never serialized.
- **Defence in depth:** secret-looking visible text is redacted only when
  contextual classification is strong (a secret-context phrase precedes the
  value). This is statistical, not a promise about arbitrary prose.
- Conversation history can never bypass the sanitizer: page snapshots are never
  stored in a turn, and user-typed secret values are redacted at write time.
- This is **data minimization and defence in depth**, not a promise of perfect
  privacy.

## Trusted inference boundary for this deployment

This deployment is configured with **nan.builders** (`AI_BASE_URL`,
`AI_MODEL=qwen3.6`) as the trusted inference boundary. Ordinary visible page
context (mail subjects, headings, product info, headlines) may be sent to that
backend when needed to answer the user's request, and no extra warning dialog is
inserted before each request.

This trust assumption is **specific to this deployment**. Do not assume that all
possible deployment providers have identical privacy properties. Independent of
the provider, the structural secret-safety invariants are preserved: passwords,
OTP/MFA codes, card numbers, CVV, auth tokens, API keys, hidden secret fields
and raw sensitive input values are never serialized or retained.

## Telemetry

- No telemetry by default.
- No analytics SDK by default.
- No crash-reporting service by default.

If telemetry is ever added it must be voluntary, documented, privacy-preserving
and separately consented to.

## P0 validation data

P0 validation data remains **local** unless the operator explicitly exports it.
Validation templates live under `docs/validation/`; real participant data is
git-ignored and never committed. Participants are referred to by aliases
(`P01`, `P02`, …). Unnecessary personal data is not collected.

For G1 (P01–P04), only fixtures, dedicated test accounts and dummy form data
must be used. Participants must never use real passwords, OTP/verification
codes, payment cards, recovery codes or banking data.
