import { describe, it, expect, vi } from "vitest";
import { MockProvider, type AIProvider, type AssistModelRequest, type AssistModelResponse } from "@guided-web/provider";
import { createApp } from "./routes";
import type { PageContext } from "@guided-web/protocol";

const context: PageContext = {
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
        page: { url: "https://example.com/login", origin: "https://example.com", title: "Sign in" },
        elements: [
          { id: "el-0", tag: "button", role: "button", accessibleName: "Sign in", interactive: true },
        ],
      },
    },
  ],
};

const emptySession = { schemaVersion: 1, sessionId: "s1", turns: [] };

const app = createApp(new MockProvider(), "mock", "mock");

/** A provider that never settles, to exercise the hard timeout path. */
class HangingProvider implements AIProvider {
  readonly name = "hanging";
  assist(_request: AssistModelRequest, _signal?: AbortSignal): Promise<AssistModelResponse> {
    return new Promise<AssistModelResponse>(() => {});
  }
}

async function post(body: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request("/v1/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /v1/assist", () => {
  it("rejects an invalid request with 400", async () => {
    const r = await post({ foo: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("invalid_request");
  });

  it("returns a valid explain decision using the mock provider", async () => {
    const r = await post({
      protocolVersion: 3,
      mode: "DOM_ONLY",
      question: "I don't know what to do here.",
      context,
      session: emptySession,
    });
    expect(r.status).toBe(200);
    expect(r.json.decision.kind).toBe("explain");
    expect(r.json.decision.message).toContain("Sign in");
    expect(r.json.provider).toBe("mock");
  });

  it("rejects a frame snapshot that would carry a value field", async () => {
    const bad = {
      protocolVersion: 3,
      mode: "DOM_ONLY",
      question: "hi",
      context: {
        ...context,
        frames: [
          {
            frameId: 0,
            parentFrameId: -1,
            origin: "https://example.com",
            accessible: true,
            snapshot: {
              schemaVersion: 1,
              snapshotId: "x",
              page: { url: "https://example.com/login", origin: "https://example.com", title: "x" },
              elements: [{ id: "x", tag: "input", role: "textbox", value: "s3cret" }],
            },
          },
        ],
      },
      session: emptySession,
    };
    const r = await post(bad);
    expect(r.status).toBe(400);
  });

  it("returns a distinguishable provider_timeout (504) when the provider exceeds the limit", async () => {
    const timeoutApp = createApp(new HangingProvider(), "hanging", "h", { providerTimeoutMs: 25 });
    const res = await timeoutApp.request("/v1/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 3,
        mode: "DOM_ONLY",
        question: "hi",
        context,
        session: emptySession,
      }),
    });
    expect(res.status).toBe(504);
    const json = await res.json();
    expect(json.error).toBe("provider_timeout");
    // Distinguishable from provider_unavailable: no provider_unavailable field.
    expect(json.error).not.toBe("provider_unavailable");
  });

  it("returns provider_unavailable (502) on a provider error, never provider_timeout", async () => {
    const failingProvider: AIProvider = {
      name: "failing",
      async assist(): Promise<AssistModelResponse> {
        throw new Error("provider boom");
      },
    };
    const failApp = createApp(failingProvider, "failing", "f", { providerTimeoutMs: 5000 });
    const res = await failApp.request("/v1/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 3,
        mode: "DOM_ONLY",
        question: "hi",
        context,
        session: emptySession,
      }),
    });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("provider_unavailable");
    expect(json.error).not.toBe("provider_timeout");
  });

  it("never exposes the raw provider error to the extension", async () => {
    const leakingProvider: AIProvider = {
      name: "leaking",
      async assist(): Promise<AssistModelResponse> {
        throw new Error("Provider error 401: internal-key-material-leak");
      },
    };
    const leakApp = createApp(leakingProvider, "leaking", "l", { providerTimeoutMs: 5000 });
    const res = await leakApp.request("/v1/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 3,
        mode: "DOM_ONLY",
        question: "hi",
        context,
        session: emptySession,
      }),
    });
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain("internal-key-material-leak");
    expect(text).not.toContain("Provider error 401");
  });

  it("clears the timeout timer after the provider completes in time", async () => {
    const tracked = trackDeadlineTimers(4321);
    try {
      const fastApp = createApp(new MockProvider(), "mock", "mock", { providerTimeoutMs: 4321 });
      const r = await requestAssistOn(fastApp);
      expect(r.status).toBe(200);
      // The deadline timer must be cleared on success (no timer leak).
      expect(tracked.firedCount()).toBe(0);
      expect(tracked.pendingCount()).toBe(0);
    } finally {
      tracked.restore();
    }
  });

  it("clears the timeout timer after a normal provider failure", async () => {
    const tracked = trackDeadlineTimers(4322);
    try {
      const failing: AIProvider = {
        name: "failing",
        assist(): Promise<AssistModelResponse> {
          return Promise.reject(new Error("boom"));
        },
      };
      const failApp = createApp(failing, "failing", "f", { providerTimeoutMs: 4322 });
      const r = await requestAssistOn(failApp);
      expect(r.status).toBe(502);
      expect(tracked.firedCount()).toBe(0);
      expect(tracked.pendingCount()).toBe(0);
    } finally {
      tracked.restore();
    }
  });

  it("fires exactly the deadline timer when the provider exceeds the limit", async () => {
    const tracked = trackDeadlineTimers(25);
    try {
      const timeoutApp = createApp(new HangingProvider(), "hanging", "h", { providerTimeoutMs: 25 });
      const r = await requestAssistOn(timeoutApp);
      expect(r.status).toBe(504);
      expect(tracked.firedCount()).toBe(1);
    } finally {
      tracked.restore();
    }
  });

  it("logs [perf] provider_ms with NO question/page/session content", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      const secretApp = createApp(new MockProvider(), "mock", "mock", { providerTimeoutMs: 5000 });
      const r = await requestAssistOn(secretApp, "mi duda super privada 12345");
      expect(r.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    const perfLines = logged.filter((l) => l.startsWith("[perf]"));
    expect(perfLines.some((l) => /\[perf\] provider_ms=\d+ result=ok/.test(l))).toBe(true);
    for (const line of logged) {
      expect(line).not.toContain("mi duda super privada");
      expect(line).not.toContain("Sign in");
      expect(line).not.toContain("s1");
    }
  });
});

