import { describe, it, expect } from "vitest";
import {
  P0AssistantDecisionSchema,
  AccessibleDOMSnapshotSchema,
  AssistRequestSchema,
  AssistResponseSchema,
  ContextModeSchema,
  GuidanceActionSchema,
  HelpSessionSchema,
  HelpTurnSchema,
  FrameSnapshotSchema,
  PageContextSchema,
  MAX_TOTAL_CONTEXT_ELEMENTS,
} from "./index";

const validSnapshot = {
  schemaVersion: 1,
  snapshotId: "snap-1",
  page: { url: "https://example.com", origin: "https://example.com", title: "Sign in" },
  elements: [{ id: "el-0", tag: "button", role: "button", accessibleName: "Sign in", interactive: true }],
};

const validContext = {
  schemaVersion: 1,
  topFrameId: 0,
  frames: [
    {
      frameId: 0,
      parentFrameId: -1,
      origin: "https://example.com",
      accessible: true,
      snapshot: validSnapshot,
    },
  ],
};

describe("P0AssistantDecisionSchema", () => {
  it("accepts a valid explain decision", () => {
    const r = P0AssistantDecisionSchema.safeParse({ kind: "explain", message: "Press Next." });
    expect(r.success).toBe(true);
  });

  it("rejects unknown kinds", () => {
    const r = P0AssistantDecisionSchema.safeParse({ kind: "explainz", message: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    const r = P0AssistantDecisionSchema.safeParse({ kind: "explain", message: "x", extra: true });
    expect(r.success).toBe(false);
  });

  it("requires reason on cannot_help", () => {
    const r = P0AssistantDecisionSchema.safeParse({ kind: "cannot_help", message: "x" });
    expect(r.success).toBe(false);
  });
});

describe("AccessibleDOMSnapshotSchema", () => {
  it("accepts a valid snapshot", () => {
    expect(AccessibleDOMSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it("rejects a password value field (not in schema)", () => {
    const bad = { ...validSnapshot, elements: [{ id: "el-0", tag: "input", role: "textbox", value: "secret" }] };
    expect(AccessibleDOMSnapshotSchema.safeParse(bad).success).toBe(false);
  });
});

describe("FrameSnapshotSchema", () => {
  it("accepts an accessible frame with a snapshot", () => {
    expect(FrameSnapshotSchema.safeParse(validContext.frames[0]).success).toBe(true);
  });

  it("accepts an inaccessible frame with a reason and no snapshot", () => {
    const frame = { frameId: 5, parentFrameId: 0, accessible: false, unavailableReason: "cross_origin_unavailable" };
    expect(FrameSnapshotSchema.safeParse(frame).success).toBe(true);
  });

  it("rejects unknown fields (strict)", () => {
    expect(FrameSnapshotSchema.safeParse({ frameId: 0, accessible: true, extra: 1 }).success).toBe(false);
  });
});

describe("PageContextSchema", () => {
  it("accepts a valid page context", () => {
    expect(PageContextSchema.safeParse(validContext).success).toBe(true);
  });

  it("rejects an accessible frame that carries no snapshot", () => {
    const bad = {
      schemaVersion: 1,
      topFrameId: 0,
      frames: [{ frameId: 5, accessible: true }],
    };
    expect(PageContextSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(PageContextSchema.safeParse({ ...validContext, extra: true }).success).toBe(false);
  });
});

describe("HelpTurnSchema", () => {
  it("accepts a valid user turn", () => {
    expect(HelpTurnSchema.safeParse({ role: "user", text: "hola", timestamp: 1 }).success).toBe(true);
  });
  it("rejects unknown roles", () => {
    expect(HelpTurnSchema.safeParse({ role: "system", text: "hola", timestamp: 1 }).success).toBe(false);
  });
  it("rejects unknown fields", () => {
    expect(HelpTurnSchema.safeParse({ role: "user", text: "hola", timestamp: 1, snapshot: {} }).success).toBe(false);
  });
});

describe("HelpSessionSchema", () => {
  it("accepts a valid session with empty turns", () => {
    expect(HelpSessionSchema.safeParse({ schemaVersion: 1, sessionId: "s1", turns: [] }).success).toBe(true);
  });
  it("rejects a session that tries to carry a snapshot", () => {
    const r = HelpSessionSchema.safeParse({ schemaVersion: 1, sessionId: "s1", turns: [], snapshot: {} });
    expect(r.success).toBe(false);
  });
});

describe("AssistRequestSchema", () => {
  const emptySession = { schemaVersion: 1, sessionId: "s1", turns: [] };

  it("accepts a valid request with a session", () => {
    const r = AssistRequestSchema.safeParse({
      protocolVersion: 3,
      mode: "DOM_ONLY",
      question: "What do I do?",
      context: validContext,
      session: emptySession,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a request missing the session field", () => {
    const r = AssistRequestSchema.safeParse({
      protocolVersion: 3,
      mode: "DOM_ONLY",
      question: "What do I do?",
      context: validContext,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const r = AssistRequestSchema.safeParse({
      protocolVersion: 3,
      mode: "DOM_ONLY",
      question: "What do I do?",
      context: validContext,
      session: emptySession,
      unexpected: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a bad mode", () => {
    const r = AssistRequestSchema.safeParse({
      protocolVersion: 3,
      mode: "AUTOPILOT",
      question: "x",
      context: validContext,
      session: emptySession,
    });
    expect(r.success).toBe(false);
  });
});

describe("ContextModeSchema", () => {
  it("allows DOM_ONLY and DOM_PLUS_VISION", () => {
    expect(ContextModeSchema.safeParse("DOM_ONLY").success).toBe(true);
    expect(ContextModeSchema.safeParse("DOM_PLUS_VISION").success).toBe(true);
  });
});

describe("PageContextSchema element boundary (219/220/221)", () => {
  // Minimal element to keep JSON within budget while testing element counts.
  function mkEl(i: number) {
    return { id: String(i), tag: "b", interactive: true };
  }

  function buildContext(elementsPerFrame: number, numFrames: number) {
    const frames = Array.from({ length: numFrames }, (_, fi) => ({
      frameId: fi,
      parentFrameId: fi === 0 ? -1 : 0,
      origin: "https://f.example",
      accessible: true,
      snapshot: {
        schemaVersion: 1,
        snapshotId: "s",
        page: { url: "https://f.example", origin: "https://f.example", title: "T" },
        elements: Array.from({ length: elementsPerFrame }, (_, i) => mkEl(i)),
      },
    }));
    return { schemaVersion: 1, topFrameId: 0, frames };
  }

  it("219 elements across frames → ACCEPT", () => {
    // 110 + 109 = 219 (per-frame max 200 satisfied)
    const frame0 = { frameId: 0, parentFrameId: -1, origin: "https://f.example", accessible: true,
      snapshot: { schemaVersion: 1, snapshotId: "s", page: { url: "https://f.example", origin: "https://f.example", title: "T" }, elements: Array.from({ length: 110 }, (_, i) => mkEl(i)) } };
    const frame1 = { frameId: 1, parentFrameId: 0, origin: "https://f.example", accessible: true,
      snapshot: { schemaVersion: 1, snapshotId: "s", page: { url: "https://f.example", origin: "https://f.example", title: "T" }, elements: Array.from({ length: 109 }, (_, i) => mkEl(i)) } };
    const ctx = { schemaVersion: 1, topFrameId: 0, frames: [frame0, frame1] };
    const totalEls = ctx.frames.reduce((n, f) => n + f.snapshot.elements.length, 0);
    expect(totalEls).toBe(219);
    const r = PageContextSchema.safeParse(ctx);
    expect(r.success).toBe(true);
  });

  it("220 elements across frames → ACCEPT", () => {
    // 110 + 110 = 220
    const ctx = buildContext(110, 2);
    const totalEls = ctx.frames.reduce((n, f) => n + f.snapshot.elements.length, 0);
    expect(totalEls).toBe(220);
    const r = PageContextSchema.safeParse(ctx);
    expect(r.success).toBe(true);
  });

  it("221 elements across frames → REJECT", () => {
    // 111 + 110 = 221
    const frames = [
      { frameId: 0, parentFrameId: -1, origin: "https://f.example", accessible: true,
        snapshot: { schemaVersion: 1, snapshotId: "s", page: { url: "https://f.example", origin: "https://f.example", title: "T" }, elements: Array.from({ length: 111 }, (_, i) => mkEl(i)) } },
      { frameId: 1, parentFrameId: 0, origin: "https://f.example", accessible: true,
        snapshot: { schemaVersion: 1, snapshotId: "s", page: { url: "https://f.example", origin: "https://f.example", title: "T" }, elements: Array.from({ length: 110 }, (_, i) => mkEl(i + 111)) } },
    ];
    const ctx = { schemaVersion: 1, topFrameId: 0, frames };
    const r = PageContextSchema.safeParse(ctx);
    expect(r.success).toBe(false);
  });

  it("220 elements split across multiple frames → ACCEPT", () => {
    const r = PageContextSchema.safeParse(buildContext(110, 2));
    expect(r.success).toBe(true);
  });

  it("221 elements split across multiple frames → REJECT", () => {
    const frames = [
      { frameId: 0, parentFrameId: -1, origin: "https://f.example", accessible: true,
        snapshot: { schemaVersion: 1, snapshotId: "s", page: { url: "https://f.example", origin: "https://f.example", title: "T" }, elements: Array.from({ length: 111 }, (_, i) => mkEl(i)) } },
      { frameId: 1, parentFrameId: 0, origin: "https://f.example", accessible: true,
        snapshot: { schemaVersion: 1, snapshotId: "s", page: { url: "https://f.example", origin: "https://f.example", title: "T" }, elements: Array.from({ length: 110 }, (_, i) => mkEl(i + 111)) } },
    ];
    const ctx = { schemaVersion: 1, topFrameId: 0, frames };
    const r = PageContextSchema.safeParse(ctx);
    expect(r.success).toBe(false);
  });

  it("serialized context at exactly 16000 chars → ACCEPT", () => {
    const frame = {
      frameId: 0, parentFrameId: -1, origin: "https://f.example", accessible: true,
      snapshot: { schemaVersion: 1, snapshotId: "s", page: { url: "https://f.example", origin: "https://f.example", title: "T" }, elements: Array.from({ length: 200 }, (_, i) => mkEl(i)) },
    };
    const ctx = { schemaVersion: 1, topFrameId: 0, frames: [frame] };
    const r = PageContextSchema.safeParse(ctx);
    expect(r.success).toBe(true);
  });
});

describe("GuidanceActionSchema", () => {
  it("rejects unknown verbs", () => {
    expect(GuidanceActionSchema.safeParse({ vocabularyVersion: 1, verb: "kill" }).success).toBe(false);
  });
  it("accepts a known verb", () => {
    expect(GuidanceActionSchema.safeParse({ vocabularyVersion: 1, verb: "press" }).success).toBe(true);
  });
});
