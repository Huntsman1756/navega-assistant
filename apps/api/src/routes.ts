import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";

export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_PROVIDER_CALLS = 2;
export const MAX_TTS_TEXT_CHARS = 500;
export const MAX_TRANSCRIBE_BODY_BYTES = 25 * 1024 * 1024;
export const TTS_TIMEOUT_MS = 30000;
export const STT_TIMEOUT_MS = 60000;
export const RECORDING_LIMIT_MS = 30000;
export const KOKORO_VOICES = ["ef_dora", "em_alex"] as const;
import { ProviderOutputError, type AIProvider } from "@guided-web/provider";
import {
  AssistRequestSchema,
  P0AssistantDecisionSchema,
  PROTOCOL_VERSION,
} from "@guided-web/protocol";
import { checkInstructionSafety, checkConversationSimplicity } from "@guided-web/security-policy";
import { buildSystemPrompt } from "./prompt";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_PROVIDER_TOTAL_BUDGET_MS,
  MAX_PROVIDER_TOTAL_BUDGET_MS,
  MAX_PROVIDER_ATTEMPTS,
} from "./config";
import {
  assistWithProviderHedge,
  HEDGE_DELAY_MS,
  isRetryableProviderError,
  ProviderAttemptTimeoutError,
  ProviderConcurrencyError,
  ProviderTotalTimeoutError,
  type ProviderAttemptObservation,
} from "./provider-retry";

export { DEFAULT_PROVIDER_TIMEOUT_MS };
export { DEFAULT_PROVIDER_TOTAL_BUDGET_MS, MAX_PROVIDER_ATTEMPTS };

/** Backwards-compatible name for the old single-attempt timeout sentinel. */
export { ProviderAttemptTimeoutError as ProviderTimeoutError } from "./provider-retry";

export interface NanConfig {
  ttsEndpoint?: string;
  sttEndpoint?: string;
  apiKey?: string;
}

export interface AppOptions {
  providerTimeoutMs?: number;
  providerTotalTimeoutMs?: number;
  hedgeDelayMs?: number;
  nanConfig?: NanConfig;
  /** Local validation hook; it receives no request or provider content. */
  onProviderAttempt?: (attempt: number) => void;
  /** Local-only physical-attempt hook; it receives duration/classes only. */
  onProviderAttemptComplete?: (observation: ProviderAttemptObservation) => void;
}

type SpeechRequestResult =
  | { ok: true; text: string; voice: string }
  | { ok: false; reason: "invalid_request" | "invalid_voice" | "text_too_long" };

function parseSpeechRequest(body: unknown): SpeechRequestResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (Object.keys(body).length !== 2) {
    return { ok: false, reason: "invalid_request" };
  }
  const { text, voice } = body as Record<string, unknown>;
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, reason: "invalid_request" };
  }
  if (text.length > MAX_TTS_TEXT_CHARS) {
    return { ok: false, reason: "text_too_long" };
  }
  if (typeof voice !== "string" || !(KOKORO_VOICES as readonly string[]).includes(voice)) {
    return { ok: false, reason: "invalid_voice" };
  }
  return { ok: true, text, voice };
}

/**
 * Builds the backend HTTP app.
 *
 * Pipeline per request:
 *   raw request -> strict schema validation -> provider call (with hard
 *   deadline + AbortSignal) -> JSON parse -> strict decision validation ->
 *   instruction safety checks -> simplicity checks -> response.
 */
