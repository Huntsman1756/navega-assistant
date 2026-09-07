import { describe, it, expect, afterEach, vi } from "vitest";
import { DEFAULT_MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS, OpenAICompatibleProvider } from "./openai-compatible-provider";
import { ProviderConnectionError, ProviderHttpError, ProviderOutputError } from "./errors";
import type { AssistModelRequest } from "./types";

const request: AssistModelRequest = {
  mode: "DOM_ONLY",
  question: "q",
  session: { schemaVersion: 1, sessionId: "s", turns: [] },
  context: {
    schemaVersion: 1,
    topFrameId: 0,
    frames: [
      {
        frameId: 0,
        parentFrameId: -1,
        origin: "https://example.com",
        accessible: true,
        snapshot: {
          schemaVersion: 1,
          snapshotId: "snap-1",
          page: { url: "https://example.com", origin: "https://example.com", title: "t" },
          elements: [],
        },
      },
    ],
  },
  systemPrompt: "sp",
};

function makeProvider(options: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]> = {}): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: "https://example.invalid/v1",
    apiKey: "test-key",
    model: "test-model",
    ...options,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider AbortSignal support", () => {
  it("passes the caller's AbortSignal straight to fetch", async () => {
    let seenSignal: AbortSignal | undefined | null = null;
    let seenBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      async (_url: string, init?: RequestInit) => {
        seenSignal = init?.signal;
        seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"kind":"explain","message":"ok"}' } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const controller = new AbortController();
    const res = await makeProvider().assist(request, controller.signal);
    expect(res.raw).toContain("explain");
    expect(seenSignal).toBe(controller.signal);
    expect(seenBody?.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(seenBody?.max_tokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
  });

  it.each([512, 768, 1024, MAX_OUTPUT_TOKENS])("sends the bounded output cap %s", async (maxOutputTokens) => {
    let seenMaxTokens: unknown;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      seenMaxTokens = (JSON.parse(String(init?.body)) as Record<string, unknown>).max_tokens;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "explain", message: "Ahora: Pulsa Continuar." }) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await makeProvider({ maxOutputTokens }).assist(request);
    expect(seenMaxTokens).toBe(maxOutputTokens);
    expect(JSON.parse(result.raw)).toMatchObject({ kind: "explain" });
  });

  it("rejects an output cap above the tested production bound", () => {
    expect(() => makeProvider({ maxOutputTokens: MAX_OUTPUT_TOKENS + 1 })).toThrow(RangeError);
  });

  it("an aborted fetch rejects, and the caller can classify it as provider_timeout", async () => {
    // Realistic fetch behavior: rejects with an AbortError DOMException once
    // the signal fires. This is exactly what a hung HTTP request does.
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("signal must reach fetch");
        const onAbort = () =>
          reject(new DOMException("This operation was aborted", "AbortError"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    });

    const controller = new AbortController();
    const promise = makeProvider().assist(request, controller.signal);
    // Caller-side classification: after the deadline the caller aborts and
    // treats the rejection as provider_timeout because signal.aborted.
    setTimeout(() => controller.abort(), 5);
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("AbortError");
    // The aborted signal is what lets the caller classify this specifically
    // as provider_timeout (a plain network failure leaves aborted=false).
    expect(controller.signal.aborted).toBe(true);
  });

  it("a network failure leaves the signal NOT aborted (distinct from timeout)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const controller = new AbortController();
    const err = await makeProvider().assist(request, controller.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderConnectionError);
    expect(controller.signal.aborted).toBe(false);
  });

  it("exposes only retry metadata for retryable HTTP failures", async () => {
    vi.stubGlobal("fetch", async () => new Response("private upstream details", {
      status: 429,
      headers: { "Retry-After": "0.2" },
    }));
    const err = await makeProvider().assist(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 200 });
    expect((err as Error).message).not.toContain("private upstream details");
  });

  it("classifies a successful upstream response without content as model output", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ choices: [{ message: { reasoning_content: "thinking" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const err = await makeProvider().assist(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderOutputError);
  });

});
