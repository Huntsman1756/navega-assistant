import {
  ProviderConnectionError,
  ProviderHttpError,
  ProviderOutputError,
  type AIProvider,
  type AssistModelRequest,
  type AssistModelResponse,
} from "@guided-web/provider";

/** Evidence-derived delay: B's p95 was about 8 seconds, while its p50 was 1.3 seconds. */
export const HEDGE_DELAY_MS = 4000;
export const MIN_USEFUL_ATTEMPT_WINDOW_MS = 500;

export class ProviderAttemptTimeoutError extends Error {
  constructor() {
    super("Provider attempt timed out");
    this.name = "ProviderAttemptTimeoutError";
  }
}

export class ProviderTotalTimeoutError extends Error {
  constructor() {
    super("Provider operation timed out");
    this.name = "ProviderTotalTimeoutError";
  }
}

export class ProviderConcurrencyError extends Error {
  constructor() {
    super("Provider concurrency limit reached");
    this.name = "ProviderConcurrencyError";
  }
}

export interface ProviderAttemptObservation {
  attempt: 1 | 2;
  attemptMs: number;
  retryReason: string;
}

export interface ProviderHedgeOptions {
  attemptTimeoutMs: number;
  totalTimeoutMs: number;
  hedgeDelayMs: number;
  signal?: AbortSignal;
  /** Called after a physical provider attempt has acquired a slot. */
  onAttempt?: (attempt: 1 | 2) => void;
  /** Return false when the bounded physical provider pool is full. */
  onAttemptStart?: (attempt: 1 | 2) => boolean;
  /** Local-only duration/class observability. It receives no request content. */
  onAttemptComplete?: (observation: ProviderAttemptObservation) => void;
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderAttemptTimeoutError || error instanceof ProviderConnectionError) return true;
  if (error instanceof ProviderHttpError) {
    return error.status === 408
      || error.status === 409
      || error.status === 429
      || error.status >= 500;
  }
  // Some test adapters and fetch implementations expose a connection failure
  // as TypeError. Generic Error values remain deterministic and are not retried.
  return error instanceof TypeError;
}

function retryReason(error: unknown): string {
  if (error instanceof ProviderAttemptTimeoutError) return "attempt_timeout";
  if (error instanceof ProviderHttpError) return `http_${error.status}`;
  if (error instanceof ProviderConnectionError || error instanceof TypeError) return "network";
  if (error instanceof ProviderOutputError) return "invalid_model_output";
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  return error instanceof Error ? error.name : "unknown";
}

function safeCall(callback: (() => void) | undefined): void {
  try {
    callback?.();
  } catch {
    // Observability and admission hooks must never change provider semantics.
  }
}

