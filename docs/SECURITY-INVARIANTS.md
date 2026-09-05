# Security Invariants

Treat these as auditable contracts. They are the properties this project
promises to uphold. Each states what is guaranteed and, where relevant, the
phase in which it is fully implemented.

**CURRENTLY IMPLEMENTED (P0)** and **TARGET** are distinguished inline.

| Id | Invariant | Phase |
| --- | --- | --- |
| P0-01 | The LLM never receives direct executable access to the DOM. | P0 |
| P0-02 | The LLM never executes arbitrary JavaScript. | P0 |
| P0-03 | Future LLM element references may only reference locally generated target IDs. | P1 |
| P0-04 | An ambiguous target must never be silently selected. | P1 |
| P0-05 | All webpage content is untrusted input. | P0 |
| P0-06 | Webpage content can never modify system policy. | P0 |
| P0-07 | Raw values of secret-bearing fields (password, OTP, payment-card number/CVV, recovery code, authentication token, hidden secret inputs) must never leave the browser. High-confidence secret-looking visible text is redacted as defence in depth. | P0 |
| P0-08 | A MutationObserver must never directly trigger an LLM request. | P1/P2 |
| P0-09 | Future actionable responses must belong to an explicit snapshot. | P1/P2 |
| P0-10 | A stale response must not be applied blindly. | P1/P2 |
| P0-11 | No `click`, `type` or `submit` capability exists in the initial architecture. | P0 |
| P0-12 | AI provider credentials exist only in backend configuration. | P0 |
| P0-13 | Authoritative quotas are enforced server-side. | P2 |
| P0-14 | Service-worker termination must not corrupt session state. | P0 (session is authoritative in the Side Panel; the service worker is stateless) |
| P0-15 | Structured output is not considered a complete safety boundary. Valid output still requires policy enforcement. | P0 |
| P0-16 | The assistant must never ask the user to disclose a password, OTP, recovery code, CVV or equivalent secret to the assistant. | P0 |
| P0-17 | Failure to resolve context must degrade safely to asking the user, escalation or blocking. It must never produce a silent guess. | P0 |
| P0-18 | If DOM context is insufficient and vision is forbidden by policy, the assistant MUST NOT reason about unseen interface elements. Allowed outcomes are exclusively `ask_user`, `escalate`, `block`. | P2 |
| P0-19 | Installing/configuring the assistant as a Trusted Contact MUST NOT grant access to the Assisted User’s browsing, conversations, screenshots, history or sessions. | P2 |
| P0-20 | Escalation packages MUST contain only the minimum information necessary for the specific problem and must not automatically contain unrelated history. | P2 |
| P0-21 | The system MUST distinguish escalation prepared / shared / delivery confirmed / contact-response-received and MUST NOT imply a human is reviewing unless actually known. | P2 |
| P0-22 | The current help session is ephemeral, bounded (≤ ~10 turns), never stores page snapshots as history, never retains secret input values, and is NOT a browsing history or behavioural profile. | P0 |
| P0-23 | Conversation history must never bypass the sanitizer or secret policy, and page/injection content must never be able to inject arbitrary conversation roles or become a system instruction. | P0 |

---

## How P0 enforces these today

- **P0-01 / P0-02:** The DOM never reaches the model as code. Only a sanitized
  JSON snapshot is sent. No `chrome.debugger`, no CDP, no `executeJavaScript`.
- **P0-05 / P0-06:** Page content is inserted only as serialized data into a
  system prompt that labels it untrusted. The codebase never parses page text
  as instructions.
- **P0-07:** Classified sensitive control values are collected locally from
  captured documents, including hidden inputs and open shadow roots. Every
  outbound string is sanitized before AssistRequest validation: question,
  accessible names, prose, metadata, goal, previous user and assistant turns.
  The dictionary stays in extension messaging/memory, never HTTP, checkpoints
  or logs. Privacy collection/work-budget failures block capture.
  - **GUARANTEE:** classified raw sensitive form-control values are removed
    before outbound serialization; structural collisions fail closed.
  - **DEFENSE IN DEPTH:** ordinary secret-looking prose is heuristically redacted.
    Arbitrary prose, inaccessible frames and closed shadows are not exhaustively
    classifiable. See the exact scope in the PRE-P01 closure contract.
  - Provider-visible URLs omit query, fragment and credentials; permission checks
    keep using the authoritative browser origin.
- **P0-11:** There is no `click`, `type`, `submit`, `purchase`, `delete`,
  `send`, `executeJavaScript`, or arbitrary-remote-control primitive anywhere
  in the runtime code. Playwright exists only as a test tool.
- **P0-12:** `AI_API_KEY` is read only in `apps/api/src/config.ts` from the
  backend environment. The extension bundle contains no provider key.
- **P0-15 / P0-16:** After strict schema validation, every message passes the
  instruction-safety check (`packages/security-policy`) which blocks/replaces
  requests for secrets.
- **P0-17:** The decision vocabulary has an explicit `cannot_help` outcome and
  the UI shows a clear failure message; nothing is silently guessed.
- **P0-14:** The current help session is authoritative in the **Side Panel**
  (live UX state), with a recoverable checkpoint in `chrome.storage.session`.
  The service worker is stateless: it only forwards a sanitized request. A
  worker restart cannot corrupt the session because the worker holds no session
  state. `apps/extension/src/service-worker/logic.test.ts` verifies that a
  fresh worker invocation always fetches from the backend (never reuses a prior
  response) and that a backend failure yields `ok:false` — it can never present
  a stale answer from a previous execution as valid.
- **P0-22 / P0-23:** The session module (`apps/extension/src/session/session.ts`)
  bounds turns deterministically (≤ `MAX_TURNS`), never stores a snapshot in a
  turn, and redacts user-typed secret values before retention. The strict
  `HelpSessionSchema` rejects unknown roles/fields, so page or user text cannot
  inject arbitrary conversation roles. The backend keeps page content in the
  user message only and never merges it into the system policy.

---

## Known P0 limitations

- Instruction safety is keyword-pattern based. It is defence in depth, not a
  complete solution to semantic prompt injection.
- Visible-text secret redaction is contextual/keyword-based (defence in depth),
  not an exhaustive DLP. The hard guarantee covers classified raw sensitive control values
  in captured documents at the outbound boundary.
- P0 has a 512 KiB pre-parse body limit, collection limits and two underlying
  provider calls maximum. Distributed/per-user quotas remain P2.
- No screenshot redaction / vision policy yet (P0-18 is P2).
- No target identity/resolution or stale-response guarding yet (P0-03/04/09/10
  are P1/P2).
- The current help session is ephemeral and bounded; it is not a durable,
  cross-session persistent store. Durable sessions remain future (P1/P2) and
  would require re-verifying P0-14/P0-22.

See [PRE-P01 closure contracts and operator smoke](PRE-P01-SECURITY-CLOSURE.md)
for exact limits, verification evidence and release gates.
