/**
 * Frame-isolated page capture (chrome-free, unit-testable).
 *
 * This replaces the fragile `chrome.scripting.executeScript({target:{tabId,
 * allFrames:true}})` path. Why: with `allFrames:true` a child iframe for which
 * the extension lacks permission can make the whole injection fail, so a single
 * unreachable advertising/tracking frame can prevent capture of the top page
 * and every other accessible frame.
 *
 * Strategy (exact MV3 behavior):
 * - enumerate the tab's frame tree via `chrome.webNavigation.getAllFrames({tabId})`
 *   (main frame id is always 0);
 * - attempt injection SEPARATELY per frame using
 *   `chrome.scripting.executeScript({target:{tabId, frameIds:[frameId]}, files:[...]})`
 *   (explicit `frameIds`, never `allFrames`);
 * - each frame's injection is isolated with `Promise.allSettled`, so one failed
 *   child frame NEVER fails the page;
 * - a frame that did not produce a sanitized snapshot is represented explicitly
 *   as unavailable (`unavailableReason`), never as empty;
 * - the top frame is attempted independently; if IT cannot be accessed the whole
 *   capture rejects with a page-level access failure (surfaced to the per-origin
 *   permission UX by the caller).
 */
import type { AccessibleDOMSnapshot, PageContext } from "@guided-web/protocol";
import { buildPageContext, MAX_FRAMES, type FrameInput } from "@guided-web/accessible-dom";

import { rememberCaptureSecrets } from "./outbound";

export const SNAPSHOT_MESSAGE = "GWA_SNAPSHOT";
export const SNAPSHOT_TIMEOUT_MS = 6000;
export const SNAPSHOT_SETTLE_MS = 250;
export const TOP_FRAME_ID = 0;

export interface EnumeratedFrame {
  frameId: number;
  parentFrameId: number;
  url: string;
}

/** A normalized snapshot event, produced from a raw chrome.runtime message. */
export interface CaptureEvent {
  type?: string;
  snapshot?: AccessibleDOMSnapshot;
  sensitiveValues?: string[];
  captureToken?: string;
  senderTabId?: number;
  senderFrameId?: number;
  senderOrigin?: string;
  senderUrl?: string;
}

/** Minimal chrome runtime the capture needs; extracted for unit testing. */
export interface CaptureEnvironment {
  tabId: number;
  enumerateFrames(): Promise<EnumeratedFrame[]>;
  /** Mark a per-capture token in a frame (best effort). */
  setCaptureToken(frameId: number, token: string): Promise<void>;
  /** Inject the extractor bundle into a specific frame (throws on failure). */
  injectExtractor(frameId: number): Promise<void>;
  /** Register a message listener; returns an unsubscribe function. */
  onMessage(listener: (msg: CaptureEvent) => void): () => void;
  timeoutMs?: number;
  settleMs?: number;
}

function makeToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `gwa-${c.randomUUID()}`;
  return `gwa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export async function capturePageContext(env: CaptureEnvironment): Promise<PageContext> {
  const token = makeToken();
  const timeoutMs = env.timeoutMs ?? SNAPSHOT_TIMEOUT_MS;
  const settleMs = env.settleMs ?? SNAPSHOT_SETTLE_MS;
  const tabId = env.tabId;

  let enumerated: EnumeratedFrame[] = [];
  try {
    enumerated = (await env.enumerateFrames()) ?? [];
  } catch {
    enumerated = [];
  }

  // If enumeration is unavailable (e.g. `getAllFrames` rejects) we still know
  // the main frame is id 0, so we attempt it explicitly rather than falling
  // back to `allFrames:true`. Child frames simply become unavailable.
  if (enumerated.length === 0) {
    enumerated = [{ frameId: TOP_FRAME_ID, parentFrameId: -1, url: "" }];
  }

  const omittedFrames = enumerated.length > MAX_FRAMES;
  enumerated = [...enumerated.filter(f => f.frameId === TOP_FRAME_ID), ...enumerated.filter(f => f.frameId !== TOP_FRAME_ID)].slice(0, MAX_FRAMES);

  const sensitiveValues = new Set<string>();
  let captureFailed = false;
  const collected = new Map<number, { frameId: number; origin: string; snapshot: AccessibleDOMSnapshot }>();
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<PageContext>((resolve, reject) => {
    let settled = false;

    const unsubscribe = env.onMessage((msg) => {
      // FIX C: correlate the message to the captured tab and capture token so a
      // late result from another tab, another window, a concurrent capture or an
      // unrelated extension message can never populate this PageContext.
      if (msg.senderTabId !== tabId) return;
      if (msg.captureToken !== token) return;
      if (msg.type === "GWA_CAPTURE_FAILED") { captureFailed = true; return; }
      if (msg.type !== SNAPSHOT_MESSAGE || !msg.snapshot) return;
      const frameId = msg.senderFrameId ?? TOP_FRAME_ID;
      if (settled || !enumerated.some(f => f.frameId === frameId)) return;
      const origin = msg.senderOrigin || originOf(msg.senderUrl ?? "") || "";
      for (const value of msg.sensitiveValues ?? []) sensitiveValues.add(value);
      collected.set(frameId, { frameId, origin, snapshot: msg.snapshot });
    });

    const close = () => {
      if (settleTimer) clearTimeout(settleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      unsubscribe();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      close();

      const inputs: FrameInput[] = enumerated.map((frame) => {
        const got = collected.get(frame.frameId);
        if (got) {
          return {
            frameId: frame.frameId,
            parentFrameId: frame.parentFrameId,
            origin: got.origin,
            accessible: true,
            snapshot: got.snapshot,
          };
        }
        return {
          frameId: frame.frameId,
          parentFrameId: frame.parentFrameId,
          origin: originOf(frame.url),
          accessible: false,
          unavailableReason: "cross_origin_unavailable",
        };
      });

      if (inputs.length === 0) {
        reject(new Error("no frame data captured"));
        return;
      }

      const topFrameId = enumerated.find((f) => f.parentFrameId === -1)?.frameId ?? TOP_FRAME_ID;
      const top = inputs.find((i) => i.frameId === topFrameId) ?? inputs[0];
      if (captureFailed || !top?.accessible) {
        // The top page itself cannot be read: surface the access failure so the
        // caller triggers the per-origin permission UX. Child frames never cause
        // this rejection.
        reject(new Error("top frame unavailable"));
        return;
      }

      const context = buildPageContext(topFrameId, inputs);
      if (omittedFrames) context.truncated = true;
      rememberCaptureSecrets(context, [...sensitiveValues]);
      resolve(context);
    };

    const start = Date.now();
    void (async () => {
      // Inject into each frame independently. `allSettled` guarantees a failure
      // on one child frame cannot fail the page or any other accessible frame.
      await Promise.allSettled(
        enumerated.map(async (frame) => {
          try {
            await env.setCaptureToken(frame.frameId, token);
          } catch {
            // Best effort; a missing token only means this frame cannot be
            // correlated and is therefore marked unavailable.
          }
          if (!settled) await env.injectExtractor(frame.frameId);
        }),
      );
      const elapsed = Date.now() - start;
      const wait = Math.max(0, settleMs - elapsed);
      settleTimer = setTimeout(finish, wait);
    })();

    timeoutTimer = setTimeout(finish, timeoutMs);
  });
}