function requestAssistOn(
  target: ReturnType<typeof createApp>,
  question = "hi",
): Promise<{ status: number; json: any }> {
  return (async () => {
    const res = await target.request("/v1/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 3,
        mode: "DOM_ONLY",
        question,
        context,
        session: emptySession,
      }),
    });
    return { status: res.status, json: await res.json() };
  })();
}

/**
 * Wraps global setTimeout/clearTimeout and tracks ONLY timers created with the
 * given marker delay (the provider deadline), so tests can prove the deadline
 * timer is always cleared or fired exactly once, never leaked.
 */
function trackDeadlineTimers(markerDelay: number) {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const timers = new Map<unknown, { fired: boolean }>();
  globalThis.setTimeout = ((cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const record = { fired: false };
    const wrapped = (...a: unknown[]) => {
      record.fired = true;
      cb(...a);
    };
    const id = realSet(wrapped, ms, ...args);
    if (ms === markerDelay) timers.set(id, record);
    return id;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((id?: unknown) => {
    timers.delete(id);
    realClear(id as ReturnType<typeof globalThis.setTimeout>);
  }) as typeof globalThis.clearTimeout;
  return {
    firedCount: () => [...timers.values()].filter((t) => t.fired).length,
    pendingCount: () => timers.size,
    restore: () => {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    },
  };
}

describe("GET /health", () => {
  it("is ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
