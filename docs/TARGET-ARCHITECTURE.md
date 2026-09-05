# Target Architecture

This document separates **TARGET** (the complete, conceptually designed
architecture) from **CURRENTLY IMPLEMENTED** (what exists today in P0). Do not
assume that everything below already exists.

---

## 1. Principle

> This is a guided-navigation assistant, NOT an autonomous browser agent.

The assistant observes, understands, explains and eventually highlights. The
human remains the executor. This distinction is enforced at the architecture
level (no autonomous action primitives exist), not merely in a system prompt.

---

## 2. System diagram (TARGET)

```text
┌──────────────────────────────────────────────┐
│              Chrome / Edge                   │
│                                              │
│ Web page                    Assistant UI     │
│ ┌────────────────┐          ┌─────────────┐ │
│ │ Gmail          │          │ Conversation│ │
│ │ Amazon         │          │ Guidance    │ │
│ │ Instagram      │          │ Voice later │ │
│ │ Forms          │          └──────┬──────┘ │
│ └───────┬────────┘                 │        │
│         │                           │        │
│ Content Script                     │        │
│         │                           │        │
│         └─────────────┬─────────────┘        │
│                       │                      │
│               Service Worker                 │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
                 Self-hostable API
                        │
              ┌─────────┼──────────┐
              │         │          │
           Schemas    Policy    Provider
              │         │          │
              └─────────┼──────────┘
                        │
                        ▼
                 AI Provider API
```

---

## 3. Component responsibilities

### Extension content layer (TARGET)
- DOM-derived page representation
- sanitization
- accessible names
- interactive-element extraction
- local target registry
- DOM mutation observation
- semantic state changes
- overlays
- target resolution

**P0 implements** only the safe extraction/sanitization subset.

### Extension UI (TARGET)
Expose extremely simple actions:
- “Help me with this page”
- “Explain this page”
- “What do I press?”
- “I don’t know what to do”

**CURRENTLY IMPLEMENTED (P0):** a minimal Side Panel with a question field, a
context-mode indicator, a “Ayúdame” action, a “Nueva ayuda” reset, and a small
**current-help-session conversation** (bounded recent turns). The assistant
remembers the current help task so it can answer short follow-ups; it does not
collect browsing history.

### Manifest V3 service worker
Treat as ephemeral. Do not rely on long-lived global variables. Target
responsibilities:
- extension routing
- browser APIs
- permissions
- communication with backend

State that must survive worker termination must not live only in worker
memory. **P0** uses it for side-panel open behaviour and for forwarding
sanitized requests to the backend.

### Backend
The backend is a trust boundary. The provider API key MUST exist only here.
Responsibilities:
- receive validated extension requests
- reject malformed requests
- minimize data
- construct provider prompts
- invoke the AI provider
- parse output
- enforce response schema
- apply safety policy
- rate limit / deduplicate (later)
- avoid logging sensitive payloads by default

The backend MUST be self-hostable. **CURRENTLY IMPLEMENTED:** strict request
validation, system-prompt construction, provider invocation, JSON parsing,
strict decision validation, instruction-safety check, simplicity check.

---

## 4. AI provider abstraction (CURRENTLY IMPLEMENTED)

```ts
export interface AIProvider {
  assist(request: AssistModelRequest, signal?: AbortSignal): Promise<AssistModelResponse>;
  vision?(request: VisionModelRequest, signal?: AbortSignal): Promise<VisionModelResponse>;
}
```

Providers:
- `mock` (deterministic, offline; used for tests/CI and the P0 demo)
- `openai-compatible` (any OpenAI-compatible `/chat/completions`; every model
  provider, including **nan.builders**, is configured through this)

Configuration is environment-based via `.env`. The extension MUST NEVER receive
`AI_API_KEY`.

---

## 4bis. Latency, fail-fast deadlines and error taxonomy (CURRENTLY IMPLEMENTED)

