# Upstream Reuse Policy

Guided Web Assistant is **not a fork** of any autonomous browser agent. Upstream
projects are studied for algorithms and patterns only; the operator/executor
runtime is intentionally not imported.

## Where our code comes from

Unless recorded in `THIRD_PARTY_NOTICES.md`, code in this repository is
original to this project. Anything adapted from upstream MUST be recorded here
with the exact repository, license, compatibility note and attribution.

## Global Buy / Reuse / Build Policy

Navega MUST NOT reinvent commodity infrastructure.

Before implementing ANY new technical component:

1. Search for an official platform solution.
2. Search for a maintained, licensed OSS implementation.
3. Inspect exact source code, not only README claims.
4. Record exact repository + commit/tag + license.
5. Classify:

   REUSE | ADAPT | PATTERN_ONLY | REJECT | BUILD

6. Only BUILD from scratch when the previous options do not safely fit.

This applies to ALL Navega engineering, not only voice.

If a worker is about to create >150 lines of commodity infrastructure,
STOP and justify why platform/upstream reuse is insufficient.

## Adopted / direct dependency

### dom-accessibility-api
- **Repository:** <https://github.com/eps1lon/dom-accessibility-api>
- **License:** MIT
- **Inspected revision:** tag `v0.7.1` (npm release 0.7.1; default branch commit
  `a1828981f407b6cd6dc9d7b1046a618af93d0270`).
- **Status:** direct runtime dependency of `@guided-web/accessible-dom`.
- **Reused directly:** `computeAccessibleName`, `getRole`, `isInaccessible`,
  `isDisabled`.
- **What was NOT reused:** none of its test suite, build tooling, or any
  autonomous-agent infrastructure (it has none). Only the standard, published
  API functions are imported.
- **Compatibility / security note:** `getRole` returns `null` for
  `<input type="password">`; Navega adds a minimal `textbox` fallback for that
  narrow compatibility gap.

- `computeAccessibleName()` is NOT treated as a privacy boundary. Accessible
  names may incorporate text or values from referenced controls through ARIA
  relationships. Therefore every extracted string remains subject to Navega's
  local sensitive-value classification and complete outbound sanitization
  boundary before serialization.

- The sanitizer in `packages/accessible-dom/src/sanitizer.ts` is authoritative
  for classified raw sensitive form-control values across the top document,
  frames and open shadow roots.

## Studied for concepts only (not imported)

### nanobrowser
- **Repository:** <https://github.com/nanobrowser/nanobrowser>
- **License:** Apache-2.0
- **Inspected revision:** default branch commit
  `24a14b76e14a9c30fd84878ca7985049d1e7d064`.
- **Studied:** open Shadow DOM traversal patterns, frame/root boundaries,
  iframe failure handling, compact DOM representation, visibility/interactivity
  concepts.
- **Reused:** design/reference only. We did not copy code; we re-implemented
  root-aware traversal and frame representation in our own MV3 content-script
  boundary.
- **Not reused:** planner, navigator, executor, autonomous actions,
  debugger/CDP runtime, Playwright runtime, multi-agent architecture, arbitrary
  model-selected selectors.

### Page Assist
- **Repository:** <https://github.com/n4ze3m/page-assist>
- **License:** MIT
- **Inspected revision:** default branch commit
  `7a5bc71ce7a9fcb736dcce471cef5aea10d7faad`.
- **Studied:** page-context budgeting, context truncation, content
  prioritization.
- **Reused:** concept only — deterministic relevance ranking and explicit
  context budgets.
- **Not reused:** the broad permanent host-permission model, side-panel
  extraction details, any extension host that requests `<all_urls>`.

### browser-use
- **Repository:** <https://github.com/browser-use/browser-use>
- **License:** MIT
- **Inspected revision:** default branch commit
  `fe5ad353091fa2ed5499b94e8fe21094bc2e9e5a`.
- **Studied:** interactive-element relevance, visibility heuristics, element
  prioritization, DOM simplification.
- **Reused:** concept only (deterministic relevance before truncation).
- **Not reused / not ported:** Python/CDP/Playwright/Puppeteer automation
  runtime, `backendDOMNodeId`, autonomous action execution, browser control.

==================================================
VOICE-01 / VOICE-02 — VOICE UPSTREAM AUDIT
==================================================

