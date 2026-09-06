# VOICE live smoke — manual operator checklist (VOICE-01 / VOICE-02)

Voice engineering is complete and verified by automated gates. This document is
the **manual live-smoke protocol** to be executed by a human operator with real
Chrome and a real NaN backend. Until it is executed and every box below is
observed, the status stays:

```text
VOICE_01_ENGINEERING = PASS
VOICE_02_ENGINEERING = PASS
VOICE_01_LIVE = PENDING
VOICE_02_LIVE = PENDING
```

**Rules:**

- Do NOT record PASS from unit/integration tests. Only actual observation counts.
- Do NOT record real personal information. Fixtures and synthetic data only.
- Record: date, operator, Chrome version, OS, exact backend commit SHA, build
  command. Keep the record local (git-ignored validation data).

**Scope warning:** this checklist applies ONLY to a build that includes the
voice code (any checkout at or after the voice merge, or `main`). The frozen
G1 baseline has **no** `/v1/speech` or `/v1/transcribe` endpoints: running
these probes against it returns 404/connection errors, which is expected and
must never be logged as a VOICE failure.

Commands below use `curl.exe` explicitly (PowerShell's bare `curl` is an
`Invoke-WebRequest` alias with incompatible flags) and one physical line each
(`^` continuations are cmd.exe-only and fail in PowerShell). Write the JSON
probe bodies to UTF-8 (no BOM) files first so the `«»` and accented characters
survive legacy console code pages.

## 0. Real-NaN precheck (before opening Chrome)

Backend environment (root `.env`, git-ignored; never commit the key):

```text
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.nan.builders/v1
AI_API_KEY=<local ignored secret>
AI_MODEL=qwen3.6
PORT=8787
```

One key only: when `AI_BASE_URL` points at nan.builders the backend reuses
`AI_API_KEY` for Kokoro TTS and Whisper STT (`apps/api/src/config.ts`). No
second speech API key is required (`NAVIGANA_API_KEY` is an optional override
only). Unset stale process `AI_*` overrides first; process env wins over
env-file.

1. Start the backend from the exact candidate checkout:

   ```bash
   pnpm build
   pnpm --filter @guided-web/api start
   ```

2. Health check:

   ```bash
   curl.exe -s http://127.0.0.1:8787/health
   ```

   Expected: `provider=openai-compatible`, `model=qwen3.6`.

   - [ ] health reports the expected provider/model

3. Direct TTS probe (synthetic text only, no personal data). First create the
   two UTF-8 (no BOM) body files `tts-dora.json` and `tts-alex.json`:

   ```text
   {"text":"Pulsa «Aceptar y continuar».","voice":"ef_dora"}
   {"text":"Pulsa «Aceptar y continuar».","voice":"em_alex"}
   ```

   Then:

   ```bash
   curl.exe -s -o tts-ef_dora.mp3 -w "%{content_type}\n" -X POST http://127.0.0.1:8787/v1/speech -H "Content-Type: application/json" --data-binary "@tts-dora.json"
   curl.exe -s -o tts-em_alex.mp3 -w "%{content_type}\n" -X POST http://127.0.0.1:8787/v1/speech -H "Content-Type: application/json" --data-binary "@tts-alex.json"
   ```

   - [ ] `ef_dora` returns playable audio (`Content-Type` starts with `audio/`)
   - [ ] `em_alex` returns playable audio
   - [ ] both files are intelligible Spanish when played locally

4. Direct STT probe (Whisper), with a synthetic recording of the phrase
   **“¿Dónde tengo que pulsar?”** (speak it yourself or use a generated
   fixture; never real personal information):

   ```bash
   curl.exe -s -X POST http://127.0.0.1:8787/v1/transcribe -F "file=@recording.webm" -F "language=es"
   ```

   - [ ] transcript matches the spoken phrase

If any precheck fails, STOP — do not start the Chrome checklist; the failure is
a backend/NaN issue, not a live-UI observation.

## 1. Chrome setup

- [ ] start the exact candidate backend (step 0)
- [ ] `pnpm build` produced `apps/extension/dist` from the same checkout
- [ ] load `apps/extension/dist` unpacked in real Chrome (`chrome://extensions`)
- [ ] open a controlled fixture page (e.g. `tests/fixtures/login.html`)
- [ ] open the Navega Side Panel

## 2. VOICE-01 — TTS (Kokoro via NaN)

- [ ] assistant produces a normal qwen3.6 answer to a fixture question
- [ ] an **Escuchar** button appears with the answer
- [ ] pressing it generates audio through the backend (`ef_dora` default)
- [ ] the Spanish audio is intelligible
- [ ] **Detener** stops playback immediately
- [ ] starting a new playback does NOT resurrect a cancelled playback
- [ ] closing the panel / navigating away cleans playback (no orphan audio)
- [ ] `em_alex` voice also works

## 3. VOICE-02 — STT dictation (Whisper via NaN)

- [ ] **Hablar** works
- [ ] microphone permission prompt is explicit (not pre-granted silently)
- [ ] recording state is visible to the user
- [ ] **Detener grabación** ends recording and transcribes
- [ ] all MediaStream tracks stop after recording (mic indicator off)
- [ ] automatic 30-second stop fires if left recording (no manual stop)
- [ ] if the Side Panel mic permission fails, the fallback visible-dictation
      page opens and delivers the transcript back
- [ ] Whisper returns a Spanish transcript of the speech
- [ ] the transcript appears in the question textarea
- [ ] existing textarea content is not silently lost (append/preserve per impl)
- [ ] the transcript is editable before sending
- [ ] the transcript is NOT auto-submitted
- [ ] the user manually presses **Ayúdame**
- [ ] the normal qwen3.6 assist flow follows
- [ ] the resulting assistant answer can be read aloud with Kokoro (VOICE-01)

## 4. Result

Only after actual observation of every box above, the operator records:

```text
VOICE_01_LIVE = PASS | FAIL
VOICE_02_LIVE = PASS | FAIL
```

Any unchecked or unobserved box keeps that gate at PENDING. A FAIL records the
observed behavior factually (what was pressed, what happened); it does not
authorize runtime changes during a frozen study window.
