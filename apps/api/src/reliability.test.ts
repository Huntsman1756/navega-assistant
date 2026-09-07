import { describe, expect, it, vi } from "vitest";
import {
  ProviderHttpError,
  ProviderOutputError,
  type AIProvider,
  type AssistModelRequest,
  type AssistModelResponse,
} from "@guided-web/provider";
import { createApp } from "./routes";

const request = {
  protocolVersion: 3,
  mode: "DOM_ONLY" as const,
  question: "Help",
  context: { schemaVersion: 1, topFrameId: 0, frames: [] },
  session: { schemaVersion: 1, sessionId: "reliability-test", turns: [] },
};

const goodResponse: AssistModelResponse = {
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

function sequenceProvider(
  action: (attempt: number, signal: AbortSignal | undefined) => Promise<AssistModelResponse> | AssistModelResponse,
) {
  let attempts = 0;
  const provider: AIProvider = {
    name: "test",
    assist: vi.fn((_request: AssistModelRequest, signal?: AbortSignal) => {
      attempts += 1;
      return Promise.resolve(action(attempts, signal));
    }),
  };
  return { provider, attempts: () => attempts };
}

async function post(app: ReturnType<typeof createApp>) {
  const response = await app.request("/v1/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return { status: response.status, json: await response.json() };
}

describe("post-G1 assist reliability contract", () => {
  it("fast success uses one provider attempt", async () => {
    const testProvider = sequenceProvider(() => goodResponse);
    const result = await post(createApp(testProvider.provider, "test", "test-model"));
    expect(result.status).toBe(200);
    expect(testProvider.attempts()).toBe(1);
  });

  it("recovers from an attempt timeout without exposing the transient failure", async () => {
    const testProvider = sequenceProvider((attempt, signal) =>
      attempt === 1 ? abortableTimeout(signal) : goodResponse,
    );
    const result = await post(createApp(testProvider.provider, "test", "test-model", {
      providerTimeoutMs: 25,
      providerTotalTimeoutMs: 600,
    }));
    expect(result.status).toBe(200);
    expect(result.json.decision.kind).toBe("explain");
    expect(testProvider.attempts()).toBe(2);
  });

  it("recovers once from HTTP 503 and from a connection error", async () => {
    for (const firstFailure of [
      () => { throw new ProviderHttpError(503); },
      () => { throw new TypeError("fetch failed"); },
    ]) {
      const testProvider = sequenceProvider((attempt) => attempt === 1 ? firstFailure() : goodResponse);
      const result = await post(createApp(testProvider.provider, "test", "test-model"));
      expect(result.status).toBe(200);
      expect(testProvider.attempts()).toBe(2);
    }
  });

  it("honors a bounded Retry-After and still returns the normal answer", async () => {
    const testProvider = sequenceProvider((attempt) => {
      if (attempt === 1) throw new ProviderHttpError(429, 120);
      return goodResponse;
    });
    const result = await post(createApp(testProvider.provider, "test", "test-model", {
      providerTotalTimeoutMs: 1000,
    }));
    expect(result.status).toBe(200);
    expect(testProvider.attempts()).toBe(2);
  });

  it.each([400, 401, 403, 404, 422])("does not retry HTTP %s", async (status) => {
    const testProvider = sequenceProvider(() => {
      throw new ProviderHttpError(status);
    });
    const result = await post(createApp(testProvider.provider, "test", "test-model"));
    expect(result.status).toBe(502);
    expect(result.json.error).toBe("provider_unavailable");
    expect(testProvider.attempts()).toBe(1);
  });

  it("does not retry invalid structured output", async () => {
    const testProvider = sequenceProvider(() => {
      throw new ProviderOutputError();
    });
    const result = await post(createApp(testProvider.provider, "test", "test-model"));
    expect(result.status).toBe(502);
    expect(result.json.error).toBe("invalid_model_output");
    expect(testProvider.attempts()).toBe(1);
  });

  it("classifies an upstream response without content as invalid_model_output without retry", async () => {
    const testProvider = sequenceProvider(() => {
      throw new ProviderOutputError();
    });
    const result = await post(createApp(testProvider.provider, "test", "test-model"));
    expect(result.status).toBe(502);
    expect(result.json).toMatchObject({ error: "invalid_model_output", reason: "provider_response" });
    expect(testProvider.attempts()).toBe(1);
  });

  it("returns one final provider_timeout after two timed-out attempts", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const testProvider = sequenceProvider((_attempt, signal) => abortableTimeout(signal));
    try {
      const started = performance.now();
      const result = await post(createApp(testProvider.provider, "test", "test-model", {
        providerTimeoutMs: 25,
        providerTotalTimeoutMs: 400,
      }));
      expect(result.status).toBe(504);
      expect(result.json.error).toBe("provider_timeout");
      expect(testProvider.attempts()).toBe(2);
      expect(performance.now() - started).toBeLessThan(350);
    } finally {
      random.mockRestore();
    }
  });

  it.each([
    { kind: "explain", message: "Ahora: Pulsa continuar.\nRuta:\n1. Continuar" },
    { kind: "ask_user", message: "¿Qué quieres hacer?" },
    { kind: "cannot_help", reason: "insufficient_context", message: "No puedo verlo todavía." },
  ])("accepts representative bounded structured output: $kind", async (decision) => {
    const provider: AIProvider = {
      name: "test",
      assist: async () => ({ ...goodResponse, raw: JSON.stringify(decision) }),
    };
    const result = await post(createApp(provider, "test", "test-model"));
    expect(result.status).toBe(200);
    expect(result.json.decision).toEqual(decision);
  });

  it("keeps active calls bounded and releases the slots after completion", async () => {
    const releases: Array<(value: AssistModelResponse) => void> = [];
    let calls = 0;
    const provider: AIProvider = {
      name: "test",
      assist: vi.fn(() => {
        calls += 1;
        if (calls <= 2) {
          return new Promise<AssistModelResponse>((resolve) => releases.push(resolve));
        }
        return Promise.resolve(goodResponse);
      }),
    };
    const app = createApp(provider, "test", "test-model", {
      providerTimeoutMs: 1000,
      providerTotalTimeoutMs: 2000,
    });
    const first = post(app);
    const second = post(app);
    await vi.waitFor(() => expect(provider.assist).toHaveBeenCalledTimes(2));
    const third = await post(app);
    expect(third.status).toBe(429);
    releases.forEach((release) => release(goodResponse));
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await post(app)).status).toBe(200);
    expect(provider.assist).toHaveBeenCalledTimes(3);
  });
});
