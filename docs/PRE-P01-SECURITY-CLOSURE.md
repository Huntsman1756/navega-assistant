# PRE-P01 security candidate (not a G1 baseline)

P01 has not started. v0.0.8-p0-g1-baseline remains immutable at
05898434b480f11a0a8b59e115a150b1e54d10da. This closure repairs confirmed
SECURITY_BLOCKER / STUDY_VALIDITY_BLOCKER findings; it adds no product capability.
Automated PASS does not authorize P01 or a v0.0.9 tag.

## Contracts

- **F1:** classified raw sensitive values from captured form controls are removed
  across every outbound string before the validated request leaves the extension.
  Password/autocomplete, OTP, CVV/card, API-key/token/secret/recovery controls and
  hidden inputs are covered by local classification. Dictionaries remain in
  extension messaging/memory, never HTTP payloads, checkpoints or logs. A privacy
  scan/work-budget failure blocks capture. Closed shadows, unpermitted/unselected
  frames and arbitrary prose are outside observable classification. Ordinary
  secret-looking prose gets heuristic defense in depth. Short values colliding
  with structural schema keys fail closed. URL query, fragment and credentials
  are omitted; permission checks still use the authoritative browser origin.
- **F2:** API binds 127.0.0.1. Hono bodyLimit rejects above **512 KiB** before JSON
  parsing, allowing the context plus ten worst-case escaped turns. Two underlying
  provider calls maximum; no queue or retry. A provider ignoring abort holds its
  slot until settlement; two permanently stuck calls require backend restart.
  Local processes remain trusted callers; this is not per-user authentication.
- **F3:** final PageContext <= **16,000 JSON UTF-16 code units**, measured using
  JSON.stringify including escaping, metadata and truncation indicator. This is
  neither an approximate token count nor a byte claim; HTTP admission is in bytes.
  Server schema independently enforces that size and **220 total elements**.
  Per snapshot: 200 elements, 40 prose entries, 160-character names, 300-character
  prose/title, 1,000-character reduced URL/origin, 64-character IDs/tags/roles,
  100-character unavailable reason. Eight frames selected before injection (top
  first, then enumeration order); unattempted frame reachability is unknown.
  Each DOM traversal stops at 10,000 nodes and fails closed on overflow. This
  bounds traversal, not wall-clock time inside upstream accname/style functions.
  Controls precede prose; `truncated` signals reductions. Per-frame capture uses
  a default 12,000-code-unit envelope before the final global bound.
- **F4:** navigation/dialog relevance follows up to 64 ancestors including open
  shadow-host transitions. Same-name controls with distinct states have distinct
  duplicate groups. No CDP, target resolver or replacement of dom-accessibility-api.
- **F5:** dev/start load root .env using native Node --env-file. Provider selection
  is explicit. Process overrides win; health exposes safe provider/model metadata.
  G1 requires openai-compatible / qwen3.6 at NaN.
- **F6:** shared Zod validates response envelopes, normalized nonempty decisions,
  and recovered sessions. User/assistant turns commit together after success.
  Ten turns, 4,000 characters/turn, 2,000-character current question.
- **F7:** the failed sanitized question returns to the textarea. Manual retry
  captures afresh and appends no duplicate user turn. No automatic retries or
  stale response after the fetch deadline; reset is disabled while in flight.
- **F8:** CI fetch-depth: 0; scanner rejects shallow repositories, scans template
  values and checks forbidden historical env paths separately. Scope is objects
  reachable from locally available refs, not unreachable/deleted refs. Exact dummy
  exceptions and non-adoption decision: [Gitleaks evaluation](GITLEAKS-EVALUATION.md).
  No universal absence claim.
- **F9:** loopback fixture server catches decoding/filesystem errors and rejects
  traversal, directories and missing files. Playwright starts a dedicated mock
  API at 18787 and refuses existing servers; it never borrows the operator API.