Decision matrix:

  Hermes Browser Extension        → ADAPT (primary STT permission/fallback arch)
  A-Eye Web Chat Assistant        → PATTERN_ONLY (UX/accessibility/shortcuts)
  whisper-web-extension           → PATTERN_ONLY (mic lifecycle/state machine)
  Page Assist                     → PATTERN_ONLY (composer/TTS concepts only)

Do NOT port Page Assist's React/Plasmo architecture.

### Hermes Browser Extension (VOICE-02 STT upstream)

- **Repository:** <https://github.com/abundantbeing/hermes-browser-extension>
- **License:** MIT (Copyright 2026 Jon Komet)
- **Inspected revision:** commit
  `64f2abe443dddee78313e3b18169474cbd0f4f95` (2026-09-06).
- **Decision:** ADAPT
- **Class:** ADAPT

**Relevant source files inspected:**

| Upstream file | Content |
|---------------|---------|
| `extension/voice-dictation.html` | Visible fallback page (mic permission recovery) |
| `extension/voice-dictation.js` | Dictation lifecycle, publishTranscript(), browser speech fallback |
| `extension/sidepanel.html` (line 455) | Mic button in composer toolbar |
| `extension/sidepanel.js` (lines 3718-4307) | Full voice control: capability check, MIME selection, permission recovery, MediaRecorder lifecycle, transcript return, stale protection, recording states, accessibility |
| `extension/request-permissions.html` | Permission recovery UI page |
| `extension/request-permissions.js` | Permission request via visible page |
| `extension/lib/common.mjs` (lines 2104-2171) | `prepareOnDeviceSpeechRecognition()`, `isMicrophonePermissionError()` |
| `extension/lib/browser-runtime.mjs` (lines 90-117) | Browser product detection, mic settings URLs |

**What is ADAPTED:**

- Microphone permission recovery architecture (Side Panel → visible fallback page → explicit user action → getUserMedia → MediaRecorder → transcript return)
- MIME preference list (`audio/webm;codecs=opus` > `audio/webm` > `audio/mp4` > `audio/ogg` > `audio/wav`)
- `MediaRecorder` lifecycle pattern (start → dataavailable chunks → stop → Blob → transcribe)
- Stream track cleanup pattern: `stream?.getTracks?.().forEach(track => track.stop())`
- Dual-channel transcript return: `chrome.runtime.sendMessage` (immediate) +
  `chrome.storage.session` fallback (short TTL, consume-once, immediate delete)
  — **Navega adaptation prefers session storage over localStorage for ephemeral privacy.**
- Stale result protection: `ts: Date.now()` + TTL check
- Recording transition guards: `voiceTransitionInFlight` guard against double-click
- Accessibility patterns: `aria-live="polite"` + `role="status"` + `aria-busy`
- `canRecordVoiceAudio()` capability check pattern:
  `navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'`
- `getUserMedia` call with echo cancellation and noise suppression:
  `{ audio: { echoCancellation: true, noiseSuppression: true } }`
- Browser Speech fallback detection: `window.SpeechRecognition || webkitSpeechRecognition`
- `isMicrophonePermissionError()` comprehensive error matching pattern

**What is NOT reused:**

- Hermes agent runtime
- Autonomous browser actions (click/type/navigate)
- Hermes planning/tool execution
- Hermes-specific gateway abstractions
- Persistent voice history
- `chrome.storage.local` — Navega uses `chrome.storage.session` + `chrome.runtime.sendMessage` with short TTL (ephemeral privacy model)
- `VOICE_DRAFT_STORAGE_KEY` / `hermesVoiceDraft` — Navega uses its own ephemeral keys

**Integration cost:** Medium. The permission recovery architecture is a coherent
system; the visible dictation page is a new extension page but the HTML/JS patterns
transfer with ~30% code adaptation (i18n keys, branding, NaN Whisper endpoint,
Navega composer target).

**Security / permission impact:** High. Adds microphone permission flow. The visible
fallback page requires an extension page with `getUserMedia` capability. No data
persists beyond the transcription session.

--------------------------------------------------

### A-Eye Web Chat Assistant

- **Repository:** <https://github.com/vincentwun/A-Eye-Web-Chat-Assistant>
- **License:** MIT (Copyright 2024 Vincent Wun)
- **Inspected revision:** default branch commit
  `e9284c5d9e0d26a8938e57b007f0322d7d9cc471` (2025-12-03).
- **Decision:** PATTERN_ONLY
- **Class:** PATTERN_ONLY

**Relevant source files inspected:**

