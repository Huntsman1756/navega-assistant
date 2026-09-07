/**
 * Stateless request logic for the service worker, isolated from the Chrome API.
 * P0 holds no persistent guidance session here: every request is a fresh,
 * self-contained call to the backend.
 */
import type { AssistResultMessage } from "../shared/messages";
import {
  AssistRequestSchema,
  AssistResponseSchema,
  type HelpSession,
  type PageContext,
} from "@guided-web/protocol";

/**
 * Fail-safe deadline for the extension -> localhost backend request. It is
 * longer than the backend's complete assist budget (18000 ms), which includes
 * one provider retry. The 4000 ms margin covers response
 * serialization and message passing. The extension does not retry itself.
 */
export const BACKEND_REQUEST_TIMEOUT_MS = 22000;

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

function combineSignals(parent: AbortSignal | undefined, timeout: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  if (!parent) return { signal: timeout, cleanup: () => {} };
  const controller = new AbortController();
  const forward = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const onParentAbort = () => forward(parent);
  const onTimeoutAbort = () => forward(timeout);

  if (parent.aborted) forward(parent);
  else if (timeout.aborted) forward(timeout);
  else {
    parent.addEventListener("abort", onParentAbort, { once: true });
    timeout.addEventListener("abort", onTimeoutAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      parent.removeEventListener("abort", onParentAbort);
      timeout.removeEventListener("abort", onTimeoutAbort);
    },
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/**
 * A fetch implementation should observe AbortSignal, but racing the complete
 * fetch-plus-body operation also bounds test doubles and unusual adapters that
 * resolve headers while leaving the response body pending.
 */
function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export async function requestAssist(
  backendUrl: string,
  context: PageContext,
  question: string,
  session: HelpSession,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = BACKEND_REQUEST_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): Promise<AssistResultMessage> {
  // Local-only perf instrumentation: duration + outcome, never the question,
  // the page content or the session. No telemetry, no persistence.
  const t0 = performance.now();
  let outcome: "ok" | "timeout" | "error" | "cancelled" = "error";
  const timeoutController = new AbortController();
  const combined = combineSignals(externalSignal, timeoutController.signal);
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    const responseAndData = fetchImpl(`${backendUrl}/v1/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(AssistRequestSchema.parse(buildAssistPayload(context, question, session))),
      signal: combined.signal,
    }).then(async (res) => ({
      res,
      data: (await res.json().catch(() => null)) as { error?: string; decision?: unknown } | null,
    }));
    const { res, data } = await withAbort(responseAndData, combined.signal);

    // The deadline may also expire while the (small) response body is read.
    if (externalSignal?.aborted) {
      outcome = "cancelled";
      return { type: "GWA_ASSIST_RESULT", ok: false, error: "cancelled" };
    }
    if (timeoutController.signal.aborted) {
      outcome = "timeout";
      return { type: "GWA_ASSIST_RESULT", ok: false, error: "backend_timeout" };
    }
    if (!res.ok) {
      // A backend provider_timeout (504) keeps its distinct code; it must
      // never be flattened into the generic local network failure.
      const error = [
        "provider_timeout",
        "provider_unavailable",
        "invalid_model_output",
        "provider_busy",
      ].includes(data?.error ?? "")
        ? data!.error!
        : "backend_error";
      return { type: "GWA_ASSIST_RESULT", ok: false, error };
    }

    const parsed = AssistResponseSchema.safeParse(data);
    if (!parsed.success || parsed.data.mode !== "DOM_ONLY") {
      return { type: "GWA_ASSIST_RESULT", ok: false, error: "invalid_model_output" };
    }
    outcome = "ok";
    return { type: "GWA_ASSIST_RESULT", ok: true, decision: parsed.data.decision };
  } catch {
    // Aborted by OUR deadline -> backend_timeout. Any other failure (connection
    // refused, DNS, reset) is the classic network error. A late response can
    // never reach the caller because the complete operation is already settled.
    const cancelled = externalSignal?.aborted === true;
    const timedOut = timeoutController.signal.aborted;
    outcome = cancelled ? "cancelled" : timedOut ? "timeout" : "error";
    return {
      type: "GWA_ASSIST_RESULT",
      ok: false,
      error: cancelled ? "cancelled" : timedOut ? "backend_timeout" : "network",
    };
  } finally {
    clearTimeout(timer);
    combined.cleanup();
    console.log(`[perf] backend_request_ms=${Math.round(performance.now() - t0)} result=${outcome}`);
  }
}
