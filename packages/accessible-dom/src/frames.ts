/**
 * Frame-aware page-context assembly.
 *
 * A tab may contain many documents (a top-level frame plus iframes). Each frame
 * is treated as an independent, sanitized document context. This module is
 * chrome-free and pure so it can be unit-tested: the extension collects raw
 * per-frame snapshots and delegates the deterministic assembly here.
 *
 * Guarantees:
 * - the top-level frame is always distinguishable (`topFrameId`) and always
 *   first;
 * - an unavailable frame is represented explicitly, never as an empty snapshot;
 * - frames are never merged: an iframe's content never appears inside its
 *   parent frame's snapshot;
 * - frames are tried with an explicit priority: TOP frame, then ACCESSIBLE
 *   child frames, then UNAVAILABLE child frames (stable within each class),
 *   so an inaccessible advertising iframe cannot crowd out a useful accessible
 *   child frame;
 * - the total context is bounded by a real global serialized-character budget
 *   that accounts for frame metadata, elements, accessible names,
 *   roles/tags/states AND visible text (not just a per-element guess).
 */
import type { AccessibleDOMSnapshot, AccessibleElement, FrameSnapshot, PageContext } from "@guided-web/protocol";

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

/** Serialized-cost constants; deliberately approximate but conservative. */
const ELEMENT_OVERHEAD = 100;
const ELEMENT_STATE_OVERHEAD = 80;
const VISIBLE_TEXT_OVERHEAD = 24;
const FRAME_OVERHEAD = 90;
const PAGE_META_OVERHEAD = 60;
const SNAPSHOT_WRAPPER_OVERHEAD = 200;

/** Approximate serialized cost of a single element (over-estimate). */
export function estimateElementCost(el: AccessibleElement): number {
  let cost = ELEMENT_OVERHEAD + el.id.length + el.tag.length;
  if (el.role) cost += el.role.length;
  if (el.accessibleName) cost += el.accessibleName.length;
  if (el.state) cost += ELEMENT_STATE_OVERHEAD;
  return cost;
}

/** Approximate serialized cost of one visible-text entry (over-estimate). */
export function estimateVisibleTextCost(text: string): number {
  return text.length + VISIBLE_TEXT_OVERHEAD;
}

/** Approximate serialized cost of a frame (metadata + page + snapshot wrapper). */
export function estimateFrameCost(frame: FrameSnapshot): number {
  let cost = FRAME_OVERHEAD;
  if (frame.origin) cost += frame.origin.length;
  if (frame.unavailableReason) cost += frame.unavailableReason.length;
  const page = frame.snapshot?.page;
  if (page) {
    cost +=
      (page.url?.length ?? 0) +
      (page.origin?.length ?? 0) +
      (page.title?.length ?? 0) +
      PAGE_META_OVERHEAD;
  }
  if (frame.snapshot) {
    // The snapshot envelope (schemaVersion, snapshotId, elements[]/visibleText[]
    // brackets, per-element arrays) has a fixed cost that is not captured by the
    // per-element/per-text costs added in boundContext.
    cost += SNAPSHOT_WRAPPER_OVERHEAD + frame.snapshot.snapshotId.length;
  }
  return cost;
}

/**
 * Order frames deterministically: TOP first, then ACCESSIBLE child frames
 * (stable source order), then UNAVAILABLE child frames (stable source order).
 * Duplicate frameIds are dropped (first occurrence wins).
 */
export function orderFrames(topFrameId: number, inputs: FrameInput[]): FrameInput[] {
  const byId = new Map<number, FrameInput>();
  for (const input of inputs) {
    if (!byId.has(input.frameId)) byId.set(input.frameId, input);
  }

  const top = byId.get(topFrameId);
  const accessible: FrameInput[] = [];
  const unavailable: FrameInput[] = [];

  for (const input of byId.values()) {
    if (input.frameId === topFrameId) continue;
    (input.accessible ? accessible : unavailable).push(input);
  }

  const ordered: FrameInput[] = [];
  if (top) ordered.push(top);
  ordered.push(...accessible, ...unavailable);
  return ordered;
}

/** Normalize + bound a set of raw frame inputs into a versioned PageContext. */
export function buildPageContext(topFrameId: number, inputs: FrameInput[]): PageContext {
  const ordered = orderFrames(topFrameId, inputs);

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

  const resolvedTop = ordered[0] ? topFrameId : frames[0]?.frameId ?? 0;
  const context: PageContext = { schemaVersion: 1, topFrameId: resolvedTop, frames };
  return boundContext(context);
}

/**
 * Deterministically enforce the total context budget across all frames.
 *
 * Frames are processed in priority order (top first, then accessible,
 * then unavailable). Inside a frame its own per-snapshot budgets were already
 * applied by the extractor. The global budget here reserves each frame's
 * metadata cost, then keeps high-priority ELEMENTS before low-priority
 * VISIBLE TEXT, so large article/notice text can never crowd out a relevant
 * control. Child frames consume the remaining budget.
 *
 * The accounting is an approximate serialized-character cost (not exact token
 * counts) that deliberately over-counts so the real serialized payload stays
 * bounded. It is deterministic for identical input.
 */
export function boundContext(
  context: PageContext,
  maxTotalElements = MAX_TOTAL_CONTEXT_ELEMENTS,
  maxTotalCharacters = MAX_TOTAL_CONTEXT_CHARACTERS,
): PageContext {
  const frames = context.frames.map((frame) => {
    if (!frame.snapshot) return frame;
    return {
      ...frame,
      snapshot: {
        ...frame.snapshot,
        elements: [...frame.snapshot.elements],
        visibleText: [...(frame.snapshot.visibleText ?? [])],
      },
    };
  });

  let usedElements = 0;
  let budget = maxTotalCharacters;

  // First pass: reserve frame metadata (frames are kept even when content is
  // trimmed; an unavailable frame contributes only its metadata).
  const boundedFrames = frames.map((frame) => {
    budget = Math.max(0, budget - estimateFrameCost(frame));
    if (!frame.snapshot) return frame;
    // Snapshot content is filled in the passes below.
    return { ...frame, snapshot: { ...frame.snapshot, elements: [], visibleText: [] } };
  });

  // Phase 1: elements (controls) take priority over visible text, across frames
  // in priority order. Each frame's own elements are already relevance-ranked.
  if (budget > 0) {
    for (let i = 0; i < frames.length; i += 1) {
      const src = frames[i]?.snapshot;
      if (!src) continue;
      const dst = boundedFrames[i]?.snapshot as AccessibleDOMSnapshot | undefined;
      if (!dst) continue;
      const kept: AccessibleElement[] = [];
      for (const el of src.elements) {
        if (usedElements + 1 > maxTotalElements) break;
        const cost = estimateElementCost(el);
        if (cost > budget) break;
        budget -= cost;
        kept.push(el);
        usedElements += 1;
      }
      dst.elements = kept;
    }
  }

  // Phase 2: visible text (strictly lower priority than any control).
  if (budget > 0) {
    for (let i = 0; i < frames.length; i += 1) {
      const src = frames[i]?.snapshot;
      if (!src) continue;
      const dst = boundedFrames[i]?.snapshot as AccessibleDOMSnapshot | undefined;
      if (!dst) continue;
      const kept: string[] = [];
      for (const text of src.visibleText ?? []) {
        const cost = estimateVisibleTextCost(text);
        if (cost > budget) break;
        budget -= cost;
        kept.push(text);
      }
      dst.visibleText = kept;
    }
  }

  return { ...context, frames: boundedFrames };
}