| Upstream file | Content |
|---------------|---------|
| `src/main/sidepanel.html` | Side panel structure, voice button, conversation region |
| `src/voice/voiceControl.js` | Mic permission, toggle voice input, error reporting |
| `src/voice/sttController.js` | Web Speech API STT (continuous, interim, silence timeout) |
| `src/voice/ttsController.js` | Web Speech API TTS (voice selection with fallback) |
| `src/voice/soundEffects.js` | Web Audio API oscillator sound effects |
| `src/components/uiManager.js` | Voice button state toggle (icon class), thinking indicator |
| `src/permission/permissionContent.js` | Permission iframe injection |
| `src/permission/permission.html` | Permission request page |
| `src/permission/requestPermission.js` | getUserMedia-based permission request |
| `src/manifest.json` | Keyboard shortcut registration |
| `src/background/background.js` | Shortcut command routing |
| `src/components/stateManager.js` | Settings storage with `chrome.storage.onChanged` |

**What is ADAPTED (pattern only, no code copied):**

- Accessible voice button UX: mic icon ↔ stop icon toggle with CSS class
- `aria-live` region patterns on voice status elements
- Voice state change messaging (listening / recording / stopped)
- Keyboard shortcut concept: manifest `commands` → background `onCommand` listener → sidepanel `onMessage` dispatch
- Sound effect concept via Web Audio API (optional; may be omitted in VOICE-01)
- Permission iframe pattern (3-file: content script → permission page → requestPermission)

**What is NOT reused:**

- Autonomous click actions (`src/action/pageAction.js` `clickElement()`)
- Autonomous type actions (`typeInElement()`)
- Autonomous key press (`simulateKeyPress()`)
- Autonomous navigation (`executeJSON()`)
- JSON action execution pipeline (`src/components/commandMap.js` → `actionFlowController.js`)
- Element discovery for autonomous action (`src/action/getElement.js`)
- Broad agent architecture (perceive → plan → act loop)
- Any agent capability

**Integration cost:** Low. Only UX/accessibility patterns are adapted; no code port.

--------------------------------------------------

### whisper-web-extension

- **Repository:** <https://github.com/takahirox/whisper-web-extension>
- **License:** MIT (Copyright 2024 Takahiro)
- **Inspected revision:** default branch commit
  `d98d7c078f4e1e6a6c7752ce2f63117b4cd26da8`.
- **Decision:** PATTERN_ONLY
- **Class:** PATTERN_ONLY

**Relevant source files inspected:**

| Upstream file | Content |
|---------------|---------|
| `src/extensions/content-script.ts` | 5-state icon state machine, getUserMedia, MediaRecorder lifecycle, audio capture, blob transport |
| `src/extensions/background.ts` | Port-based communication, request queue (ONNX/Whisper inference) |
| `src/extensions/common.ts` | Message type definitions (Request/Response/Error enum) |
| `extensions/manifest.json` | Content script registration, host permissions |

**What is ADAPTED (pattern only, no code copied):**

- 5-state icon state machine: `Ready` → `WaitingForUserMedia` → `Recording` →
  `RecordingStopRequested` → `RecordingStopped` → `Ready`
- `isIconEnabled()` guard: only `Ready` and `Recording` states allow clicks
- Explicit record/stop user gesture (toggle)
- MediaRecorder lifecycle: MIME detection → `start()` → collect `dataavailable` chunks → `stop()` → `Blob` assembly
- MIME type detection loop via `MediaRecorder.isTypeSupported()`
- Microphone error handling: try/catch getUserMedia → state reset on denial
- Blob lifecycle: `URL.createObjectURL` → transport → `URL.revokeObjectURL`
- Port-based request/response pattern: `chrome.runtime.connect()` + request queue with callbacks
- Message type enum pattern: `Request` / `Response` / `Error`

**What is NOT reused:**

- Local ONNX/Whisper inference stack (`pipeline()`, `InferenceSession`, `Tensor`, `env.wasm`)
- AudioContext decode to Float32Array PCM as final payload
- `fix-webm-duration` dependency
- Floating mic icon DOM injection (Navega uses Side Panel UI)

**Integration cost:** Low. State machine and lifecycle patterns transfer with minimal
adaptation. NaN Whisper replaces local inference entirely.

--------------------------------------------------

### Page Assist (VOICE RE-EVALUATION)

