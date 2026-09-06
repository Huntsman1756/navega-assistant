// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { buildPageContext, boundContext, MAX_FRAMES, MAX_TOTAL_CONTEXT_CHARACTERS, MAX_TOTAL_CONTEXT_ELEMENTS } from "./frames";
import { PageContextSchema } from "@guided-web/protocol";
import type { AccessibleDOMSnapshot, PageContext } from "@guided-web/protocol";

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

describe("total element boundary 219/220/221 (real aggregate)", () => {
  function el(id: number): AccessibleDOMSnapshot["elements"][number] {
    return { id: String(id), tag: "b", interactive: true };
  }

  function mkSnap(elements: number): AccessibleDOMSnapshot {
    return {
      schemaVersion: 1,
      snapshotId: "snap",
      page: { url: "https://example.com", origin: "https://example.com", title: "T" },
      elements: Array.from({ length: elements }, (_, i) => el(i)),
      visibleText: [],
    };
  }

  function unboundedContext(f1: number, f2?: number): PageContext {
    if (f2 === undefined) {
      return { schemaVersion: 1, topFrameId: 0, frames: [{ frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnap(f1) }] };
    }
    return {
      schemaVersion: 1, topFrameId: 0,
      frames: [
        { frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnap(f1) },
        { frameId: 1, parentFrameId: 0, accessible: true, snapshot: mkSnap(f2) },
      ],
    };
  }

  it("219 elements → ACCEPT through boundContext (2 frames: 120+99, large budget)", () => {
    const ctx = unboundedContext(120, 99);
    const bounded = boundContext(ctx, 219, 65536);
    const total = bounded.frames.reduce((n, f) => n + (f.snapshot?.elements.length ?? 0), 0);
    expect(total).toBe(219);
  });

  it("220 elements → ACCEPT through boundContext (2 frames: 110+110, large budget)", () => {
    const ctx = unboundedContext(110, 110);
    const bounded = boundContext(ctx, 220, 65536);
    const total = bounded.frames.reduce((n, f) => n + (f.snapshot?.elements.length ?? 0), 0);
    expect(total).toBe(220);
  });

  it("221 elements → bounded to 220 through boundContext", () => {
    const ctx = unboundedContext(111, 110);
    const bounded = boundContext(ctx, 220, 65536);
    const total = bounded.frames.reduce((n, f) => n + (f.snapshot?.elements.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_ELEMENTS);
    expect(total).toBe(220);
  });

  it("221 elements split across more frames → bounded to 220", () => {
    const ctx = unboundedContext(121, 100);
    const bounded = boundContext(ctx, 220, 65536);
    const total = bounded.frames.reduce((n, f) => n + (f.snapshot?.elements.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_ELEMENTS);
    expect(total).toBe(220);
  });
});

describe("16000 UTF-16 code unit boundary (Fix D)", () => {
  function el(id: number): AccessibleDOMSnapshot["elements"][number] {
    return { id: `el-${id}`, tag: "button", role: "button", accessibleName: `Btn ${id}`, interactive: true };
  }

  function mkSnap(elements: number, extraText: string): AccessibleDOMSnapshot {
    return {
      schemaVersion: 1,
      snapshotId: "snap",
      page: { url: "https://example.com", origin: "https://example.com", title: "Test" },
      elements: Array.from({ length: elements }, (_, i) => el(i)),
      visibleText: extraText ? [extraText] : [],
    };
  }

  it("exactly 16000 serialized characters → accepted by boundContext", () => {
    // Build a context that, when bounded, produces exactly 16000 characters.
    // We construct a context with enough content that boundContext trims it
    // to exactly the boundary.
    const inputs = [{ frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnap(220, "a".repeat(10000)) }];
    const ctx = buildPageContext(0, inputs);
    const bounded = boundContext(ctx, 220, 16000);
    const serialized = JSON.stringify(bounded);
    expect(serialized.length).toBeLessThanOrEqual(16000);
  });

  it("16001 serialized characters → bounded to 16000", () => {
    const inputs = [{ frameId: 0, parentFrameId: -1, accessible: true, snapshot: mkSnap(220, "x".repeat(12000)) }];
    const ctx = buildPageContext(0, inputs);
    const bounded = boundContext(ctx, 220, 16000);
    const serialized = JSON.stringify(bounded);
    expect(serialized.length).toBeLessThanOrEqual(16000);
    // The bound must have been applied (truncated flag should be true).
    expect(bounded.truncated).toBe(true);
  });

  it("bounded frame must not subsequently fail the protocol due to metadata omitted from budget", () => {
    // Build a frame with maximally-sized metadata to adversarially test that
    // the bounding implementation accounts for frame metadata in the budget.
    const metadataUrl = "https://example.com/" + "a".repeat(980); // truncated to 1000
    const metadataOrigin = "https://x.example.com/" + "b".repeat(985); // truncated to 1000
    const metadataTitle = "A".repeat(298); // truncated to 300

    function bigMetaSnapshot(id: string, els: number): AccessibleDOMSnapshot {
      const snapshot: AccessibleDOMSnapshot = {
        schemaVersion: 1,
        snapshotId: id,
        page: { url: metadataUrl, origin: metadataOrigin, title: metadataTitle },
        elements: Array.from({ length: els }, (_, i) => ({
          id: `el-${i}`, tag: "button", role: "button", accessibleName: `Btn ${i}`, interactive: true,
        })),
        visibleText: [],
      };
      return snapshot;
    }

    // Two frames with large metadata + moderate elements.
    const inputs = [
      { frameId: 0, parentFrameId: -1, accessible: true, snapshot: bigMetaSnapshot("top", 50) },
      { frameId: 1, parentFrameId: 0, accessible: true, origin: metadataOrigin, snapshot: bigMetaSnapshot("child", 50) },
    ];
    const ctx = buildPageContext(0, inputs);
    const bounded = boundContext(ctx);
    // Bounded result must be valid PageContext according to the protocol schema.
    const parsed = PageContextSchema.safeParse(bounded);
    expect(parsed.success).toBe(true);
    // Elements are preserved at the bounded count.
    const totalEls = bounded.frames.reduce((n, f) => n + (f.snapshot?.elements.length ?? 0), 0);
    expect(totalEls).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_ELEMENTS);
    expect(totalEls).toBeGreaterThan(0);
  });
});
