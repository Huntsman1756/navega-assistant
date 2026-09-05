// @vitest-environment node
import { describe, it, expect } from "vitest";
import { capturePageContext, type CaptureEnvironment, type CaptureEvent, type EnumeratedFrame } from "./capture";
import type { AccessibleDOMSnapshot } from "@guided-web/protocol";
import { sanitizeOutbound } from "./outbound";

function snapshot(frameName: string): AccessibleDOMSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: `s-${frameName}`,
    page: { url: `https://${frameName}.example/x`, origin: `https://${frameName}.example`, title: frameName },
    elements: [{ id: "el-0", tag: "button", role: "button", accessibleName: `Btn ${frameName}`, interactive: true }],
    visibleText: [],
  };
}

const ENUMERATED: EnumeratedFrame[] = [
  { frameId: 0, parentFrameId: -1, url: "https://top.example/" },
  { frameId: 1, parentFrameId: 0, url: "https://a.example/" },
  { frameId: 2, parentFrameId: 0, url: "https://b.example/" },
  { frameId: 3, parentFrameId: 0, url: "https://c.example/" },
];

interface EnvOptions {
  tabId?: number;
  frames?: EnumeratedFrame[];
  reachable?: number[];
}

function makeEnv(opts: EnvOptions = {}) {
  const tabId = opts.tabId ?? 1;
  const frames = opts.frames ?? ENUMERATED;
  const reachable = opts.reachable ?? frames.map((f) => f.frameId);
  let listener: ((msg: CaptureEvent) => void) | null = null;
  const seenTokens: string[] = [];
  const injected: number[] = [];

  const env: CaptureEnvironment = {
    tabId,
    enumerateFrames: async () => frames,
    setCaptureToken: async (frameId, token) => {
      injected.push(frameId);
      seenTokens.push(token);
    },
    injectExtractor: async (frameId) => {
      if (!reachable.includes(frameId)) {
        throw new Error("Cannot access contents of the page (host permission denied)");
      }
    },
    onMessage: (l) => {
      listener = l;
      return () => {
        if (listener === l) listener = null;
      };
    },
  };

  return {
    env,
    injected,
    seenTokens,
    latestToken: () => seenTokens[seenTokens.length - 1],
    send: (msg: CaptureEvent) => {
      if (msg.captureToken === undefined) msg.captureToken = seenTokens[seenTokens.length - 1];
      listener?.(msg);
    },
  };
}

async function settle(delay = 10): Promise<void> {
  await new Promise((r) => setTimeout(r, delay));
}

