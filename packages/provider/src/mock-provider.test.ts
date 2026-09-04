import { describe, it, expect } from "vitest";
import { MockProvider } from "./mock-provider";
import type { AssistModelRequest } from "./types";

const base: AssistModelRequest = {
  mode: "DOM_ONLY",
  question: "I don't know what to do here.",
  systemPrompt: "You are a test.",
  session: { schemaVersion: 1, sessionId: "s-test", turns: [] },
  context: {
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
          snapshotId: "snap-1",
          page: { url: "https://example.com/login", origin: "https://example.com", title: "Sign in" },
          elements: [],
        },
      },
    ],
  },
};

describe("MockProvider", () => {
  it("returns deterministic structured JSON", async () => {
    const p = new MockProvider();
    const res = await p.assist(base);
    expect(res.provider).toBe("mock");
    expect(JSON.parse(res.raw)).toMatchObject({ kind: expect.stringMatching(/explain|ask_user|cannot_help/) });
  });

  it("presses the first button when present (top frame)", async () => {
    const p = new MockProvider();
    const req: AssistModelRequest = {
      ...base,
      context: {
        ...base.context,
        frames: [
          {
            frameId: 0,
            parentFrameId: -1,
            origin: "https://example.com",
            accessible: true,
            snapshot: {
              ...base.context.frames[0]!.snapshot!,
              elements: [
                { id: "el-0", tag: "button", role: "button", accessibleName: "Sign in", interactive: true },
              ],
            },
          },
        ],
      },
    };
    const res = await p.assist(req);
    const decision = JSON.parse(res.raw) as { kind: string; message: string };
    expect(decision.kind).toBe("explain");
    expect(decision.message).toContain("Sign in");
  });

  it("finds a button in a child frame without merging it into the top frame", async () => {
    const p = new MockProvider();
    const req: AssistModelRequest = {
      ...base,
      context: {
        schemaVersion: 1,
        topFrameId: 0,
        frames: [
          {
            frameId: 0,
            parentFrameId: -1,
            origin: "https://example.com",
            accessible: true,
            snapshot: {
              ...base.context.frames[0]!.snapshot!,
              elements: [],
            },
          },
          {
            frameId: 2,
            parentFrameId: 0,
            origin: "https://pay.example.com",
            accessible: true,
            snapshot: {
              ...base.context.frames[0]!.snapshot!,
              snapshotId: "child",
              elements: [
                { id: "el-0", tag: "button", role: "button", accessibleName: "Pay", interactive: true },
              ],
            },
          },
        ],
      },
    };
    const res = await p.assist(req);
    const decision = JSON.parse(res.raw) as { kind: string; message: string };
    expect(decision.message).toContain("Pay");
  });

  it("does not request a password if only a password field is present", async () => {
    const p = new MockProvider();
    const req: AssistModelRequest = {
      ...base,
      context: {
        ...base.context,
        frames: [
          {
            frameId: 0,
            parentFrameId: -1,
            origin: "https://example.com",
            accessible: true,
            snapshot: {
              ...base.context.frames[0]!.snapshot!,
              elements: [
                { id: "el-0", tag: "input", role: "textbox", accessibleName: "Password", interactive: true },
              ],
            },
          },
        ],
      },
    };
    const res = await p.assist(req);
    const decision = JSON.parse(res.raw) as { kind: string; message: string };
    expect(decision.message.toLowerCase()).not.toContain("tell me your password");
  });

  it("acknowledges previous conversation context deterministically", async () => {
    const p = new MockProvider();
    const req: AssistModelRequest = {
      ...base,
      session: {
        schemaVersion: 1,
        sessionId: "s-ctx",
        turns: [
          { role: "user", text: "Quiero un correo de GitHub.", timestamp: 1 },
          { role: "assistant", text: "Estás en Gmail. Pulsa “Recibidos”.", timestamp: 2 },
        ],
      },
      context: {
        ...base.context,
        frames: [
          {
            frameId: 0,
            parentFrameId: -1,
            origin: "https://example.com",
            accessible: true,
            snapshot: {
              ...base.context.frames[0]!.snapshot!,
              elements: [
                { id: "el-0", tag: "button", role: "button", accessibleName: "Recibidos", interactive: true },
              ],
            },
          },
        ],
      },
    };
    const res = await p.assist(req);
    const decision = JSON.parse(res.raw) as { kind: string; message: string };
    expect(decision.message).toContain("Sigamos.");
    expect(decision.message).toContain("Recibidos");
  });
});