Real-provider measurements (qwen3.6 via an OpenAI-compatible endpoint, 20
samples): p50 ~0.7 s, p95 ~1.7 s, with a heavy-tail outlier (~11.5 s). The
median is healthy; the risk is an unbounded outlier leaving the user waiting
forever at “Preguntando al asistente…”. The closure is **deadlines + honest
errors**, NOT model/context changes, NOT retries, NOT streaming.

### Provider deadline (backend)

- Every provider call runs under a hard `AbortController` deadline, applied by
  the backend and passed to `provider.assist(request, signal)`. The
  `openai-compatible` provider forwards the signal to `fetch`, so a hung
  request is actually cancelled (socket released).
- Configured via `AI_PROVIDER_TIMEOUT_MS`, **default 8000 ms**, defensively
  validated: it must be an integer between 1000 and 30000; anything else logs a
  warning and falls back to 8000 (a bad `.env` can never disable fail-fast).
- On expiry the route answers **HTTP 504 `{ "error": "provider_timeout" }`** —
  distinct from `provider_unavailable` (502) and `invalid_model_output` (502).
  The deadline timer is always cleared after success or failure.
- **No automatic retry.** A timed-out request is final; the user may retry
  manually. **No streaming** (not justified at p50 < 1.2 s).

### Extension fail-safe deadline (browser side)

- The service worker wraps the extension → localhost request with its own
  deadline: `BACKEND_REQUEST_TIMEOUT_MS = 12000`. It is deliberately LONGER
  than the provider deadline (8000) so the backend almost always wins the race
  and returns a precise `provider_timeout`; the browser deadline only fires if
  the backend itself is hung or unreachable.
- If OUR deadline fires first → `backend_timeout`. A connection failure remains
  `network`. Both are distinguishable from a backend-returned
  `provider_timeout`.
- The abort also cancels the fetch, so a late backend answer can never reach
  the UI after a timeout.

### Machine-readable error taxonomy

| Code                  | Where produced      | HTTP | Meaning                                |
| --------------------- | ------------------- | ---- | -------------------------------------- |
| `invalid_request`     | backend             | 400  | Schema validation failed               |
| `provider_timeout`    | backend             | 504  | Provider exceeded its hard deadline    |
| `provider_unavailable`| backend             | 502  | Provider call failed (raw error NEVER forwarded) |
| `invalid_model_output`| backend             | 502  | Output was not JSON / failed the schema |
| `backend_timeout`     | extension (SW)      | —    | Local backend did not answer within 12 s |
| `network`             | extension (SW)      | —    | Local backend unreachable              |
| `backend_error`       | extension (SW)      | —    | Unexpected backend shape/status        |

### Participant-visible errors

G1 participants never see codes or raw error text. The side panel maps each
code to a short Spanish message (technical code goes to the local console
only): `provider_timeout` → “Está tardando más de lo normal. Inténtalo de
nuevo.”; `network` → “No pude conectar con el asistente. Inténtalo de
nuevo.”; `provider_unavailable` → “El asistente no está disponible ahora
mismo. Inténtalo de nuevo.”; `invalid_model_output` → “No pude interpretar la
respuesta. Inténtalo de nuevo.”; anything unexpected → “Algo salió mal.
Inténtalo de nuevo.” A failed turn never invents an assistant answer, never
duplicates the user turn, and re-enables the controls.

### Local-only performance instrumentation (NOT telemetry)

Plain `console` logs of durations, with no question, page content, session
contents, URL, user id or credential. Nothing is persisted or sent anywhere:

```text
[perf] capture_ms=180              (side panel: capture start → PageContext ready)
[perf] assist_request_ms=920       (side panel: send → backend response received)
[perf] backend_request_ms=905      (service worker: fetch → response/error)
[perf] provider_ms=870 result=ok   (backend: around provider.assist; ok|timeout|error)
[perf] total_ms=1130               (side panel: question submitted → final state rendered)
```

---

## 5. Future concepts (documented, NOT implemented in P0)