export function createApp(
  provider: AIProvider,
  providerName: string,
  model?: string,
  opts?: AppOptions,
): Hono {
  const app = new Hono();
  const providerTimeoutMs = opts?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const providerTotalTimeoutMs = opts?.providerTotalTimeoutMs
    ?? (opts?.providerTimeoutMs === undefined
      ? DEFAULT_PROVIDER_TOTAL_BUDGET_MS
      : Math.min(
        MAX_PROVIDER_TOTAL_BUDGET_MS,
        providerTimeoutMs * MAX_PROVIDER_ATTEMPTS + (opts?.hedgeDelayMs ?? HEDGE_DELAY_MS),
      ));
  const hedgeDelayMs = opts?.hedgeDelayMs
    ?? Math.min(HEDGE_DELAY_MS, Math.max(1, Math.floor(providerTimeoutMs / 2)));
  const nanConfig = opts?.nanConfig;

  let activeCalls = 0;
  app.get("/health", (c) => c.json({ ok: true, provider: providerName, model }));
  app.use("/v1/assist", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
  app.use("/v1/transcribe", bodyLimit({ maxSize: MAX_TRANSCRIBE_BODY_BYTES, onError: (c) => c.json({ error: "audio_too_large" }, 413) }));

  app.post("/v1/assist", async (c) => {
    const body = await c.req.json().catch(() => null);

    const parsed = AssistRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        400,
      );
    }
    const req = parsed.data;

    if (activeCalls >= MAX_PROVIDER_CALLS) return c.json({ error: "provider_busy" }, 429);
    let response: Awaited<ReturnType<typeof assistWithProviderHedge>>;
    const logicalRequestId = randomUUID();
    // Local-only perf instrumentation. Duration + outcome ONLY: never the
    // question, the page content, the session, URLs or any provider detail.
    const tProvider = performance.now();
    const logFinalResult = (finalResult: string) => {
      console.log(
        `[perf] logical_request_id=${logicalRequestId} `
        + `total_ms=${Math.round(performance.now() - tProvider)} final_result=${finalResult}`,
      );
    };
    const logAttempt = (observation: ProviderAttemptObservation) => {
      activeCalls -= 1;
      console.log(
        `[perf] logical_request_id=${logicalRequestId} `
        + `attempt=${observation.attempt} attempt_ms=${observation.attemptMs} `
        + `retry_reason=${observation.retryReason}`,
      );
      opts?.onProviderAttemptComplete?.(observation);
    };
    try {
      response = await assistWithProviderHedge(
        provider,
        {
          mode: req.mode,
          question: req.question,
          session: req.session,
          context: req.context,
          systemPrompt: buildSystemPrompt(),
        },
        {
          attemptTimeoutMs: providerTimeoutMs,
          totalTimeoutMs: providerTotalTimeoutMs,
          hedgeDelayMs,
          signal: c.req.raw.signal,
          onAttempt: opts?.onProviderAttempt,
          onAttemptStart: () => {
            if (activeCalls >= MAX_PROVIDER_CALLS) return false;
            activeCalls += 1;
            return true;
          },
          onAttemptComplete: logAttempt,
        },
      );
    } catch (err) {
      const elapsedMs = Math.round(performance.now() - tProvider);
      if (c.req.raw.signal.aborted) {
        logFinalResult("cancelled");
        return new Response(null, { status: 499 });
      }
      if (err instanceof ProviderConcurrencyError) {
        logFinalResult("provider_busy");
        return c.json({ error: "provider_busy" }, 429);
      }
      if (err instanceof ProviderOutputError) {
        console.log(`[perf] provider_ms=${elapsedMs} result=invalid_output`);
        logFinalResult("invalid_model_output");
        return c.json({ error: "invalid_model_output", reason: "provider_response" }, 502);
      }
      const timedOut =
        err instanceof ProviderAttemptTimeoutError ||
        err instanceof ProviderTotalTimeoutError ||
        (elapsedMs >= providerTotalTimeoutMs && isRetryableProviderError(err));
      if (timedOut) {
        console.log(`[perf] provider_ms=${elapsedMs} result=timeout`);
        logFinalResult("provider_timeout");
        return c.json({ error: "provider_timeout" }, 504);
      }
      // Log ONLY the error class name (never the message: provider error text
      // can echo request content). The extension gets a stable code only.
      const kind = err instanceof Error ? err.name : "unknown";
      console.log(`[perf] provider_ms=${elapsedMs} result=error error_kind=${kind}`);
      logFinalResult("provider_unavailable");
      return c.json({ error: "provider_unavailable" }, 502);
    }
    console.log(`[perf] provider_ms=${Math.round(performance.now() - tProvider)} result=ok`);

    let rawDecision: unknown;
    try {
      rawDecision = JSON.parse(response.raw);
    } catch {
      logFinalResult("invalid_model_output");
      return c.json({ error: "invalid_model_output", reason: "not_json" }, 502);
    }

    const decisionParsed = P0AssistantDecisionSchema.safeParse(rawDecision);
    if (!decisionParsed.success) {
      logFinalResult("invalid_model_output");
      return c.json({ error: "invalid_model_output", reason: "schema" }, 502);
    }
    const decision = decisionParsed.data;

    const safety = checkInstructionSafety(decision.message);
    const message = safety.ok ? decision.message : safety.replacement;

    const simplicity = checkConversationSimplicity(message);
    if (!simplicity.ok) {
      // P0: report only, never block. Documented as a soft gate.
      console.warn("[simplicity]", simplicity.issues.join("; "));
    }

    const out =
      decision.kind === "cannot_help"
        ? { ...decision, message }
        : { ...decision, message };

    logFinalResult("ok");
    return c.json({
      protocolVersion: PROTOCOL_VERSION,
      decision: out,
      mode: req.mode,
      provider: response.provider,
      model: response.model ?? model,
    });
  });

  app.post("/v1/speech", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseSpeechRequest(body);
    if (!parsed.ok) {
      return c.json({ error: parsed.reason }, 400);
    }
    const { text, voice } = parsed;
    const { ttsEndpoint, apiKey } = nanConfig ?? {};
    if (!ttsEndpoint || !apiKey) {
      return c.json({ error: "speech_unavailable" }, 503);
    }
    const ttsCtrl = new AbortController();
    const ttsTimer = setTimeout(() => ttsCtrl.abort(), TTS_TIMEOUT_MS);
    try {
      const res = await fetch(ttsEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "audio/*",
        },
        body: JSON.stringify({ model: "kokoro", input: text, voice }),
        signal: ttsCtrl.signal,
      });
      if (!res.ok) {
        return c.json({ error: "speech_unavailable" }, 502);
      }
      const audio = await res.arrayBuffer();
      // Forward the upstream content-type (e.g. audio/mpeg from Kokoro).
      // Fallback to audio/mpeg when unknown to maximize native Audio() compatibility.
      const upstreamCt = res.headers.get("Content-Type");
      const contentType =
        upstreamCt && (upstreamCt.startsWith("audio/") || upstreamCt.startsWith("text/plain"))
          ? upstreamCt
          : "audio/mpeg";
      return new Response(audio, {
        status: 200,
        headers: { "Content-Type": contentType },
      });
    } catch {
      const timedOut = ttsCtrl.signal.aborted;
      return c.json(
        { error: timedOut ? "speech_timeout" : "speech_unavailable" },
        timedOut ? 504 : 502,
      );
    } finally {
      clearTimeout(ttsTimer);
      ttsCtrl.abort();
    }
  });

  app.post("/v1/transcribe", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "missing_file" }, 400);
    }
    if (file.size > MAX_TRANSCRIBE_BODY_BYTES) {
      return c.json({ error: "audio_too_large" }, 413);
    }
    const rawLanguage = form.get("language");
    const language = typeof rawLanguage === "string" && rawLanguage.trim() ? rawLanguage.trim() : "es";

    const { sttEndpoint, apiKey } = nanConfig ?? {};
    if (!sttEndpoint || !apiKey) {
      return c.json({ error: "transcribe_unavailable" }, 503);
    }

    const sttForm = new FormData();
    sttForm.append("file", file);
    sttForm.append("model", "whisper");
    sttForm.append("language", language);

    const sttCtrl = new AbortController();
    const sttTimer = setTimeout(() => sttCtrl.abort(), STT_TIMEOUT_MS);
    try {
      const res = await fetch(sttEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: sttForm,
        signal: sttCtrl.signal,
      });
      if (!res.ok) {
        return c.json({ error: "transcribe_unavailable" }, 502);
      }
      const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
      if (!data || typeof data.text !== "string") {
        return c.json({ error: "invalid_model_output" }, 502);
      }
      return c.json({ text: data.text });
    } catch {
      const timedOut = sttCtrl.signal.aborted;
      return c.json(
        { error: timedOut ? "transcribe_timeout" : "transcribe_unavailable" },
        timedOut ? 504 : 502,
      );
    } finally {
      clearTimeout(sttTimer);
      sttCtrl.abort();
    }
  });

  return app;
}
