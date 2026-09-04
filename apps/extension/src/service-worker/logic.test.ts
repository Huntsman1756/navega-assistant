import { describe, it, expect } from "vitest";
import { requestAssist, buildAssistPayload } from "./logic";
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