- **Repository:** <https://github.com/n4ze3m/page-assist>
- **License:** MIT (Copyright 2023 Muhammed Nazeem)
- **Inspected revision:** default branch commit
  `7a5bc71ce7a9fcb736dcce471cef5aea10d7faad`.
- **Decision:** PATTERN_ONLY (VOICE_REUSE = NO)
- **Class:** REJECT (code) / PATTERN_ONLY (concepts)

**Has a mature production-grade voice implementation:**

- `src/hooks/useSpeechRecognition.tsx` — Web Speech API hook (autoStop, autoSubmit, interim)
- `src/hooks/useTTS.tsx` — Multi-provider TTS (browser / ElevenLabs / OpenAI / Mistral)
- `src/services/tts.ts` — TTS config service
- `src/utils/tts.ts` — Audio splitting (punctuation/paragraph/none)
- `src/utils/markdown-to-ssml.ts` — Markdown-to-SSML conversion
- `src/components/Common/Playground/Message.tsx` — Per-message TTS play/stop button

**Decision rationale — REJECT code, PATTERN_ONLY concepts:**

Navega uses vanilla TypeScript with esbuild IIFE output. Page Assist uses
React + WXT (Plasmo) framework. Porting Page Assist's voice code would require
porting its entire React/Plasmo dependency stack, which is disproportionate to
the value gained.

**Concepts adapted (pattern only):**

- Per-message TTS control (play/stop button pattern)
- Composer state management for voice transcripts
- Audio chunking/splitting concept (if required in future TTS iterations)
- Playback cancellation pattern

**Do NOT implement:**

- Progressive/chunked TTS in VOICE-01 — use single-shot Kokoro playback
- React hooks or Plasmo/WXT framework
- Multi-provider TTS — use NaN Kokoro only
- Web Speech API as primary STT — use NaN Whisper

**Integration cost:** Low conceptually, high practically (would require full React
stack port). Rejected.

==================================================
UPSTREAM PROVENANCE PROCEDURE
==================================================

For every actual adapted/copied source fragment record:

  PROJECT
  REPOSITORY
  EXACT COMMIT/TAG
  LICENSE
  UPSTREAM FILE
  LOCAL FILE
  ADAPTATION
  WHY USED

Update:

  docs/UPSTREAM-REUSE.md

If required by actual source reuse:

  THIRD_PARTY_NOTICES.md

Never write vague provenance such as:

  "default branch"
  "current version"
  "v0.3.2 era"

Pin the actual inspected revision.

==================================================
BOUNDARY: WHAT IS NAVEGA-SPECIFIC
==================================================

The following remain Navega-specific and SHOULD be ours:

- Human-control semantics (transcript confirmation before submit)
- No autonomous page action
- Privacy policy and session semantics
- qwen3.6 guidance policy
- User-facing simplicity
- Study methodology
- The visible dictation fallback page (adapted from Hermes, branded Navega)
- The transcript → textarea → user review → "Ayúdame" flow
- Ephemeral transcript transport (chrome.storage.session + runtime message)

The following are commodity and SHOULD preferably be reused/adapted:

- Microphone permission patterns (Hermes)
- MediaRecorder lifecycle (Hermes / whisper-web-extension)
- MIME negotiation (Hermes / whisper-web-extension)
- Stream track cleanup (Hermes / whisper-web-extension)
- Extension-page fallback architecture (Hermes)
- Audio playback lifecycle (page-assist concept, native implementation)
- Browser compatibility patterns (all upstreams)
- Icon state machine (whisper-web-extension)
- Keyboard shortcut pattern (A-Eye)
- Accessibility patterns (Hermes + A-Eye)

## Official Chrome references audited (pre-G1 runtime closure)

These official references materially shaped the pre-G1 runtime-correctness
closure. No code was imported from them; they were audited for exact MV3
behaviour and are the source of the engineering decisions below.

### chrome.scripting.executeScript
- **Reference:** <https://developer.chrome.com/docs/extensions/reference/api/scripting>
- **Key fact:** `executeScript` accepts `target.frameIds: number[]` (specific
  frames) and `frameIds`/`allFrames` are mutually exclusive. The main frame id
  is always `0`.
- **How used:** we inject the extractor **separately per frame** with an explicit
  `frameIds:[frameId]` instead of `allFrames:true`. A child iframe for which the
  extension lacks permission can therefore never make the whole injection
  fail; each frame is isolated with `Promise.allSettled`.

