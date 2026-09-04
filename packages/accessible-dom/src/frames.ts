/**
 * Frame-aware page-context assembly.
 *
 * A tab may contain many documents (a top-level frame plus iframes). Each frame
 * is treated as an independent, sanitized document context. This module is
 * chrome-free and pure so it can be unit-tested: the extension collects raw
 * per-frame snapshots and delegates the deterministic assembly here.
 *
 * Guarantees:
 * - the top-level frame is always distinguishable (`topFrameId`);
 * - an unavailable frame is represented explicitly, never as an empty snapshot;
 * - frames are never merged: an iframe's content never appears inside its
 *   parent frame's snapshot;
 * - the total context is bounded (frame count + element + character budgets).
 */
import type { AccessibleDOMSnapshot, FrameSnapshot, PageContext } from "@guided-web/protocol";

export interface FrameInput {
  frameId: number;
  parentFrameId?: number;
  origin?: string;
  /** Whether a sanitized snapshot was produced for this frame. */
  accessible: boolean;
  snapshot?: AccessibleDOMSnapshot;
  unavailableReason?: string;
}

export const MAX_FRAMES = 8;
export const MAX_TOTAL_CONTEXT_ELEMENTS = 220;
export const MAX_TOTAL_CONTEXT_CHARACTERS = 16000;

/** Normalize + bound a set of raw frame inputs into a versioned PageContext. */
export function buildPageContext(topFrameId: number, inputs: FrameInput[]): PageContext {
  const byId = new Map<number, FrameInput>();
  for (const input of inputs) {
    if (!byId.has(input.frameId)) byId.set(input.frameId, input);
  }

  const ordered: FrameInput[] = [];
  const top = byId.get(topFrameId);
  if (top) {
    ordered.push(top);
    byId.delete(topFrameId);
  }
  for (const input of inputs) {
    if (byId.has(input.frameId)) ordered.push(input);
  }

  const frames: FrameSnapshot[] = ordered.slice(0, MAX_FRAMES).map((i) => {
    const f: FrameSnapshot = {
      frameId: i.frameId,
      accessible: i.accessible,
    };
    if (i.parentFrameId !== undefined) f.parentFrameId = i.parentFrameId;
    if (i.origin) f.origin = i.origin;
    if (i.snapshot) f.snapshot = i.snapshot;
    if (i.unavailableReason) f.unavailableReason = i.unavailableReason;
    return f;
  });

  const resolvedTop = top ? topFrameId : frames[0]?.frameId ?? 0;
  const context: PageContext = { schemaVersion: 1, topFrameId: resolvedTop, frames };
  return boundContext(context);
}

/**
 * Deterministically enforce the total context budget across all frames.
 *
 * The top frame is kept first; lower-priority frames are trimmed first when
 * total elements or characters must shrink. Within a frame, its own per-snapshot
 * budgets already applied. This keeps the total payload bounded no matter how
 * many frames exist.
 */
export function boundContext(
  context: PageContext,
  maxTotalElements = MAX_TOTAL_CONTEXT_ELEMENTS,
  maxTotalCharacters = MAX_TOTAL_CONTEXT_CHARACTERS,
): PageContext {
  const frames = context.frames.map((frame) => {
    if (!frame.snapshot) return frame;
    const snapshot = { ...frame.snapshot, elements: [...frame.snapshot.elements] };
    return { ...frame, snapshot };
  });

  let usedElements = 0;
  let usedChars = 0;

  const boundedFrames = frames.map((frame) => {
    if (!frame.snapshot) return frame;
    let chars = 0;
    const elements = [];
    let keptInFrame = 0;
    for (const el of frame.snapshot.elements) {
      const cost =
        (el.accessibleName?.length ?? 0) + el.tag.length + (el.role?.length ?? 0) + 8;
      if (usedElements + keptInFrame + 1 > maxTotalElements) break;
      if (usedChars + chars + cost > maxTotalCharacters && (elements.length > 0 || keptInFrame > 0)) {
        break;
      }
      elements.push(el);
      chars += cost;
      keptInFrame += 1;
    }
    usedElements += keptInFrame;
    usedChars += chars;
    return { ...frame, snapshot: { ...frame.snapshot, elements } };
  });

  return { ...context, frames: boundedFrames };
}
