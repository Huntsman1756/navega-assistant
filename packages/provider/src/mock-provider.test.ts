import { describe, it, expect } from "vitest";
import { MockProvider } from "./mock-provider";
import type { AssistModelRequest } from "./types";

const base: AssistModelRequest = {
  mode: "DOM_ONLY",
  question: "I don't know what to do here.",
  systemPrompt: "You are a test.",
  snapshot: {
    schemaVersion: 1,
    snapshotId: "snap-1",
    page: { url: "https://example.com/login", origin: "https://example.com", title: "Sign in" },
    elements: [],
  },
};

describe("MockProvider", () => {
  it("returns deterministic structured JSON", async () => {
    const p = new MockProvider();
    const res = await p.assist(base);
    expect(res.provider).toBe("mock");
    expect(JSON.parse(res.raw)).toMatchObject({ kind: expect.stringMatching(/explain|ask_user|cannot_help/) });
  });

  it("presses the first button when present", async () => {
    const p = new MockProvider();
    const req: AssistModelRequest = {
      ...base,
      snapshot: {
        ...base.snapshot,
        elements: [
          { id: "el-0", tag: "button", role: "button", accessibleName: "Sign in", interactive: true },
        ],
      },
    };
    const res = await p.assist(req);
    const decision = JSON.parse(res.raw) as { kind: string; message: string };
    expect(decision.kind).toBe("explain");
    expect(decision.message).toContain("Sign in");
  });

  it("does not request a password if only a password field is present", async () => {
    const p = new MockProvider();
    const req: AssistModelRequest = {
      ...base,
      snapshot: {
        ...base.snapshot,
        elements: [
          { id: "el-0", tag: "input", role: "textbox", accessibleName: "Password", interactive: true },
        ],
      },
    };
    const res = await p.assist(req);
    const decision = JSON.parse(res.raw) as { kind: string; message: string };
    expect(decision.message.toLowerCase()).not.toContain("tell me your password");
  });
});