### chrome.webNavigation
- **Reference:** <https://developer.chrome.com/docs/extensions/reference/api/webNavigation>
  (and `chrome.webNavigation.getAllFrames`/`getFrame`)
- **Key fact:** `getAllFrames({tabId})` returns `{frameId, parentFrameId, url}`;
  main frame has `parentFrameId === -1`.
- **How used:** to enumerate the frame tree for per-frame injection and to
  resolve the active top-frame URL when `tab.url` is unavailable (no `tabs`
  permission). The `webNavigation` permission is retained because these runtime
  paths require it; it may produce install/onboarding permission messaging.

### chrome.permissions.addHostAccessRequest
- **Reference:** <https://developer.chrome.com/docs/extensions/reference/api/permissions>
- **Key fact:** `addHostAccessRequest` is **Chrome 133+** (MV3).
- **Decision:** our `minimum_chrome_version` is **116**, so we did **not** adopt
  it. The existing explicit per-origin `permissions.request` UX is preserved.
  `addHostAccessRequest` is documented as a possible future simplification, not
  a current dependency. We did not add `tabs`, permanent `<all_urls>`, or
  `debugger`.

==================================================
VOICE-01 / VOICE-02 — ADAPTATION PROVENANCE
==================================================

The following source fragments were adapted from upstream projects.
All code is original to Navega but follows the patterns documented above.

### Hermes Browser Extension (VOICE-02 STT upstream)

- **Repository:** <https://github.com/abundantbeing/hermes-browser-extension>
- **License:** MIT (Copyright 2026 Jon Komet)
- **Inspected revision:** commit
  `64f2abe443dddee78313e3b18169474cbd0f4f95` (2026-09-06).

| UPSTREAM FILE | LOCAL FILE | ADAPTATION |
|---------------|-----------|------------|
| `extension/sidepanel.js` (lines 3718-4307) | `apps/extension/src/voice/voice-control.ts` | MediaRecorder lifecycle, MIME selection, stream track cleanup, transition guard, TTS playback, transcript delivery |
| `extension/voice-dictation.js` | `apps/extension/src/voice/dictation.ts` | Permission recovery via visible page, getUserMedia → MediaRecorder → transcript, chrome.storage.session fallback |
| `extension/voice-dictation.html` | `apps/extension/src/voice/dictation.html` | Visible fallback page structure and UX |
| `extension/sidepanel.js` (transcript bridge) | `apps/extension/src/shared/voice-messages.ts` | Dual-channel transcript transport (sendMessage + session fallback), TTL, consume-once |

**What was adapted:**
- Microphone permission recovery: Side Panel → visible dictation page → getUserMedia → MediaRecorder → transcript → chrome.runtime.sendMessage + chrome.storage.session fallback
- MIME preference ordering: audio/webm;codecs=opus > audio/webm > audio/mp4 > audio/ogg > audio/wav
- MediaRecorder lifecycle: start → dataavailable chunks → stop → Blob → transcribe
- Track cleanup: `stream?.getTracks?.().forEach(track => track.stop())`
- Dual-channel transcript return: `chrome.runtime.sendMessage` (immediate) + `chrome.storage.session` fallback (short TTL 30s, consume-once, immediate delete)
- Stale result protection: `ts: Date.now()` + 30s TTL check
- Recording transition guards: `voiceTransitionInFlight` guard against double-click
- Accessibility: `aria-live="polite"` + `role="status"` + `aria-busy`
- `canRecordVoiceAudio()` capability check pattern
- getUserMedia with echo cancellation + noise suppression

**What is NOT reused:**
- Hermes agent runtime, autonomous browser actions, planning/tool execution
- Persistent voice history
- `chrome.storage.local` — Navega uses `chrome.storage.session` + `chrome.runtime.sendMessage`
- `VOICE_DRAFT_STORAGE_KEY` / `hermesVoiceDraft` — Navega uses its own ephemeral keys

### whisper-web-extension (VOICE state machine pattern)

- **Repository:** <https://github.com/takahirox/whisper-web-extension>
- **License:** MIT (Copyright 2024 Takahiro)
- **Inspected revision:** commit `d98d7c078f4e1e6a6c7752ce2f63117b4cd26da8`.

**Concepts adapted (pattern only, no code copied):**
- MediaRecorder MIME detection loop via `MediaRecorder.isTypeSupported()`
- Blob lifecycle: `URL.createObjectURL` → transport → `URL.revokeObjectURL`
- State machine concept for recording states

