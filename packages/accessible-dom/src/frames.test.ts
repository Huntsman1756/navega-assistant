// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { buildPageContext, boundContext, MAX_FRAMES, MAX_TOTAL_CONTEXT_CHARACTERS } from "./frames";
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

describe("frame priority (Fix D)", () => {
  it("keeps a later accessible child frame ahead of unavailable frames before the frame budget", () => {
    // frame 0 accessible; frames 1..7 unavailable; frame 8 accessible "useful".
    const inputs = [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("top", 1) },
      ...Array.from({ length: 7 }, (_, i) => ({
        frameId: i + 1,
        parentFrameId: 0,
        accessible: false,
        unavailableReason: "cross_origin_unavailable",
      })),
      { frameId: 8, parentFrameId: 0, accessible: true, snapshot: mkSnapshot("useful", 1) },
    ];
    const ctx = buildPageContext(0, inputs);
    expect(ctx.frames.length).toBeLessThanOrEqual(MAX_FRAMES);
    const ids = ctx.frames.map((f) => f.frameId);
    expect(ids[0]).toBe(0);
    // The useful accessible frame (8) survives before the first unavailable one.
    expect(ids).toContain(8);
    const usefulIdx = ids.indexOf(8);
    const firstUnavailable = ctx.frames.findIndex((f) => !f.accessible);
    expect(firstUnavailable).toBeGreaterThan(-1);
    expect(usefulIdx).toBeLessThan(firstUnavailable);
  });

  it("keeps unavailable metadata when the frame budget allows", () => {
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnapshot("top", 1) },
      { frameId: 2, parentFrameId: 0, accessible: false, unavailableReason: "cross_origin_unavailable" },
      { frameId: 1, parentFrameId: 0, accessible: true, snapshot: mkSnapshot("child", 1) },
    ]);
    const ids = ctx.frames.map((f) => f.frameId);
    // Order: top, accessible child (1), unavailable child (2).
    expect(ids).toEqual([0, 1, 2]);
    expect(ctx.frames[2]?.accessible).toBe(false);
    expect(ctx.frames[2]?.unavailableReason).toBe("cross_origin_unavailable");
  });
});

describe("global budget with visibleText (Fix E)", () => {
  function bigSnapshot(id: string, els: number): AccessibleDOMSnapshot {
    const s = mkSnapshot(id, els);
    s.visibleText = Array.from({ length: 60 }, (_, i) => `Noticia detallada número ${i} — ${"contenido ".repeat(12)}`);
    return s;
  }

  it("counts visibleText toward the total serialized budget and trims it", () => {
    const top = bigSnapshot("top", 2);
    const child = mkSnapshot("child", 1);
    child.visibleText = ["a".repeat(60000)];
    const ctx = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: top },
      { frameId: 1, parentFrameId: 0, accessible: true, snapshot: child },
    ]);
    const serialized = JSON.stringify(ctx);
    expect(serialized.length).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARACTERS);
    // The huge child visible text is trimmed away entirely.
    const childFrame = ctx.frames.find((f) => f.frameId === 1)!;
    const huge = childFrame.snapshot?.visibleText?.some((t) => t.includes("aaaa")) ?? false;
    expect(huge).toBe(false);
    // The top frame's interactive controls survive.
    expect(ctx.frames[0]?.snapshot?.elements.length).toBe(2);
    // Deterministic: identical input produces identical output.
    const again = buildPageContext(0, [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: bigSnapshot("top", 2) },
      { frameId: 1, parentFrameId: 0, accessible: true, snapshot: (() => { const s = mkSnapshot("child", 1); s.visibleText = ["a".repeat(60000)]; return s; })() },
    ]);
    expect(JSON.stringify(ctx)).toEqual(JSON.stringify(again));
  });

  it("keeps interactive controls before large article/notice text", () => {
    const top = mkSnapshot("top", 1);
    top.visibleText = Array.from({ length: 120 }, (_, i) => `Párrafo ${i} ` + "palabra ".repeat(40));
    const ctx = buildPageContext(0, [{ frameId: 0, parentFrameId: -1, accessible: true, snapshot: top }]);
    expect(ctx.frames[0]?.snapshot?.elements.length).toBeGreaterThanOrEqual(1);
    const vt = ctx.frames[0]?.snapshot?.visibleText ?? [];
    expect(vt.join(" ").length).toBeLessThan(MAX_TOTAL_CONTEXT_CHARACTERS);
  });

  it("keeps the total multi-frame serialized PageContext below the configured maximum", () => {
    const frames = Array.from({ length: MAX_FRAMES }, (_, i) => ({
      frameId: i,
      parentFrameId: i === 0 ? -1 : 0,
      accessible: true,
      snapshot: bigSnapshot(`f${i}`, 25),
    }));
    const ctx = buildPageContext(0, frames);
    expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARACTERS);
  });
});
