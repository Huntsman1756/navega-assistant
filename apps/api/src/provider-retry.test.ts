import { describe, expect, it, vi } from "vitest";
import {
  ProviderHttpError,
  type AIProvider,
  type AssistModelRequest,
  type AssistModelResponse,
} from "@guided-web/provider";
import {
  assistWithProviderRetry,
  ProviderAttemptTimeoutError,
  RETRY_MAX_DELAY_MS,
  RETRY_MIN_DELAY_MS,
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

function abortableTimeout(signal: AbortSignal | undefined): Promise<AssistModelResponse> {
  return new Promise<AssistModelResponse>((_resolve, reject) => {
    const onAbort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
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
  options: Partial<Parameters<typeof assistWithProviderRetry>[2]> = {},
) {
  return assistWithProviderRetry(provider, request, {
    attemptTimeoutMs: 25,
    totalTimeoutMs: 1000,
    ...options,
  });
}

describe("bounded provider retry policy", () => {
  it("returns a fast success after exactly one provider attempt", async () => {
    const testProvider = providerFor(async () => success);
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(1);
  });

  it("reports only bounded attempt duration and retry-reason classes", async () => {
    const observations: Array<{ attempt: number; attemptMs: number; retryReason: string }> = [];
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) throw new ProviderHttpError(503);
      return success;
    });
    await expect(run(testProvider.provider, { onAttemptComplete: observation => observations.push(observation) }))
      .resolves.toEqual(success);
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ attempt: 1, retryReason: "http_503" });
    expect(observations[1]).toMatchObject({ attempt: 2, retryReason: "none" });
    expect(observations.every(observation => Number.isInteger(observation.attemptMs))).toBe(true);
  });

  it("retries one provider-attempt timeout and returns the successful second result", async () => {
    const testProvider = providerFor((attempt, signal) =>
      attempt === 1 ? abortableTimeout(signal) : success,
    );
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
    expect(testProvider.signals).toHaveLength(2);
    expect(testProvider.signals[0]).not.toBe(testProvider.signals[1]);
    expect(testProvider.signals[0]?.aborted).toBe(true);
    expect(testProvider.signals[1]?.aborted).toBe(false);
  });

  it("gives the second attempt a near-normal window after an 8-second-style timeout", async () => {
    const testProvider = providerFor((attempt, signal) => {
      if (attempt === 1) return abortableTimeout(signal);
      return new Promise<AssistModelResponse>((resolve) => {
        setTimeout(() => resolve(success), 60);
      });
    });
    await expect(run(testProvider.provider, { attemptTimeoutMs: 80, totalTimeoutMs: 700 })).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
  });

  it.each([408, 409, 429, 500, 503])("retries HTTP %s once", async (status) => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) throw new ProviderHttpError(status, status === 429 ? 120 : undefined);
      return success;
    });
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
  });

  it("retries a connection failure once", async () => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) throw new TypeError("fetch failed");
      return success;
    });
    await expect(run(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
  });

  it.each([400, 401, 403, 404, 422])("does not retry deterministic HTTP %s", async (status) => {
    const testProvider = providerFor(() => {
      throw new ProviderHttpError(status);
    });
    await expect(run(testProvider.provider)).rejects.toMatchObject({ status });
    expect(testProvider.attempts()).toBe(1);
  });

  it("does not retry a deterministic provider error", async () => {
    const testProvider = providerFor(() => {
      throw new Error("invalid_model_output");
    });
    await expect(run(testProvider.provider)).rejects.toThrow("invalid_model_output");
    expect(testProvider.attempts()).toBe(1);
  });

  it("returns the final timeout after two timed-out attempts", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const testProvider = providerFor((_attempt, signal) => abortableTimeout(signal));
    try {
      await expect(run(testProvider.provider, { attemptTimeoutMs: 25, totalTimeoutMs: 400 }))
        .rejects.toBeInstanceOf(ProviderAttemptTimeoutError);
      expect(testProvider.attempts()).toBe(2);
    } finally {
      random.mockRestore();
    }
  });

  it("keeps Retry-After inside the total budget", async () => {
    const testProvider = providerFor(() => {
      throw new ProviderHttpError(429, 500);
    });
    const started = performance.now();
    await expect(run(testProvider.provider, { totalTimeoutMs: 300 })).rejects.toBeInstanceOf(ProviderHttpError);
    expect(testProvider.attempts()).toBe(1);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("does not start a retry when the remaining budget cannot provide a useful window", async () => {
    const testProvider = providerFor(() => new Promise<AssistModelResponse>((_resolve, reject) => {
      setTimeout(() => reject(new ProviderHttpError(503)), 100);
    }));
    await expect(run(testProvider.provider, { attemptTimeoutMs: 120, totalTimeoutMs: 400 }))
      .rejects.toBeInstanceOf(ProviderHttpError);
    expect(testProvider.attempts()).toBe(1);
  });

  it("keeps retry jitter bounded", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof timeout === "number" && timeout >= RETRY_MIN_DELAY_MS) delays.push(timeout);
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);
    try {
      const testProvider = providerFor((attempt) => {
        if (attempt === 1) throw new ProviderHttpError(503);
        return success;
      });
      await expect(run(testProvider.provider)).resolves.toEqual(success);
      expect(delays.some(delay => delay >= RETRY_MIN_DELAY_MS && delay <= RETRY_MAX_DELAY_MS)).toBe(true);
    } finally {
      random.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("does not materially exceed the total budget when no retry can fit", async () => {
    const testProvider = providerFor((_attempt, signal) => abortableTimeout(signal));
    const started = performance.now();
    await expect(run(testProvider.provider, { attemptTimeoutMs: 120, totalTimeoutMs: 150 }))
      .rejects.toBeInstanceOf(ProviderAttemptTimeoutError);
    expect(testProvider.attempts()).toBe(1);
    expect(performance.now() - started).toBeLessThan(250);
  });

});