| Concept | Intended role |
| --- | --- |
| content script per frame | Extract context independently in each frame; avoid cross-frame surprises |
| accessible DOM extractor | Present; P0 does the top-level document |
| sanitizer | Present (P0) |
| target registry | Map `targetId` → live element + fingerprint |
| target fingerprints | Stable-ish descriptors for uncertain identity |
| target resolver | Resolve live node > fingerprint; never silently pick among ambiguities |
| snapshot consistency | Guard against applying a response to a changed page |
| semantic diff | React only to meaningful DOM state changes |
| MutationObserver | Observations, never a direct trigger of an LLM call |
| isolated overlay | Highlight; owned by the extension, `pointer-events: none` |
| side panel | Present (P0, minimal conversation) |
| session state | Ephemeral in P0 (Side Panel + `chrome.storage.session`); not a browsing history; durable/resilient session is future |
| provider abstraction | Present (P0) |
| schema validation | Present (P0) |
| policy engine | Present (P0, minimal safety) |
| risk engine | Future; decide what is safe to guide on |
| vision | Experimental only, gated |
| voice | Future (P2): push-to-talk, TTS barge-in |
| trusted contact | Future, privacy-preserving escalation |

---

## 6. Future target resolution design

Future targets use:

```text
targetId, snapshotId, frameId, fingerprint, WeakRef<Element> while alive
```

```text
live node exists
      ↓ use
otherwise
      ↓ fingerprint resolution
      ↓
0 candidates → stale
1 safe candidate → resolved
>1 plausible candidates → ambiguous
```

Never choose “the closest match” when multiple plausible targets remain.

---

## 7. Future snapshot consistency

```text
snapshot 128 → LLM request → page changes → snapshot 129 → response for 128 arrives
```

The response must not be applied blindly. P1/P2 must verify applicability.

---

## 8. Future semantic diff

```text
mutation → debounce → extract relevant state → semantic fingerprint → meaningful change?
```

Meaningful: target disappeared; URL changed; new dialog; new main heading; error
appeared; form state changed materially. Ignore: animation, timestamps,
counters, ads, tracking DOM, transient framework nodes. **MutationObserver must
never call the LLM directly.**

---

## 9. Future overlay

- independent overlay host attached under `document.documentElement`
- isolated Shadow Root
- `pointer-events: none`
- high z-index
- geometry from `getBoundingClientRect()`
- no modification of target element CSS
- do NOT attach a Shadow Root directly to `<body>`

---

## 10. Future voice

Push-to-talk before always-listening. Desired behaviour:

```text
TTS speaking → user presses mic → TTS abort → settling delay → mic starts
```

Request audio capture with platform echo cancellation/noise suppression where
available. Do not assume AEC is perfect.

---

## 11. Future trusted contact

Privacy-preserving support role. The assisted user explicitly triggers
`[ Ask for help ]`. Only then may a minimal escalation package be prepared.

```text
ESCALATION_PREPARED → ESCALATION_SENT → WAITING_FOR_CONTACT → CONTACT_RESPONDED
```

Never display “Someone is reviewing this” unless that fact is genuinely known.

---

## 12. CURRENTLY IMPLEMENTED (P0)

- TypeScript pnpm monorepo (`apps/extension`, `apps/api`, `packages/*`)
- MV3 extension: `activeTab`, `scripting`, `storage`, `sidePanel`; required host
  access only to `http://localhost/*` / `http://127.0.0.1/*`; broad host
  capability declared **optionally** (per-origin grants, never default)
- On-demand sanitized snapshot extraction (DOM-derived, no CDP/debugger)
- **Current Help Session**: bounded, ephemeral conversation (not browsing
  history); authoritative in the Side Panel, checkpointed in
  `chrome.storage.session`
- **Per-origin permission UX**: asks the user for access only to the specific
  site and retries safely; browser-protected pages degrade cleanly
- Strict shared schemas (`packages/protocol`, `PROTOCOL_VERSION 2`)
- Provider abstraction + `mock` + `openai-compatible` (nan.builders configured
  through the OpenAI-compatible interface)
- Self-hostable backend with policy pipeline
- Minimal Side Panel conversation UI
- Deterministic fixture pages + tests
