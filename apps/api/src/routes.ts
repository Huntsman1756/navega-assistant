import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_PROVIDER_CALLS = 2;
import type { AIProvider } from "@guided-web/provider";
import {
  AssistRequestSchema,
  P0AssistantDecisionSchema,
  PROTOCOL_VERSION,
} from "@guided-web/protocol";
import { checkInstructionSafety, checkConversationSimplicity } from "@guided-web/security-policy";
import { buildSystemPrompt } from "./prompt";
import { DEFAULT_PROVIDER_TIMEOUT_MS } from "./config";

export { DEFAULT_PROVIDER_TIMEOUT_MS };

/**
 * Sentinel error raised when the provider exceeds its hard deadline. It is
 * classified specifically as `provider_timeout` (HTTP 504), never folded into
 * the generic `provider_unavailable`. No automatic retry.
 */
export class ProviderTimeoutError extends Error {
  constructor() {
    super("provider_timeout");
    this.name = "ProviderTimeoutError";
  }
}

/**
 * Races a provider promise against a hard deadline. On expiry the controller
 * is aborted (so the provider's underlying fetch is cancelled and the socket
 * released) and the race rejects with `ProviderTimeoutError`. Even a provider
 * that ignores the AbortSignal cannot delay the HTTP response past the limit.
 * The timer is always cleared once the race settles (success OR failure).
 */
function withProviderTimeout<T>(
  promise: Promise<T>,
  ms: number,
  controller: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError());
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
  opts?: { providerTimeoutMs?: number },
): Hono {
  const app = new Hono();
  const providerTimeoutMs = opts?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;

  let activeCalls = 0;
  app.get("/health", (c) => c.json({ ok: true, provider: providerName, model }));
  app.use("/v1/assist", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "body_too_large" }, 413) }));

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
    let response;
    // Local-only perf instrumentation. Duration + outcome ONLY: never the
    // question, the page content, the session, URLs or any provider detail.
    const tProvider = performance.now();
    const controller = new AbortController();
    try {
      activeCalls += 1;
      // Hold the slot until underlying work settles, even if it ignores abort.
      const work = Promise.resolve().then(() => provider.assist(
          {
            mode: req.mode,
            question: req.question,
            session: req.session,
            context: req.context,
            systemPrompt: buildSystemPrompt(),
          },
          controller.signal,
        )).finally(() => { activeCalls -= 1; });
      response = await withProviderTimeout(
        work,
        providerTimeoutMs,
        controller,
      );
    } catch (err) {
      const elapsedMs = Math.round(performance.now() - tProvider);
      const timedOut = err instanceof ProviderTimeoutError || controller.signal.aborted;
      if (timedOut) {
        console.log(`[perf] provider_ms=${elapsedMs} result=timeout`);
        return c.json({ error: "provider_timeout" }, 504);
      }
      // Log ONLY the error class name (never the message: provider error text
      // can echo request content). The extension gets a stable code only.
      const kind = err instanceof Error ? err.name : "unknown";
      console.log(`[perf] provider_ms=${elapsedMs} result=error error_kind=${kind}`);
      return c.json({ error: "provider_unavailable" }, 502);
    }
    console.log(`[perf] provider_ms=${Math.round(performance.now() - tProvider)} result=ok`);

    let rawDecision: unknown;
    try {
      rawDecision = JSON.parse(response.raw);
    } catch {
      return c.json({ error: "invalid_model_output", reason: "not_json" }, 502);
    }

    const decisionParsed = P0AssistantDecisionSchema.safeParse(rawDecision);
    if (!decisionParsed.success) {
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

    return c.json({
      protocolVersion: PROTOCOL_VERSION,
      decision: out,
      mode: req.mode,
      provider: response.provider,
      model: response.model ?? model,
    });
  });

  return app;
}
