import { describe, it, expect, afterEach, vi } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
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

function makeProvider(): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: "https://example.invalid/v1",
    apiKey: "test-key",
    model: "test-model",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider AbortSignal support", () => {
  it("passes the caller's AbortSignal straight to fetch", async () => {
    let seenSignal: AbortSignal | undefined | null = null;
    vi.stubGlobal(
      "fetch",
      async (_url: string, init?: RequestInit) => {
        seenSignal = init?.signal;
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
    expect((err as Error).name).toBe("TypeError");
    expect(controller.signal.aborted).toBe(false);
  });
});
