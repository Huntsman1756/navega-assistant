import { expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import { createApp, MAX_BODY_BYTES } from "./routes";

const request = { protocolVersion: 3, mode: "DOM_ONLY", question: "Help", context: { schemaVersion: 1, topFrameId: 0, frames: [] }, session: { schemaVersion: 1, sessionId: "s", turns: [] } };
const good = { raw: JSON.stringify({ kind: "explain", message: "Continue" }), provider: "mock" };
it("accepts normal requests and rejects oversized declared and streamed bodies before provider", async () => {
  const assist = vi.fn(async () => good);
  const app = createApp({ name: "mock", assist }, "mock");
  expect((await app.request("/v1/assist", { method: "POST", body: JSON.stringify(request) })).status).toBe(200);
  assist.mockClear();
  for (const headers of [new Headers(), new Headers({ "Content-Length": String(MAX_BODY_BYTES + 1) })]) {
    expect((await app.request("/v1/assist", { method: "POST", headers, body: " ".repeat(MAX_BODY_BYTES + 1) })).status).toBe(413);
  }
  expect(assist).not.toHaveBeenCalled();
});
it("rejects server-side collection and string overflows before provider", async () => {
  const assist = vi.fn(async () => good);
  const app = createApp({ name: "mock", assist }, "mock");
  const frame = { frameId: 0, accessible: true, snapshot: { schemaVersion: 1, snapshotId: "s", page: { url: "https://example.com", origin: "https://example.com", title: "ok" }, elements: [] } };
  const bodies = [
    { ...request, question: "x".repeat(2001) },
    { ...request, session: { ...request.session, turns: Array(11).fill({ role: "user", text: "x", timestamp: 1 }) } },
    { ...request, context: { ...request.context, frames: Array(9).fill(frame) } },
    ...[ { title: "x".repeat(301) }, { url: "x".repeat(1001) } ].map(page => ({ ...request, context: { ...request.context, frames: [{ ...frame, snapshot: { ...frame.snapshot, page: { ...frame.snapshot.page, ...page } } }] } })),
    ...[{ elements: Array(201).fill({ id: "i", tag: "button", interactive: true }) }, { visibleText: Array(41).fill("x") }].map(fields => ({ ...request, context: { ...request.context, frames: [{ ...frame, snapshot: { ...frame.snapshot, ...fields } }] } })),
  ];
  for (const body of bodies) expect((await app.request("/v1/assist", { method: "POST", body: JSON.stringify(body) })).status).toBe(400);
  expect(assist).not.toHaveBeenCalled();
});
it("bounds underlying calls even when timed-out provider ignores abort", async () => {
  const assist = vi.fn(() => new Promise<typeof good>(() => {}));
  const app = createApp({ name: "mock", assist }, "mock", undefined, { providerTimeoutMs: 5 });
  for (let i = 0; i < 2; i++) expect((await app.request("/v1/assist", { method: "POST", body: JSON.stringify(request) })).status).toBe(504);
  expect((await app.request("/v1/assist", { method: "POST", body: JSON.stringify(request) })).status).toBe(429);
  expect(assist).toHaveBeenCalledTimes(2);
});
it("listens on an explicit IPv4 loopback socket", async () => {
  const server = serve({ fetch: createApp({ name: "mock", assist: async () => good }, "mock").fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>(resolve => server.once("listening", resolve));
  expect(server.address()).toMatchObject({ address: "127.0.0.1" });
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

