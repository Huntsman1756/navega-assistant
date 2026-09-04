import { describe, it, expect } from "vitest";
import { MockProvider } from "@guided-web/provider";
import { createApp } from "./routes";
import type { AccessibleDOMSnapshot } from "@guided-web/protocol";

const snapshot: AccessibleDOMSnapshot = {
  schemaVersion: 1,
  snapshotId: "snap-1",
  page: { url: "https://example.com/login", origin: "https://example.com", title: "Sign in" },
  elements: [
    { id: "el-0", tag: "button", role: "button", accessibleName: "Sign in", interactive: true },
  ],
};

const emptySession = { schemaVersion: 1, sessionId: "s1", turns: [] };

const app = createApp(new MockProvider(), "mock", "mock");

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
      protocolVersion: 2,
      mode: "DOM_ONLY",
      question: "I don't know what to do here.",
      snapshot,
      session: emptySession,
    });
    expect(r.status).toBe(200);
    expect(r.json.decision.kind).toBe("explain");
    expect(r.json.decision.message).toContain("Sign in");
    expect(r.json.provider).toBe("mock");
  });

  it("rejects a snapshot that would carry a value field", async () => {
    const bad = {
      protocolVersion: 2,
      mode: "DOM_ONLY",
      question: "hi",
      snapshot: { ...snapshot, elements: [{ id: "x", tag: "input", role: "textbox", value: "s3cret" }] },
      session: emptySession,
    };
    const r = await post(bad);
    expect(r.status).toBe(400);
  });
});

describe("GET /health", () => {
  it("is ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