Existing upstream: dom-accessibility-api, native DOM/URL, Zod, Hono body-limit /
@hono/node-server, Node --env-file and GitHub checkout fetch-depth. No dependency,
provider SDK, browser-agent runtime or OSS source copy was added. Hono's locked
implementation buffers bounded unknown-length bodies before invoking the handler:
https://hono.dev/docs/middleware/builtin/body-limit and
https://github.com/honojs/hono/security/advisories/GHSA-9vqf-7f2p-gf9v .

## Automated evidence

- `apps/extension/src/sidepanel/outbound.test.ts`: DOM/session/question through
  worker, backend and adapter to the captured complete provider HTTP body.
- `apps/extension/e2e/security-boundary.spec.ts`: built extractor in Chromium,
  synthetic HTML, same complete provider serialization. Provider transport is
  stubbed; this is not a NaN call or real MV3 permission test.
- API admission tests: normal/rejected bodies, collections, loopback socket and
  underlying calls that ignore abort.
- Accessible-DOM budget and capture tests: escape-heavy metadata, large DOM,
  bounded frame work and adversarial navigation/dialog/state fixtures.
- Worker/controller/session tests: invalid envelopes/checkpoints, empty messages,
  exact manual retry intent and fresh capture.
- History tests: deterministic temporary Git repositories and shallow clone.
- Fixture-server E2E: malformed requests followed by valid requests.

Required gates: pnpm lint, pnpm typecheck, pnpm test, pnpm build,
pnpm security:check, pnpm security:git-history, pnpm verify, pnpm test:e2e.
Remote CI must pass on the pushed exact main SHA. Review is sequential self-review,
not an independent-context agent review.

## Operator: real Chrome + real NaN security smoke

Use the reported PRE_P01_SECURITY_CANDIDATE_SHA, clean checkout, matching origin/main
and passing CI head SHA. Record Chrome version, OS, operator, date, SHA and build
command in local ignored validation data. Never record credentials or real secrets.

1. Build (`pnpm build`). Configure ignored root .env with openai-compatible,
   https://api.nan.builders/v1, qwen3.6, timeout 8000 and the backend-only API key.
   Clear stale process AI_* overrides. Start `pnpm --filter @guided-web/api start`.
2. Check http://127.0.0.1:8787/health: record only provider/model. Inspect the
   listening socket (Windows Get-NetTCPConnection -LocalPort 8787 -State Listen)
   and confirm LocalAddress=127.0.0.1. Effective provider request model is qwen3.6.
3. Load apps/extension/dist unpacked in real Chrome. Open the actual Side Panel
   from the toolbar and inspect its actual MV3 service worker. Record human clicks
   on native permission dialogs; no simulated chrome API is acceptable here.
4. Ask normal GitHub guidance, navigate manually and ask a follow-up. Confirm fresh
   page context and a valid conversation restored from storage.session after
   reopening the panel or restarting the worker.
5. Visit a second origin; deny then explicitly grant permission when prompted.
   Confirm per-origin scope and original question, with fresh post-grant capture.
6. Serve tests/fixtures locally; open security-boundary.html with synthetic query
   and fragment markers. Put synthetic markers in question, goal, previous turn
   and assistant echo as in the automated regression. Inspect the actual worker
   POST and locally inspect the serialized provider body before adapter fetch:
   every SECRET_* fixture marker must be absent. Record booleans only, never the
   dictionary, Authorization header or provider key.
7. Force network/backend failure after a custom question. Confirm friendly text,
   no technical codes, restored controls and exact sanitized text in textarea.
   Restore backend, change the page, click Ayúdame without retyping: same intent,
   fresh capture, no duplicate turns and valid session.
8. Record duration-only perf metrics for capture/assist/backend/provider/total.
   Confirm no automatic retry, telemetry or persistent perf logs.

Record each item PASS/FAIL. LIVE_CHROME_SECURITY_SMOKE=PASS requires every item on
the actual built MV3 extension with NaN/qwen3.6. Automated Chromium with chrome
stubs is not a substitute; no permission-dialog automation is required.

Only after that PASS may the EXACT SAME SHA be annotated v0.0.9-p0-g1-baseline,
with no intervening code changes. Then update study documents to state P01–P04
use v0.0.9. Until then: TAG_CREATED=NO and P01_ALLOWED=NO.