function safeObservation(
  callback: ((observation: ProviderAttemptObservation) => void) | undefined,
  observation: ProviderAttemptObservation,
): void {
  try {
    callback?.(observation);
  } catch {
    // A local logging hook must not turn a successful model response into an error.
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

interface AttemptState {
  attempt: 1 | 2;
  controller: AbortController;
  finished: boolean;
}

/**
 * Runs at most two idempotent provider calls for one logical assist.
 *
 * Attempt A starts immediately. If it is still pending at hedgeDelayMs,
 * attempt B starts with an independent controller. The first usable response
 * wins; a fatal error ends the operation and aborts any alternate. A single
 * global deadline bounds the logical operation and all timers are cleaned up.
 */
export function assistWithProviderHedge(
  provider: AIProvider,
  request: AssistModelRequest,
  options: ProviderHedgeOptions,
): Promise<AssistModelResponse> {
  const attemptTimeoutMs = Math.max(1, Math.floor(options.attemptTimeoutMs));
  const totalTimeoutMs = Math.max(1, Math.floor(options.totalTimeoutMs));
  const hedgeDelayMs = Math.max(0, Math.floor(options.hedgeDelayMs));
  const startedAt = performance.now();
  const deadline = startedAt + totalTimeoutMs;

  return new Promise<AssistModelResponse>((resolve, reject) => {
    let settled = false;
    let started = 0;
    let pending = 0;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    const attempts = new Map<number, AttemptState>();

    const cleanup = () => {
      if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      if (options.signal) options.signal.removeEventListener("abort", onParentAbort);
    };

    const abortActive = (reason?: unknown) => {
      for (const state of attempts.values()) {
        if (!state.finished && !state.controller.signal.aborted) state.controller.abort(reason);
      }
    };

    const settleSuccess = (response: AssistModelResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      abortActive(new DOMException("Alternate provider attempt cancelled", "AbortError"));
      resolve(response);
    };

    const settleError = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      abortActive(error);
      reject(error);
    };

    const remainingMs = () => Math.max(0, deadline - performance.now());

    const canStartAttempt = (attempt: 1 | 2): boolean => {
      const minimumWindow = attempt === 1 ? 1 : Math.min(MIN_USEFUL_ATTEMPT_WINDOW_MS, attemptTimeoutMs);
      if (settled || started >= 2 || remainingMs() < minimumWindow) return false;
      if (options.onAttemptStart && !options.onAttemptStart(attempt)) return false;
      started += 1;
      return true;
    };

    const runAttempt = async (state: AttemptState): Promise<AssistModelResponse> => {
      const attemptStartedAt = performance.now();
      const remaining = remainingMs();
      const timeoutMs = Math.max(1, Math.min(attemptTimeoutMs, remaining));
      let timedOut = false;
      let failure: unknown;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;

      const abortPromise = new Promise<never>((_resolve, abortReject) => {
        abortListener = () => {
          // The timeout's own abort is followed by its timeout rejection in
          // the same callback; preserve the more useful timeout classification.
          if (!timedOut) abortReject(abortReason(state.controller.signal));
        };
        state.controller.signal.addEventListener("abort", abortListener, { once: true });
      });
      const timeoutPromise = new Promise<never>((_resolve, timeoutReject) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          state.controller.abort();
          timeoutReject(new ProviderAttemptTimeoutError());
        }, timeoutMs);
      });

      try {
        const providerPromise = Promise.resolve().then(() => provider.assist(request, state.controller.signal));
        return await Promise.race([providerPromise, abortPromise, timeoutPromise]);
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        if (abortListener) state.controller.signal.removeEventListener("abort", abortListener);
        const observation: ProviderAttemptObservation = {
          attempt: state.attempt,
          attemptMs: Math.max(0, Math.round(performance.now() - attemptStartedAt)),
          retryReason: failure === undefined ? "none" : retryReason(failure),
        };
        safeObservation(options.onAttemptComplete, observation);
      }
    };

    const launchAttempt = (attempt: 1 | 2): boolean => {
      if (!canStartAttempt(attempt)) return false;
      const state: AttemptState = { attempt, controller: new AbortController(), finished: false };
      attempts.set(attempt, state);
      pending += 1;
      safeCall(() => options.onAttempt?.(attempt));

      void runAttempt(state).then(
        (response) => {
          state.finished = true;
          pending -= 1;
          // The observation was emitted in runAttempt's finally. Success is
          // intentionally handled only after that accounting has completed.
          settleSuccess(response);
        },
        (error: unknown) => {
          state.finished = true;
          pending -= 1;
          handleFailure(state, error);
        },
      );
      return true;
    };

    const scheduleAlternate = () => {
      if (settled || started >= 2) return;
      if (hedgeTimer !== undefined) {
        clearTimeout(hedgeTimer);
        hedgeTimer = undefined;
      }
      launchAttempt(2);
    };

    const handleFailure = (state: AttemptState, error: unknown) => {
      if (settled) return;
      if (!isRetryableProviderError(error)) {
        settleError(error);
        return;
      }

      if (started === 1 && pending === 0) {
        scheduleAlternate();
      }

      if (pending === 0) {
        // No alternate could fit in the remaining budget or acquire a slot.
        // Preserve the timeout classification when the operation deadline is
        // exhausted; otherwise return the provider's final transient error.
        if (error instanceof ProviderAttemptTimeoutError) settleError(error);
        else if (remainingMs() < MIN_USEFUL_ATTEMPT_WINDOW_MS) settleError(new ProviderTotalTimeoutError());
        else settleError(error);
      }
    };

    function onParentAbort() {
      settleError(options.signal ? abortReason(options.signal) : new DOMException("The operation was aborted", "AbortError"));
    }

    // Install the authoritative logical deadline before any per-attempt timer
    // so an exact-boundary race resolves as a total timeout, never an extra
    // attempt timeout beyond the logical budget.
    const deadlineTimer = setTimeout(() => settleError(new ProviderTotalTimeoutError()), totalTimeoutMs);
    if (options.signal?.aborted) {
      onParentAbort();
      return;
    }
    options.signal?.addEventListener("abort", onParentAbort, { once: true });

    if (!launchAttempt(1)) {
      settleError(new ProviderConcurrencyError());
      return;
    }

    hedgeTimer = setTimeout(() => {
      hedgeTimer = undefined;
      scheduleAlternate();
    }, Math.min(hedgeDelayMs, totalTimeoutMs));
  });
}

// Kept as an explicit alias for callers and historical tests while the final
// implementation is the hedged adapter rather than sequential p-retry.
export const assistWithProviderRetry = assistWithProviderHedge;