describe("frame-isolated capture (Fix A)", () => {
  it("captures the top and accessible child frames and represents an unreachable child as unavailable without failing the page", async () => {
    // top(0) + child A(1) + child B(2, unreachable) + child C(3)
    const w = makeEnv({ reachable: [0, 1, 3] });
    const run = capturePageContext({ ...w.env, settleMs: 60, timeoutMs: 5000 });
    await settle(20);

    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("top"), senderTabId: 1, senderFrameId: 0, senderOrigin: "https://top.example" });
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("a"), senderTabId: 1, senderFrameId: 1, senderOrigin: "https://a.example" });
    // child B (frame 2) is unreachable: no message is produced.
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("c"), senderTabId: 1, senderFrameId: 3, senderOrigin: "https://c.example" });

    const ctx = await run;
    byFrame(ctx, 0, "top");
    byFrame(ctx, 1, "a");
    expect(ctx.frames.find((f) => f.frameId === 2)?.accessible).toBe(false);
    expect(ctx.frames.find((f) => f.frameId === 2)?.unavailableReason).toBe("cross_origin_unavailable");
    byFrame(ctx, 3, "c");
    expect(ctx.topFrameId).toBe(0);
  });

  it("rejects with a page-level access failure when the TOP frame is inaccessible", async () => {
    const w = makeEnv({ reachable: [1, 3] });
    const run = capturePageContext({ ...w.env, settleMs: 60, timeoutMs: 5000 });
    await settle(20);
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("a"), senderTabId: 1, senderFrameId: 1, senderOrigin: "https://a.example" });
    await expect(run).rejects.toThrow("top frame unavailable");
  });

  it("attempts each frame independently (one failed child never fails the others)", async () => {
    const w = makeEnv({ reachable: [0, 1, 2, 3] });
    // Simulate an injection failure for a single frame (frame 2) via the trail;
    // a genuine getElementForFrame failure still leaves 0/1/3 captured.
    w.env.injectExtractor = async (frameId) => {
      w.injected.push(frameId);
      if (frameId === 2) throw new Error("injection failed");
    };
    const run = capturePageContext({ ...w.env, settleMs: 60, timeoutMs: 5000 });
    await settle(20);
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("top"), senderTabId: 1, senderFrameId: 0, senderOrigin: "https://top.example" });
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("a"), senderTabId: 1, senderFrameId: 1, senderOrigin: "https://a.example" });
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("c"), senderTabId: 1, senderFrameId: 3, senderOrigin: "https://c.example" });
    const ctx = await run;
    expect(ctx.frames.map((f) => f.frameId).sort()).toEqual([0, 1, 2, 3]);
    expect(ctx.frames.find((f) => f.frameId === 2)?.accessible).toBe(false);
    // Every frame was attempted independently (top, A, B, C) despite B failing.
    expect([...new Set(w.injected)].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("message correlation (Fix C)", () => {
  it("accepts a message from the captured tab and capture token", async () => {
    const w = makeEnv();
    const run = capturePageContext({ ...w.env, settleMs: 60, timeoutMs: 5000 });
    await settle(20);
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("top"), senderTabId: 1, senderFrameId: 0, senderOrigin: "https://top.example" });
    const ctx = await run;
    expect(ctx.frames[0]?.accessible).toBe(true);
    expect(ctx.frames[0]?.snapshot?.snapshotId).toBe("s-top");
  });

  it("ignores a snapshot from a different tab", async () => {
    const w = makeEnv();
    const run = capturePageContext({ ...w.env, settleMs: 60, timeoutMs: 5000 });
    await settle(20);
    // A stray message from another tab arrives first, then the real one.
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("other"), senderTabId: 999, senderFrameId: 0, senderOrigin: "https://other.example" });
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("top"), senderTabId: 1, senderFrameId: 0, senderOrigin: "https://top.example" });
    const ctx = await run;
    // The same-tab message wins; the different-tab one was ignored.
    expect(ctx.frames[0]?.snapshot?.snapshotId).toBe("s-top");
  });

  it("ignores a malformed snapshot message (no snapshot, wrong type, wrong token)", async () => {
    const w = makeEnv();
    const run = capturePageContext({ ...w.env, settleMs: 60, timeoutMs: 5000 });
    await settle(20);
    w.send({ type: "GWA_SNAPSHOT", senderTabId: 1, senderFrameId: 0 } as CaptureEvent);
    w.send({ type: "GWB_OTHER", snapshot: snapshot("x"), senderTabId: 1, senderFrameId: 0 } as CaptureEvent);
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("y"), senderTabId: 1, senderFrameId: 0, captureToken: "stale-token" });
    // A genuine, valid message must be the one that wins.
    w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("z"), senderTabId: 1, senderFrameId: 0, captureToken: w.latestToken() });
    const ctx = await run;
    expect(ctx.frames[0]?.snapshot?.snapshotId).toBe("s-z");
  });

  it("does not let a late/unrelated message from a previous capture populate the current capture", async () => {
    // First capture has its own token.
    const w1 = makeEnv({ tabId: 1 });
    const run1 = capturePageContext({ ...w1.env, settleMs: 40, timeoutMs: 5000 });
    await settle(10);
    // Second capture on the same tab uses a NEW token.
    const w2 = makeEnv({ tabId: 1 });
    const p1 = capturePageContext({ ...w2.env, settleMs: 60, timeoutMs: 5000 });
    await settle(10);
    // A stale message carrying the FIRST capture's token arrives during the 2nd.
    w2.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("stale"), senderTabId: 1, senderFrameId: 0, captureToken: w1.latestToken() });
    // The fresh message uses the second capture's token.
    w2.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("fresh"), senderTabId: 1, senderFrameId: 0, captureToken: w2.latestToken() });
    await run1.catch(() => {});
    const ctx = await p1;
    expect(ctx.frames[0]?.snapshot?.snapshotId).toBe("s-fresh");
  });
});

function byFrame(ctx: { frames: Array<{ frameId: number; accessible: boolean; snapshot?: { snapshotId: string } }> }, frameId: number, expectedId: string): void {
  const f = ctx.frames.find((fr) => fr.frameId === frameId);
  expect(f?.accessible).toBe(true);
  expect(f?.snapshot?.snapshotId).toBe(`s-${expectedId}`);
}

it("limits frame work initiation, keeping the top first", async () => {
  const w = makeEnv({ frames: Array.from({ length: 1000 }, (_, frameId) => ({ frameId, parentFrameId: frameId === 0 ? -1 : 0, url: "https://top.example" })) });
  const run = capturePageContext({ ...w.env, settleMs: 60 });
  await settle(20);
  w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("top"), senderTabId: 1, senderFrameId: 0 });
  const ctx = await run;
  expect(w.injected).toEqual([0,1,2,3,4,5,6,7]);
  expect(ctx.truncated).toBe(true);
});

it("carries child-frame classified values to the complete outbound boundary without serializing the dictionary", async () => {
  const w = makeEnv();
  const run = capturePageContext({ ...w.env, settleMs: 60 });
  await settle(20);
  w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("top"), senderTabId: 1, senderFrameId: 0, sensitiveValues: [] });
  w.send({ type: "GWA_SNAPSHOT", snapshot: snapshot("child"), senderTabId: 1, senderFrameId: 1, sensitiveValues: ["SECRET_CHILD_X91"] });
  const context = await run;
  expect(JSON.stringify(context).includes("SECRET_CHILD_X91")).toBe(false);
  const payload = sanitizeOutbound(context, "Help SECRET_CHILD_X91", { schemaVersion: 1, sessionId: "s", turns: [] });
  expect(payload.question).toBe("Help ");
  expect(JSON.stringify(payload).includes("SECRET_CHILD_X91")).toBe(false);
});
