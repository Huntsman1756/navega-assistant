/**
 * Stateless request logic for the service worker, isolated from the Chrome API
 * so it can be unit-tested. P0 holds no persistent guidance session, so a
 * service-worker restart cannot corrupt any session state — every request is
 * a fresh, self-contained call to the backend.
 */
import type { AssistResultMessage } from "../shared/messages";
import { AssistRequestSchema, AssistResponseSchema, type HelpSession, type PageContext } from "@guided-web/protocol";

/**
 * Fail-safe deadline for the extension → localhost backend request. It is
 * LONGER than the backend provider deadline (default 8000 ms) so the backend
 * almost always wins the race and answers with a precise `provider_timeout`
 * (504). The browser-side deadline only fires when the backend itself is
 * hung/unreachable, and guarantees the request can never hang forever.
 * Margin: 8000 provider + response/serialization/message-passing + slow
 * machine scheduling ⇒ 12000. No automatic retry.
 */
export const BACKEND_REQUEST_TIMEOUT_MS = 12000;

export function buildAssistPayload(
  context: PageContext,
  question: string,
  session: HelpSession,
) {
  return {
    protocolVersion: 3,
    mode: "DOM_ONLY" as const,
    question,
    session,
    context,
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function requestAssist(
  backendUrl: string,
  context: PageContext,
  question: string,
  session: HelpSession,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = BACKEND_REQUEST_TIMEOUT_MS,
): Promise<AssistResultMessage> {
  // Local-only perf instrumentation: duration + outcome, never the question,
  // the page content or the session. No telemetry, no persistence.
  const t0 = performance.now();
  let outcome: "ok" | "timeout" | "error" = "error";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${backendUrl}/v1/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(AssistRequestSchema.parse(buildAssistPayload(context, question, session))),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => null)) as
      | { error?: string; decision?: unknown }
      | null;

    // The deadline may also expire while the (small) body is being read.
    if (controller.signal.aborted) {
      outcome = "timeout";
      return { type: "GWA_ASSIST_RESULT", ok: false, error: "backend_timeout" };
    }
    if (!res.ok) {
      // A backend `provider_timeout` (504) keeps its distinct code; it must
      // never be flattened into the generic local `network` failure.
      outcome = "error";
      return { type: "GWA_ASSIST_RESULT", ok: false, error: ["provider_timeout", "provider_unavailable", "invalid_model_output", "provider_busy"].includes(data?.error ?? "") ? data!.error! : "backend_error" };
    }

    const parsed = AssistResponseSchema.safeParse(data);
    if (!parsed.success || parsed.data.mode !== "DOM_ONLY") return { type: "GWA_ASSIST_RESULT", ok: false, error: "invalid_model_output" };
    outcome = "ok";
    return { type: "GWA_ASSIST_RESULT", ok: true, decision: parsed.data.decision };
  } catch {
    // Aborted by OUR deadline → distinguishable backend_timeout. Any other
    // failure (connection refused, DNS, reset) is the classic `network`.
    // A late-arriving response is impossible: fetch is already cancelled.
    const timedOut = controller.signal.aborted;
    outcome = timedOut ? "timeout" : "error";
    return {
      type: "GWA_ASSIST_RESULT",
      ok: false,
      error: timedOut ? "backend_timeout" : "network",
    };
  } finally {
    clearTimeout(timer);
    console.log(`[perf] backend_request_ms=${Math.round(performance.now() - t0)} result=${outcome}`);
  }
}
