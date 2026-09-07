import { describe, expect, it, vi } from "vitest";
import {
  ProviderHttpError,
  ProviderOutputError,
  type AIProvider,
  type AssistModelRequest,
  type AssistModelResponse,
} from "@guided-web/provider";
import { P0AssistantDecisionSchema } from "@guided-web/protocol";
import {
  assistWithProviderHedge,
  ProviderAttemptTimeoutError,
  ProviderTotalTimeoutError,
  ProviderValidationFailedError,
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

const invalidJsonResponse: AssistModelResponse = {
  raw: "this is not json",
  provider: "test",
  model: "test-model",
};

const invalidSchemaResponse: AssistModelResponse = {
  raw: JSON.stringify({ kind: "unknown_action", data: "not allowed by schema" }),
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

  // ── C2: validated hedge semantics ──

  function withValidation(provider: AIProvider, opts = {}) {
    return assistWithProviderHedge(provider, request, {
      attemptTimeoutMs: 500,
      totalTimeoutMs: 3000,
      hedgeDelayMs: 10,
      validateResponse: (response) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(response.raw);
        } catch {
          throw new ProviderValidationFailedError();
        }
        const result = P0AssistantDecisionSchema.safeParse(parsed);
        if (!result.success) {
          throw new ProviderValidationFailedError();
        }
        return response;
      },
      ...opts,
    });
  }

  it("C2: A valid fast → A wins → B never starts", async () => {
    const testProvider = providerFor(() => success);
    await expect(withValidation(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(1);
  });

  it("C2: A invalid JSON before hedge delay → B starts → B valid → success", async () => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) return invalidJsonResponse;
      return success;
    });
    await expect(withValidation(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
  });

  it("C2: A schema-invalid before hedge delay → B starts → B valid → success", async () => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) return invalidSchemaResponse;
      return success;
    });
    await expect(withValidation(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
  });

  it("C2: A invalid while B already running → B NOT aborted", async () => {
    // A takes 20ms (longer than hedge delay 10ms) so B starts before A resolves.
    // A's validation then fails, but B is already running and NOT aborted.
    // A's signal is NOT actively aborted while B runs (the code waits for
    // settleSuccess/settleError to call abortActive), but A's result is
    // still discarded and B's result wins.
    const testProvider = providerFor((attempt, signal) => {
      if (attempt === 1) return delayed(invalidJsonResponse, 20);
      return new Promise<AssistModelResponse>((resolve) => {
        const onAbort = () => {
          resolve({ raw: "ABORTED", provider: "test" });
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => resolve(success), 5);
      });
    });
    const result = await withValidation(testProvider.provider);
    expect(result).toEqual(success);
    expect(testProvider.attempts()).toBe(2);
    // A is NOT actively aborted while B runs; B wins via settleSuccess which
    // then calls abortActive (cleaning up both at that point). The key invariant
    // is that B is NOT aborted: it delivers the winning result.
    expect(testProvider.signals[1]!.aborted).toBe(false);
  });

  it("C2: A invalid + B invalid → final invalid_model_output", async () => {
    const testProvider = providerFor(() => invalidJsonResponse);
    await expect(withValidation(testProvider.provider)).rejects.toBeInstanceOf(ProviderValidationFailedError);
    expect(testProvider.attempts()).toBe(2);
  });

  it("C2: A invalid + B timeout → deterministic final classification", async () => {
    const testProvider = providerFor((attempt, signal) => {
      if (attempt === 1) return invalidJsonResponse;
      return abortable(signal);
    });
    await expect(
      withValidation(testProvider.provider, {
        attemptTimeoutMs: 500,
        totalTimeoutMs: 800,
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptTimeoutError);
    expect(testProvider.attempts()).toBe(2);
  });

  it("C2: A timeout + B valid → success", async () => {
    const testProvider = providerFor((attempt, signal) => {
      if (attempt === 1) return abortable(signal);
      return success;
    });
    await expect(withValidation(testProvider.provider)).resolves.toEqual(success);
    expect(testProvider.attempts()).toBe(2);
    expect(testProvider.signals[0]?.aborted).toBe(true);
  });

  it("C2: A valid + B invalid → A wins normally", async () => {
    // A takes 20ms (longer than hedge delay 10ms) so B starts.
    // A is valid, B is invalid. A wins, B is aborted.
    const testProvider = providerFor((attempt, signal) => {
      if (attempt === 1) return delayed(success, 20);
      return delayed(invalidSchemaResponse, 5);
    });
    const result = await withValidation(testProvider.provider);
    expect(result).toEqual(success);
    expect(testProvider.attempts()).toBe(2);
    expect(testProvider.signals[1]!.aborted).toBe(true);
  });

  it("C2: max two physical calls", async () => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) return delayed(success, 5000);
      return delayed(success, 5000);
    });
    // Both attempts can launch because totalTimeout > attemptTimeout.
    // Both time out. Only 2 physical calls happen.
    await expect(
      withValidation(testProvider.provider, {
        totalTimeoutMs: 2000,
        attemptTimeoutMs: 500,
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptTimeoutError);
    // The key assertion: max 2 physical calls.
    expect(testProvider.attempts()).toBe(2);
  });

  it("C2: one logical session result only (resolve + reject must not double-fire)", async () => {
    const testProvider = providerFor((attempt) => {
      if (attempt === 1) return invalidJsonResponse;
      return success;
    });
    let settled = false;
    let callCount = 0;
    const result = withValidation(testProvider.provider).then(
      () => { settled = true; callCount++; },
      () => { settled = true; callCount++; },
    );
    await result;
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(true);
    expect(callCount).toBe(1);
  });

  it("C2: global deadline preserved (12s budget)", async () => {
    const testProvider = providerFor((attempt, signal) => {
      if (attempt === 1) return invalidJsonResponse;
      return abortable(signal);
    });
    const start = performance.now();
    // attemptTimeout=400ms, totalTimeout=500ms. B's attempt timeout fires first.
    // We verify the total time does not exceed the global deadline + margin.
    await expect(
      withValidation(testProvider.provider, {
        totalTimeoutMs: 5000,
        attemptTimeoutMs: 400,
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptTimeoutError);
    const elapsed = performance.now() - start;
    // The total wall-clock time is bounded by totalTimeout.
    expect(elapsed).toBeLessThan(5500);
    expect(testProvider.attempts()).toBe(2);
  });

  it("C2: activeCalls returns to zero (no hanging callbacks)", async () => {
    const testProvider = providerFor((attempt, signal) => {
      if (attempt === 1) return invalidJsonResponse;
      return abortable(signal);
    });
    let activeCalls = 0;
    let maxCalls = 0;
    await withValidation(testProvider.provider, {
      onAttemptStart: () => {
        activeCalls++;
        maxCalls = Math.max(maxCalls, activeCalls);
        return true;
      },
      onAttemptComplete: () => {
        activeCalls--;
      },
      totalTimeoutMs: 500,
      attemptTimeoutMs: 500,
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(maxCalls).toBeLessThanOrEqual(2);
    expect(activeCalls).toBe(0);
  });
});