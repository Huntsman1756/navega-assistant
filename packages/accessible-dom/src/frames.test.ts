// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { buildPageContext, boundContext, MAX_FRAMES } from "./frames";
import type { AccessibleDOMSnapshot } from "@guided-web/protocol";

function mkSnapshot(id: string, els: number): AccessibleDOMSnapshot {
  const elements = Array.from({ length: els }, (_, i) => ({
    id: `el-${i}`,
    tag: "button",
    role: "button",
    accessibleName: `Btn ${id}-${i}`,
    interactive: true,
  }));
  return {
    schemaVersion: 1,
    snapshotId: id,
    page: { url: `https://${id}.example/x`, origin: `https://${id}.example`, title: id },
    elements,
    visibleText: [],
  };
}

describe("buildPageContext", () => {
  it("keeps the top frame distinguishable", () => {
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, origin: "https://shop.com", accessible: true, snapshot: mkSnapshot("top", 3) },
      { frameId: 1, parentFrameId: 0, origin: "https://pay.com", accessible: true, snapshot: mkSnapshot("pay", 2) },
    ]);
    expect(ctx.topFrameId).toBe(0);
    expect(ctx.frames).toHaveLength(2);
    expect(ctx.frames[0]?.frameId).toBe(0);
    expect(ctx.frames[0]?.snapshot?.snapshotId).toBe("top");
  });

  it("represents a same-origin iframe as an independent frame", () => {
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("top", 1) },
      { frameId: 2, parentFrameId: 0, accessible: true, snapshot: mkSnapshot("child", 1) },
    ]);
    const child = ctx.frames.find((f) => f.frameId === 2)!;
    expect(child.snapshot).toBeDefined();
    // Child content is never merged into the parent snapshot.
    expect(ctx.frames[0]?.snapshot?.elements.map((e) => e.accessibleName)).not.toContain("Btn child-0");
    expect(child.snapshot?.elements.map((e) => e.accessibleName)).toContain("Btn child-0");
  });

  it("represents an unavailable cross-origin frame explicitly, not empty", () => {
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("top", 2) },
      { frameId: 3, parentFrameId: 0, accessible: false, unavailableReason: "cross_origin_unavailable" },
    ]);
    const unavailable = ctx.frames.find((f) => f.frameId === 3)!;
    expect(unavailable.accessible).toBe(false);
    expect(unavailable.snapshot).toBeUndefined();
    expect(unavailable.unavailableReason).toBe("cross_origin_unavailable");
  });

  it("does not let an inaccessible frame break the context", () => {
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("top", 2) },
      { frameId: 4, parentFrameId: 0, accessible: false, unavailableReason: "cross_origin_unavailable" },
    ]);
    expect(ctx.frames).toHaveLength(2);
    expect(ctx.frames[0]?.snapshot).toBeDefined();
  });

  it("keeps frame origin explicit", () => {
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, origin: "https://top.example", accessible: true, snapshot: mkSnapshot("top", 1) },
      { frameId: 5, parentFrameId: 0, origin: "https://child.example", accessible: true, snapshot: mkSnapshot("child", 1) },
    ]);
    expect(ctx.frames[0]?.origin).toBe("https://top.example");
    expect(ctx.frames[1]?.origin).toBe("https://child.example");
    expect(ctx.frames[1]?.snapshot?.page.origin).toBe("https://child.example");
  });

  it("dedups by frameId and bounds frame count", () => {
    const inputs = Array.from({ length: 20 }, (_, i) => ({
      frameId: i,
      parentFrameId: i === 0 ? -1 : 0,
      accessible: true,
      snapshot: mkSnapshot(`f${i}`, 1),
    }));
    // duplicate of frame 0
    inputs.push({ frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("dup", 1) });
    const ctx = buildPageContext(0, inputs);
    expect(ctx.frames.filter((f) => f.frameId === 0)).toHaveLength(1);
    expect(ctx.frames.length).toBeLessThanOrEqual(MAX_FRAMES);
  });

  it("always starts fresh: stale frame data is not reused", () => {
    const one = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("old", 1) },
    ]);
    const two = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("new", 1) },
    ]);
    expect(one.frames[0]?.snapshot?.snapshotId).toBe("old");
    expect(two.frames[0]?.snapshot?.snapshotId).toBe("new");
  });
});

describe("boundContext", () => {
  it("caps total elements across frames", () => {
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("top", 50) },
      { frameId: 1, parentFrameId: 0, accessible: true, snapshot: mkSnapshot("child", 50) },
    ]);
    const bounded = boundContext(ctx, 60, 10000);
    const total = bounded.frames.reduce((n, f) => n + (f.snapshot?.elements.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(60);
  });

  it("is deterministic", () => {
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("top", 30) },
    ]);
    const a = boundContext(ctx, 20, 2000).frames[0]?.snapshot;
    const b = boundContext(ctx, 20, 2000).frames[0]?.snapshot;
    expect(a).toEqual(b);
  });
});
