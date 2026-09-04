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

**CURRENTLY IMPLEMENTED (P0):** a minimal Side Panel with a question field,
a context-mode indicator, one “Help me with this page” action, and a single
assistant answer.

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
| side panel | Present (P0, minimal) |
| session state | Resilient; survive service-worker restarts |
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
- MV3 extension: `activeTab`, `scripting`, `storage`, `sidePanel`
- On-demand sanitized snapshot extraction (DOM-derived, no CDP/debugger)
- Strict shared schemas (`packages/protocol`)
- Provider abstraction + `mock` + `openai-compatible`
- Self-hostable backend with policy pipeline
- Minimal Side Panel UI
- Deterministic fixture pages + tests
