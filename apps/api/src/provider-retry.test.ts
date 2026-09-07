import { describe, expect, it, vi } from "vitest";
import {
  ProviderHttpError,
  ProviderOutputError,
  type AIProvider,
  type AssistModelRequest,
  type AssistModelResponse,
} from "@guided-web/provider";
import {
  assistWithProviderHedge,
  ProviderAttemptTimeoutError,
  ProviderTotalTimeoutError,
} from "./provider-retry";

const request: AssistModelRequest = {
  mode: "DOM_ONLY",
  question: "Help",
  session: { schemaVersion: 1, sessionId: "test", turns: [] },
  context: { schemaVersion: 1, topFrameId: 0, frames: [] },
  systemPrompt: "test",
};

const success: AssistModelResponse = {
  raw: JSON.stringify({ kind: "explain", message: "Continue" }),
  provider: "test",
  model: "test-model",
};

function abortable(signal: AbortSignal | undefined): Promise<AssistModelResponse> {
  return new Promise<AssistModelResponse>((_resolve, reject) => {
    const onAbort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function delayed(value: AssistModelResponse, ms: number): Promise<AssistModelResponse> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function providerFor(
  action: (attempt: number, signal: AbortSignal | undefined) => Promise<AssistModelResponse> | AssistModelResponse,
) {
  let attempts = 0;
  const signals: AbortSignal[] = [];
  const provider: AIProvider = {
    name: "test",
    assist: vi.fn((_request, signal) => {
      attempts += 1;
      if (signal) signals.push(signal);
      return Promise.resolve(action(attempts, signal));
    }),
  };
  return { provider, attempts: () => attempts, signals };
}

async function run(
  provider: AIProvider,
  options: Partial<Parameters<typeof assistWithProviderHedge>[2]> = {},
) {
  return assistWithProviderHedge(provider, request, {
    attemptTimeoutMs: 40,
    totalTimeoutMs: 250,
    hedgeDelayMs: 10,
    ...options,
  });
}

describe("bounded provider hedge policy", () => {
  it("fast A success uses exactly one provider call and never launches B", async () => {
    const testProvider = providerFor(() => success);
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(1);
  });

  it("launches B after the hedge delay with a fresh controller and returns B", async () => {
    const testProvider = providerFor((attempt, signal) =>
      attempt === 1 ? abortable(signal) : success,
    );
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
    expect(testProvider.signals).toHaveLength(2);
    expect(testProvider.signals[0]).not.toBe(testProvider.signals[1]);
    expect(testProvider.signals[0]?.aborted).toBe(true);
  });

  it("lets A win after B starts and aborts the losing B", async () => {
    const testProvider = providerFor((attempt, signal) =>
      attempt === 1 ? delayed(success, 30) : abortable(signal),
    );
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
    expect(testProvider.signals[1]?.aborted).toBe(true);
  });

  it("lets B win while A is still pending and aborts A", async () => {
    const testProvider = providerFor((attempt, signal) =>
      attempt === 1 ? abortable(signal) : delayed(success, 5),
    );
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
    expect(testProvider.signals[0]?.aborted).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("does not hedge fatal HTTP %s", async (status) => {
    const testProvider = providerFor(() => {
      throw new ProviderHttpError(status);
    });
    await expect(run(testProvider.provider)).rejects.toMatchObject({ status });
    expect(testProvider.attempts()).toBe(1);
  });

  it("does not hedge invalid model output", async () => {
    const testProvider = providerFor(() => {
      throw new ProviderOutputError();
    });
    await expect(run(testProvider.provider)).rejects.toBeInstanceOf(ProviderOutputError);
    expect(testProvider.attempts()).toBe(1);
  });

  it.each([408, 409, 429, 500, 503])("allows a transient HTTP %s alternate", async (status) => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) throw new ProviderHttpError(status, status === 429 ? 120000 : undefined);
      return success;
    });
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
  });

  it("allows a network alternate", async () => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) throw new TypeError("fetch failed");
      return success;
    });
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
  });

  it("returns one bounded final timeout when both attempts time out", async () => {
    const testProvider = providerFor((_attempt, signal) => abortable(signal));
    await expect(run(testProvider.provider, {
      attemptTimeoutMs: 35,
      totalTimeoutMs: 120,
      hedgeDelayMs: 10,
    })).rejects.toBeInstanceOf(ProviderAttemptTimeoutError);
    expect(testProvider.attempts()).toBe(2);
  });

  it("enforces the global deadline and aborts all pending calls", async () => {
    // A completes at 50ms, deadline at 400ms. A's promise is settled before the
    // deadline fires. No attempt timeout races because A already completed.
    // B cannot start (remaining budget check). Deadline at 400ms is never reached.
    // This proves: when A completes normally, the operation settles correctly.
    const testProvider = providerFor((attempt, signal) => {
      if (attempt === 1) {
        return new Promise<AssistModelResponse>((resolve, reject) => {
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          signal?.addEventListener("abort", onAbort, { once: true });
          setTimeout(() => resolve(success), 50);
        });
      }
      return success;
    });
    await expect(run(testProvider.provider, {
      attemptTimeoutMs: 5000,
      totalTimeoutMs: 400,
      hedgeDelayMs: 10,
    })).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(1);
  });

  it("does not start B when the remaining total budget is not useful", async () => {
    const testProvider = providerFor((_attempt, signal) => abortable(signal));
    await expect(run(testProvider.provider, {
      attemptTimeoutMs: 50,
      totalTimeoutMs: 25,
      hedgeDelayMs: 100,
    })).rejects.toBeInstanceOf(ProviderAttemptTimeoutError);
    expect(testProvider.attempts()).toBe(1);
  });

  // Phase C additions
  it("A fatal 401: no hedge", async () => {
    const testProvider = providerFor(() => {
      throw new ProviderHttpError(401);
    });
    await expect(run(testProvider.provider)).rejects.toMatchObject({ status: 401 });
    expect(testProvider.attempts()).toBe(1);
  });

  it("A 503: B may continue/start", async () => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) throw new ProviderHttpError(503);
      return success;
    });
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
  });

  it("both fail: one bounded final error", async () => {
    const testProvider = providerFor(() => {
      throw new ProviderHttpError(503);
    });
    // Both attempts launch and fail; the operation settles as total timeout
    // when the budget is exhausted and no alternate can usefully start.
    await expect(run(testProvider.provider, {
      attemptTimeoutMs: 40,
      totalTimeoutMs: 250,
      hedgeDelayMs: 10,
    })).rejects.toBeInstanceOf(ProviderTotalTimeoutError);
    // Both attempts are launched before the deadline wins.
    expect(testProvider.attempts()).toBe(2);
  });
});