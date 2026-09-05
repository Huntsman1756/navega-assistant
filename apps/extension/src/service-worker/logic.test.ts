import { describe, it, expect, vi, afterEach } from "vitest";
import { requestAssist, buildAssistPayload, BACKEND_REQUEST_TIMEOUT_MS } from "./logic";
import type { HelpSession, PageContext } from "@guided-web/protocol";

function context(label: string): PageContext {
  return {
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
          snapshotId: label,
          page: { url: "https://example.com", origin: "https://example.com", title: label },
          elements: [{ id: "el-0", tag: "button", role: "button", accessibleName: label, interactive: true }],
        },
      },
    ],
  };
}

function emptySession(): HelpSession {
  return { schemaVersion: 1, sessionId: "s-test", turns: [] };
}

function okFetch(body: unknown): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
}

describe("service worker assist logic (stateless, P0-14)", () => {
  it("does not reuse a previous response across requests", async () => {
    let calls = 0;
    const fetchImpl = async (url: string) => {
      calls += 1;
      return new Response(
        JSON.stringify({ decision: { kind: "explain", message: `answer-${calls}` } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const a = await requestAssist("http://localhost:8787", context("a"), "q1", emptySession(), fetchImpl);
    const b = await requestAssist("http://localhost:8787", context("b"), "q2", emptySession(), fetchImpl);
    expect(a).toMatchObject({ type: "GWA_ASSIST_RESULT", ok: true });
    expect(b).toMatchObject({ type: "GWA_ASSIST_RESULT", ok: true });
    // Each request must reach the backend fresh — no cached/stale reuse.
    expect(calls).toBe(2);
  });

  it("a fresh call (simulating a worker restart) returns its own correct result", async () => {
    const fetchImpl = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ decision: { kind: "explain", message: "fresh-answer" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    // New closure each time = new worker instance.
    const first = await requestAssist("http://localhost:8787", context("x"), "q", emptySession(), fetchImpl);
    const second = await requestAssist("http://localhost:8787", context("y"), "q", emptySession(), fetchImpl);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
  });

  it("returns ok:false (and never a stale/valid-looking answer) on backend failure", async () => {
    const fetchImpl = () => Promise.reject(new Error("network"));
    const res = await requestAssist("http://localhost:8787", context("z"), "q", emptySession(), fetchImpl);
    expect(res).toEqual({ type: "GWA_ASSIST_RESULT", ok: false, error: "network" });
  });

  it("builds a mode-locked DOM_ONLY payload carrying the session", () => {
    const payload = buildAssistPayload(context("s"), "hello", emptySession());
    expect(payload).toMatchObject({ protocolVersion: 3, mode: "DOM_ONLY", question: "hello" });
    expect(payload.context).toMatchObject({ schemaVersion: 1, topFrameId: 0 });
    expect(payload.session).toMatchObject({ schemaVersion: 1, turns: [] });
  });
});

describe("backend fail-safe deadline (browser-side)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("the browser deadline is strictly longer than the 8000 ms provider deadline", () => {
    expect(BACKEND_REQUEST_TIMEOUT_MS).toBeGreaterThan(8000);
  });

  it("passes an AbortSignal to the backend fetch", async () => {
    let seenSignal: AbortSignal | undefined | null = null;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      seenSignal = init.signal;
      return new Response(JSON.stringify({ decision: { kind: "explain", message: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const res = await requestAssist("http://localhost:8787", context("a"), "q", emptySession(), fetchImpl);
    expect(res.ok).toBe(true);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("a backend that does not answer before the browser deadline is backend_timeout, not network", async () => {
    // A fetch that only rejects when OUR deadline aborts it (hung localhost).
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    const res = await requestAssist(
      "http://localhost:8787",
      context("h"),
      "q",
      emptySession(),
      fetchImpl,
      20,
    );
    expect(res).toEqual({ type: "GWA_ASSIST_RESULT", ok: false, error: "backend_timeout" });
  });

  it("a backend answering with provider_timeout keeps its distinct code (never network/backend_timeout)", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: "provider_timeout" }), {
        status: 504,
        headers: { "Content-Type": "application/json" },
      });
    const res = await requestAssist("http://localhost:8787", context("t"), "q", emptySession(), fetchImpl);
    expect(res).toEqual({ type: "GWA_ASSIST_RESULT", ok: false, error: "provider_timeout" });
  });

  it("an ordinary connection failure remains a network error (not a timeout)", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    const res = await requestAssist("http://localhost:8787", context("n"), "q", emptySession(), fetchImpl);
    expect(res).toEqual({ type: "GWA_ASSIST_RESULT", ok: false, error: "network" });
  });

  it("a late response after the deadline can never reach the caller", async () => {
    // The fetch rejects at the deadline; a hypothetical late backend "answer"
    // resolves a promise nobody can observe twice. The settled result is final.
    const late: { resolve?: (r: Response) => void } = {};
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        late.resolve = resolve;
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    const res = await requestAssist(
      "http://localhost:8787",
      context("l"),
      "q",
      emptySession(),
      fetchImpl,
      20,
    );
    expect(res).toEqual({ type: "GWA_ASSIST_RESULT", ok: false, error: "backend_timeout" });
    // Even if the backend finally answers now, the request already settled.
    late.resolve?.(
      new Response(JSON.stringify({ decision: { kind: "explain", message: "stale" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(res).toEqual({ type: "GWA_ASSIST_RESULT", ok: false, error: "backend_timeout" });
  });

  it("[perf] backend_request_ms logs never contain question/session/page content", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      const fetchImpl = async () =>
        new Response(JSON.stringify({ decision: { kind: "explain", message: "ok" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      await requestAssist("http://localhost:8787", context("CONFIDENTIAL-PAGE"), "pregunta privada 99", emptySession(), fetchImpl);
    } finally {
      spy.mockRestore();
    }
    expect(logged.some((l) => /\[perf\] backend_request_ms=\d+ result=ok/.test(l))).toBe(true);
    for (const line of logged) {
      expect(line).not.toContain("CONFIDENTIAL");
      expect(line).not.toContain("pregunta privada");
    }
  });
});