### A-Eye Web Chat Assistant (accessibility/UX patterns)

- **Repository:** <https://github.com/vincentwun/A-Eye-Web-Chat-Assistant>
- **License:** MIT (Copyright 2024 Vincent Wun)
- **Inspected revision:** commit `e9284c5d9e0d26a8938e57b007f0322d7d9cc471`.

**Concepts adapted (pattern only, no code copied):**
- Accessible voice button UX with `aria-live` region patterns
- Voice state change messaging (listening / recording / stopped)

### Page Assist (per-message play/stop concept)

- **Repository:** <https://github.com/n4ze3m/page-assist>
- **License:** MIT (Copyright 2023 Muhammed Nazeem)
- **Inspected revision:** commit `7a5bc71ce7a9fcb736dcce471cef5aea10d7faad`.

**Concepts adapted (pattern only, no code copied):**
- Per-message TTS play/stop button pattern (TTS button on assistant bubbles)
- Playback cancellation pattern

### Digital.gov Plain Language guide series (output wording style)

- **Source:** <https://www.plainlanguage.gov/> (redirects to the Digital.gov
  "Plain language guide series", which carries forward the former
  PlainLanguage.gov content; archived upstream on GitHub) and its
  "Principles of plain language" / "Writing for understanding" guides.
- **Kind:** government guidance documentation (public domain US government
  work), not a code repository.
- **Inspected:** 2026-09-06.
- **Decision:** PATTERN_ONLY. No code involved.
- **Adopted patterns (prompt wording rules, candidate/post-G1 scope):** write
  for the specific low-digital-confidence audience; very short sentences
  (about 12 words); one idea per sentence; everyday spoken words; active
  voice; concrete and visible wording. These extend the existing anti-jargon
  rules in `apps/api/src/prompt.ts`.

### Mermaid (diagram rendering evaluation)

- **Repository:** <https://github.com/mermaid-js/mermaid> — docs site
  <https://mermaid.js.org/intro/> (documentation version seen: 11.17.2).
- **License:** MIT.
- **Inspected:** 2026-09-06 (introduction + security notes in docs).
- **Decision (code):** REJECT. Mermaid's own documentation states the
  sanitization risk of rendering user-authored diagram text ("precarious to
  retrieve text from users... hard to guarantee that there are no loop
  holes"). Our threat model treats page and model output as untrusted; adding
  a JS SVG renderer into the extension side panel would open a new injection
  surface and a heavy dependency for a ~380 px text panel.
- **Decision (pattern):** PATTERN_ONLY — the text-defined flowchart mental
  model (steps as boxes, progression as arrows, one per line). Implemented as
  a plain-text "numbered step map" inside the assistant message string; the
  side panel already renders messages with `white-space: pre-wrap` and
  `textContent`, so multi-line plain text is safe with zero new dependencies.
- **Resulting build:** wording-only change in `apps/api/src/prompt.ts`
  (candidate/post-G1; the frozen G1 runtime at `v0.0.9-p0-g1-baseline` is
  unaffected).

### GOV.UK Design System — step by step navigation + task list (pattern backlog)

- **Source:** <https://design-system.service.gov.uk/patterns/step-by-step-navigation/>,
  <https://design-system.service.gov.uk/components/task-list/>
- **Inspected:** 2026-09-06 (pattern page retrieved in full; content license
  seen on page: Open Government Licence v3.0).
- **Decision:** PATTERN_ONLY — deferred to after P01–P04.
- **Relevant patterns:** end-to-end journey shown as numbered steps with
  short task names; the user's current task is clearly separated from the
  rest of the journey; step numbering must be exposed to screen readers;
  pattern researched through 8 rounds including users with disabilities and
  people with low digital literacy (directly relevant to our audience).
- **Not reused:** code. The step-by-step pattern ships no `govuk-frontend`
  component (prototype-kit plugin only), and nothing visual is added before
  G1 evidence justifies it.
- **Follow-up:** see `docs/POST-G1-BACKLOG.md` (shape of `Ruta:` as labels,
  not re-ordered commands).

### USWDS — process list + step indicator (pattern backlog)

- **Source:** <https://designsystem.digital.gov/components/process-list/>,
  <https://designsystem.digital.gov/components/step-indicator/> (plus their
  accessibility-tests subpages).
- **Inspected:** 2026-09-06 (components exist with explicit accessibility
  documentation; full source/license inspection pending — adoption deferred).
