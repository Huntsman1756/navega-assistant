# Threat Model

For each threat: asset, threat, attack path, mitigation, remaining risk, and the
phase where the mitigation is implemented. **P0 limitation** vs **target
safeguard** is distinguished.

## 1. Malicious webpage content
- **Asset:** the model's reasoning and any future capability.
- **Threat:** a page plants instructions that try to steer the assistant.
- **Attack path:** malicious text ("***SYSTEM:*** ignore previous instructions...") lands in the snapshot → becomes model input.
- **Mitigation:** page content is labelled untrusted in the system prompt; strict output kinds; instruction-safety layer. **(P0)**
- **Remaining risk:** prompt-injection is not fully solved by wording + patterns.
- **Phase:** P0 (partial), ongoing.

## 2. Semantic prompt injection producing dangerous guidance
- **Asset:** the assisted user's secrets / actions.
- **Threat:** injected content causes the model to ask for a password/code.
- **Attack path:** page text → model → schema-valid but unsafe instruction.
- **Mitigation:** deterministic safety check blocks/replaces secret requests; output schema is narrow; no action primitives exist. **(P0)**
- **Remaining risk:** keyword patterns can miss novel phrasing.
- **Phase:** P0; strengthen in P2 with risk engine.

## 3. Provider compromise / failure
- **Asset:** model output quality/availability; possibly data.
- **Threat:** provider returns malicious, malformed or slow responses.
- **Attack path:** provider output parsed as JSON → schema rejected.
- **Mitigation:** strict schema validation; provider abstracted; mock provider for offline. **(P0)**
- **Remaining risk:** valid-but-wrong guidance is not caught by schema.
- **Phase:** P0; P2 adds risk/verification.

## 4. Accidental secret collection
- **Asset:** passwords, OTPs, CVV, tokens.
- **Threat:** inputs read into the snapshot and sent to the backend.
- **Attack path:** `input.value` serialized.
- **Mitigation:** extractor never serializes input values; secret fields classified; hidden inputs excluded. **(P0)**
- **Remaining risk:** novel encodings/secrets in custom widgets.
- **Phase:** P0; P2 adds DOM masking for vision.

## 5. Screenshot leakage
- **Asset:** visible private data on screen.
- **Threat:** a screenshot reaches the backend/provider.
- **Attack path:** vision mode captures screen.
- **Mitigation:** vision is disabled by default and experimental; not used on banking/payment pages. **(P0)**
- **Remaining risk:** manual misuse by operator.
- **Phase:** P2 adds complete redaction + `visionAllowed` policy.

## 6. Malicious redirects
- **Asset:** session continuity / confusion.
- **Threat:** the page navigates somewhere unexpected while assisting.
- **Attack path:** SPA or redirect changes the page under the snapshot.
- **Mitigation:** P0 is read-only; P1/P2 snapshot consistency guards stale responses. **(P2)**
- **Phase:** P2.

## 7. Stale page context / target swapping
- **Asset:** user acting on the wrong element.
- **Threat:** the response references an element that changed.
- **Attack path:** target disappears → ambiguous match chosen.
- **Mitigation:** target resolver never picks among ambiguous candidates; stale = degrade. **(P1/P2)**
- **Phase:** P1/P2.

## 8. Ambiguous target resolution
- **Asset:** user performing an unintended action.
- **Threat:** "closest match" pick.
- **Mitigation:** explicit ambiguous → ask user. **(P1/P2)**
- **Phase:** P1/P2.

## 9. Race conditions
- **Asset:** correctness.
- **Threat:** request/response interleaving after page change.
- **Mitigation:** snapshot/session consistency; no automatic follow-up. **(P2)**
- **Phase:** P2.

## 10. Extension permission abuse
- **Asset:** browsing access.
- **Threat:** over-broad permissions let the extension read too much.
- **Mitigation:** least-privilege manifest (`activeTab`, `scripting`, `storage`, `sidePanel`); no `<all_urls>`; no `debugger`. **(P0)**
- **Remaining risk:** future feature creep.
- **Phase:** P0, reviewed on each change.

## 11. API-key theft
- **Asset:** provider credentials / cost.
- **Threat:** key exposed in client.
- **Mitigation:** key only in backend config; extension never receives it. **(P0)**
- **Phase:** P0.

## 12. Backend abuse
- **Asset:** cost/availability.
- **Threat:** unauthenticated or runaway requests.
- **Mitigation:** server-side quota/rate limit; dedupe. **(P2)**
- **Phase:** P2.

## 13. Repeated requests / loops
- **Asset:** cost/UX.
- **Threat:** auto-retriggering of the model (e.g., via MutationObserver).
- **Mitigation:** only explicit user action triggers a request; observer never calls the LLM. **(P0 design; P2 full)**
- **Phase:** P0 (design), P2 (enforcement).

## 14. Misleading assistant instructions
- **Asset:** user trust/correctness.
- **Threat:** plausible but wrong guidance.
- **Mitigation:** narrow output kinds; simplicity policy; conservative `cannot_help`. **(P0 partial)**
- **Remaining risk:** model can be wrong.
- **Phase:** P2 adds verification/risk.

## 15. Trusted-contact privacy escalation
- **Asset:** assisted user's privacy.
- **Threat:** contact sees unrelated private activity.
- **Mitigation:** explicit escalation only; minimal package; no auto history. **(P2)**
- **Phase:** P2.

## 16. False indication that human assistance is active
- **Asset:** user safety/dependency.
- **Threat:** UI implies a human is reviewing when not.
- **Mitigation:** precise state model; never claim review unless known. **(P2)**
- **Phase:** P2.
