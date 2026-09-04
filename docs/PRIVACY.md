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

Only a **sanitized, compact DOM-derived snapshot** plus the user's typed
question are sent to the self-hostable backend. Specifically, the snapshot:

- contains roles, accessible names, interactive flags and element states;
- **never** contains input values (password, OTP, card numbers, tokens);
- excludes hidden inputs and script/style content.

The backend constructs the prompt and calls the configured AI provider.

## Data minimization and defence in depth

- We never serialize input values by default. For a textbox the state is
  represented as `{ "role": "textbox", "state": { "empty": false } }`, never
  `{ "value": "user secret here" }`.
- We detect and exclude password fields, OTP fields, card-number/CVV fields,
  authorization tokens and session identifiers.
- This is **data minimization and defence in depth**, not a promise of perfect
  privacy.

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
