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
} from "./index";

const validSnapshot = {
  schemaVersion: 1,
  snapshotId: "snap-1",
  page: { url: "https://example.com", origin: "https://example.com", title: "Sign in" },
  elements: [{ id: "el-0", tag: "button", role: "button", accessibleName: "Sign in", interactive: true }],
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
      protocolVersion: 2,
      mode: "DOM_ONLY",
      question: "What do I do?",
      snapshot: validSnapshot,
      session: emptySession,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a request missing the session field", () => {
    const r = AssistRequestSchema.safeParse({
      protocolVersion: 2,
      mode: "DOM_ONLY",
      question: "What do I do?",
      snapshot: validSnapshot,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const r = AssistRequestSchema.safeParse({
      protocolVersion: 2,
      mode: "DOM_ONLY",
      question: "What do I do?",
      snapshot: validSnapshot,
      session: emptySession,
      unexpected: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a bad mode", () => {
    const r = AssistRequestSchema.safeParse({
      protocolVersion: 2,
      mode: "AUTOPILOT",
      question: "x",
      snapshot: validSnapshot,
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

describe("GuidanceActionSchema", () => {
  it("rejects unknown verbs", () => {
    expect(GuidanceActionSchema.safeParse({ vocabularyVersion: 1, verb: "kill" }).success).toBe(false);
  });
  it("accepts a known verb", () => {
    expect(GuidanceActionSchema.safeParse({ vocabularyVersion: 1, verb: "press" }).success).toBe(true);
  });
});
