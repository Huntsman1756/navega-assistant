import pRetry from "p-retry";
import {
  ProviderConnectionError,
  ProviderHttpError,
} from "@guided-web/provider";
import type { AssistModelRequest, AssistModelResponse, AIProvider } from "@guided-web/provider";
import { MAX_PROVIDER_ATTEMPTS } from "./config";

export const RETRY_MIN_DELAY_MS = 100;
export const RETRY_MAX_DELAY_MS = 500;

export class ProviderAttemptTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super("provider attempt timeout");
    this.name = "ProviderAttemptTimeoutError";
  }
}

export class ProviderTotalTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super("provider total timeout");
    this.name = "ProviderTotalTimeoutError";
  }
}

export interface ProviderRetryOptions {
  attemptTimeoutMs: number;
  totalTimeoutMs: number;
  signal?: AbortSignal;
  /** Local validation hook; it receives no request or provider content. */
  onAttempt?: (attempt: number) => void;
}

interface CombinedSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

function combineSignals(parent: AbortSignal | undefined, child: AbortSignal): CombinedSignal {
  if (!parent) return { signal: child, cleanup: () => {} };

  const controller = new AbortController();
  const forward = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const onParentAbort = () => forward(parent);
  const onChildAbort = () => forward(child);

  if (parent.aborted) forward(parent);
  else if (child.aborted) forward(child);
  else {
    parent.addEventListener("abort", onParentAbort, { once: true });
    child.addEventListener("abort", onChildAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      parent.removeEventListener("abort", onParentAbort);
      child.removeEventListener("abort", onChildAbort);
    },
  };
}

function remainingMs(startedAt: number, totalMs: number): number {
  return totalMs - (performance.now() - startedAt);
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function withAttemptTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderAttemptTimeoutError(timeoutMs));
    }, Math.max(0, timeoutMs));
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(controller.signal.aborted ? new ProviderAttemptTimeoutError(timeoutMs) : error);
      },
    );
  });
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof ProviderHttpError) return error.status;
  if (!error || typeof error !== "object") return undefined;
  const candidate = (error as { status?: unknown; statusCode?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode;
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : undefined;
}

function networkLike(error: unknown): boolean {
  if (error instanceof ProviderConnectionError) return true;
  if (!(error instanceof Error) || error.name === "AbortError" || error.name === "TimeoutError") {
    return false;
  }
  const cause = error.cause instanceof Error ? `${error.cause.name} ${error.cause.message}` : String(error.cause ?? "");
  return /network|fetch failed|connection|socket|econn|enotfound|dns|unreachable|reset/i.test(`${error.message} ${cause}`);
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderAttemptTimeoutError || networkLike(error)) return true;
  const status = statusOf(error);
  return status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500);
}

function retryAfterMs(error: unknown): number | undefined {
  if (statusOf(error) !== 429 || !error || typeof error !== "object") return undefined;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function assistWithProviderRetry(
  provider: AIProvider,
  request: AssistModelRequest,
  options: ProviderRetryOptions,
): Promise<AssistModelResponse> {
  const startedAt = performance.now();
  let retryAllowed = false;

  return pRetry(
    async (attempt) => {
      const remaining = remainingMs(startedAt, options.totalTimeoutMs);
      if (remaining <= 0) throw new ProviderTotalTimeoutError(options.totalTimeoutMs);

      options.onAttempt?.(attempt);
      const attemptController = new AbortController();
      const combined = combineSignals(options.signal, attemptController.signal);
      try {
        const work = Promise.resolve().then(() => provider.assist(request, combined.signal));
        return await withAttemptTimeout(
          work,
          Math.min(options.attemptTimeoutMs, remaining),
          attemptController,
        );
      } catch (error) {
        if (networkLike(error) && !(error instanceof ProviderConnectionError)) {
          throw new ProviderConnectionError(error);
        }
        throw error;
      } finally {
        combined.cleanup();
      }
    },
    {
      retries: MAX_PROVIDER_ATTEMPTS - 1,
      maxRetryTime: options.totalTimeoutMs,
      minTimeout: RETRY_MIN_DELAY_MS,
      maxTimeout: RETRY_MAX_DELAY_MS,
      factor: 2,
      randomize: true,
      signal: options.signal,
      onFailedAttempt: async ({ error, retriesLeft, retryDelay }) => {
        retryAllowed = false;
        if (retriesLeft <= 0 || !isRetryableProviderError(error)) return;

        const requestedDelay = retryAfterMs(error);
        const delay = requestedDelay ?? retryDelay;
        if (!Number.isFinite(delay) || delay < 0 || delay >= remainingMs(startedAt, options.totalTimeoutMs)) return;

        retryAllowed = true;
        if (requestedDelay !== undefined && requestedDelay > retryDelay) {
          await waitForRetry(requestedDelay - retryDelay, options.signal);
        }
      },
      shouldRetry: ({ error }) =>
        retryAllowed
        && isRetryableProviderError(error)
        && remainingMs(startedAt, options.totalTimeoutMs) > 0,
    },
  );
}