- **Decision:** PATTERN_ONLY — deferred to after P01–P04.
- **Relevant patterns:** accessible representation of sequential steps and
  current progress ("step X of N" framing) without graphics, SVG or a
  diagram DSL; structure is expressible in plain text and later, if ever
  justified, in safe semantic HTML/CSS inside the side panel.
- **Follow-up:** see `docs/POST-G1-BACKLOG.md`.

==================================================
ASSIST RELIABILITY — POST-G1 UPSTREAM REUSE DECISION
==================================================

Evaluated 2026-09-06 for the post-G1 candidate only. The frozen
`v0.0.9-p0-g1-baseline` runtime and tag were not modified.

### OpenAI official Node SDK — PATTERN_ONLY

- **Repository:** <https://github.com/openai/openai-node>
- **Inspected revision:** tag `v6.39.0`, commit
  `200211197931763ed43b7ff41839b53e4dbfdf6e`; current default-branch commit
  observed as `7b5d1209090f82f56b4971976147b5c2a859452e`.
- **License:** Apache-2.0.
- **Exact source inspected:** `src/client.ts` and the configuration docs.
  The client exposes `baseURL`, per-request `timeout`, and `maxRetries`; its
  retry policy covers connection failures, 408, 409, 429 and HTTP 5xx.
- **Decision:** PATTERN_ONLY. Navega keeps its small native fetch adapter so the
  generic OpenAI-compatible contract, response parsing and provider-neutral
  error boundary remain unchanged. The SDK's own retry authority would add a
  second timeout/retry policy and a disproportionate migration surface.

### p-retry — REUSE

- **Repository:** <https://github.com/sindresorhus/p-retry>
- **Inspected revision:** tag `v8.0.1`, commit
  `7c95e3b751558c5f434b08f928ef092ccd5ed0ab` (Node `>=22`).
- **License:** MIT.
- **Exact source inspected:** `index.js` and `index.d.ts`. The maintained
  implementation provides bounded retries, exponential delay, optional jitter,
  `shouldRetry`, `maxRetryTime` and `AbortSignal` handling.
- **Decision:** REUSE. `p-retry@8.0.1` is a direct API dependency. Navega's
  adapter in `apps/api/src/provider-retry.ts` supplies the product-specific
  policy: exactly two attempts, explicit retryable status/error classes,
  bounded `Retry-After`, fresh per-attempt controllers and a 17-second total
  budget. No upstream source was copied.

### ai-retry — PATTERN_ONLY

- **Repository:** <https://github.com/zirkelc/ai-retry>
- **Inspected revision:** `v2.4.0`, commit
  `bb477f08bc1d352bf4470ef66e6650689727623f`.
- **License:** MIT; the package is coupled to the Vercel AI SDK peer stack.
- **Exact source inspected:** retry-timeout and retryable-language-model
  helpers. The useful concept is a fresh timeout per attempt plus a total
  retry deadline.
- **Decision:** PATTERN_ONLY. Navega does not migrate to the Vercel AI SDK just
  to obtain retry handling.

### LiteLLM router resilience — PATTERN_ONLY

- **Repository:** <https://github.com/BerriAI/litellm>
- **Inspected revision:** current default-branch commit observed as
  `eeb7732fc11fd47762ca84cc3fb7cc74235d7097` (release `1.101.0`).
- **License:** MIT for repository content outside the separately licensed
  enterprise directory.
- **Exact source/docs inspected:** router retry-policy helpers and the
  reliable-completions/proxy reliability documentation. The relevant patterns
  are bounded retries, fallbacks, cooldowns and total request limits.
- **Decision:** PATTERN_ONLY. NaN already exposes the OpenAI-compatible API;
  Navega does not deploy a second LiteLLM proxy or add an unbounded fallback
  layer.

No undocumented qwen3.6 reasoning-control parameter is sent. The documented
`reasoning_config: {}` shape was tested as a bounded experiment, but rejected
for shipment: in the six-call test it did not provide a reproducible advantage,
and the subsequent 40-call candidate run was materially worse. Generic
OpenAI-compatible providers therefore receive no provider-specific reasoning
field. NaN's documented qwen3.6 sampling values (`temperature=0.6`,
`top_p=0.95`) were also tested in a same-fixture A/B and rejected: guidance
correctness was lower and one final timeout remained. Reliability remains
bounded independently through the retry policy and output budget.
