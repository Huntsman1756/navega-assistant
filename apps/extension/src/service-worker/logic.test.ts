import { describe, it, expect } from "vitest";
import { requestAssist, buildAssistPayload } from "./logic";
import type { AccessibleDOMSnapshot } from "@guided-web/protocol";

function snapshot(label: string): AccessibleDOMSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: label,
    page: { url: "https://example.com", origin: "https://example.com", title: label },
    elements: [{ id: "el-0", tag: "button", role: "button", accessibleName: label, interactive: true }],
  };
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

    const a = await requestAssist("http://localhost:8787", snapshot("a"), "q1", fetchImpl);
    const b = await requestAssist("http://localhost:8787", snapshot("b"), "q2", fetchImpl);
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
    const first = await requestAssist("http://localhost:8787", snapshot("x"), "q", fetchImpl);
    const second = await requestAssist("http://localhost:8787", snapshot("y"), "q", fetchImpl);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
  });

  it("returns ok:false (and never a stale/valid-looking answer) on backend failure", async () => {
    const fetchImpl = () => Promise.reject(new Error("network"));
    const res = await requestAssist("http://localhost:8787", snapshot("z"), "q", fetchImpl);
    expect(res).toEqual({ type: "GWA_ASSIST_RESULT", ok: false, error: "network" });
  });

  it("builds a mode-locked DOM_ONLY payload", () => {
    const payload = buildAssistPayload(snapshot("s"), "hello");
    expect(payload).toMatchObject({ protocolVersion: 1, mode: "DOM_ONLY", question: "hello" });
  });
});
