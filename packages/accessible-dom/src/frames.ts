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

/** Exact JSON UTF-16 code-unit costs (not tokens or UTF-8 bytes). */
export function estimateElementCost(el: AccessibleElement): number { return JSON.stringify(el).length + 1; }
export function estimateVisibleTextCost(text: string): number { return JSON.stringify(text).length + 1; }
export function estimateFrameCost(frame: FrameSnapshot): number {
  return JSON.stringify({ ...frame, snapshot: frame.snapshot ? { ...frame.snapshot, elements: [], visibleText: [] } : undefined }).length;
}

export function reducedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch { return ''; }
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

/** Exact serialized PageContext budget, including metadata, escaping and truncation flag.
 * Controls are admitted before prose, deterministically. Capture work has separate limits.
 */
export function boundContext(context: PageContext, maxTotalElements = MAX_TOTAL_CONTEXT_ELEMENTS, maxTotalCharacters = MAX_TOTAL_CONTEXT_CHARACTERS): PageContext {
  if (maxTotalCharacters < 100) throw new Error("context budget too small");
  const source = context.frames.slice(0, MAX_FRAMES);
  const out: PageContext = { schemaVersion: 1, topFrameId: context.topFrameId, frames: [], truncated: true };
  const fits = () => JSON.stringify(out).length <= maxTotalCharacters - 1;
  for (const f of source) {
    const snapshot = f.snapshot;
    const next: FrameSnapshot = {
      frameId: f.frameId, parentFrameId: f.parentFrameId, accessible: f.accessible,
      origin: f.origin?.slice(0, 1000), unavailableReason: f.unavailableReason?.slice(0, 100),
      snapshot: snapshot ? {
        schemaVersion: 1, snapshotId: snapshot.snapshotId.slice(0, 64),
        page: { url: reducedUrl(snapshot.page.url), origin: snapshot.page.origin.slice(0, 1000), title: snapshot.page.title.slice(0, 300) },
        elements: [], visibleText: [], truncated: snapshot.truncated,
      } : undefined,
    };
    out.frames.push(next);
    if (!fits()) { out.frames.pop(); break; }
  }
  let count = 0;
  for (let i = 0; i < out.frames.length; i++) {
    const dst = out.frames[i]?.snapshot;
    if (!dst) continue;
    for (const el of source[i]?.snapshot?.elements.slice(0, 200) ?? []) {
      if (count >= Math.min(maxTotalElements, MAX_TOTAL_CONTEXT_ELEMENTS)) break;
      const bounded = { ...el, id: el.id.slice(0, 64), tag: el.tag.slice(0, 64), role: el.role?.slice(0, 64), accessibleName: el.accessibleName?.slice(0, 160) };
      dst.elements.push(bounded);
      if (!fits()) { dst.elements.pop(); break; }
      count++;
    }
  }
  for (let i = 0; i < out.frames.length; i++) {
    const dst = out.frames[i]?.snapshot;
    if (!dst) continue;
    for (const text of source[i]?.snapshot?.visibleText?.slice(0, 40) ?? []) {
      if (text.length > 300) continue;
      dst.visibleText!.push(text);
      if (!fits()) { dst.visibleText!.pop(); break; }
    }
  }
  // Compare content, not property order; conservative true also records metadata reduction.
  out.truncated = context.truncated === true || source.length !== context.frames.length ||
    out.frames.length !== source.length || out.frames.some((f, i) => {
      const a = f.snapshot, b = source[i]?.snapshot;
      return a && b && (a.truncated || a.elements.length !== b.elements.length ||
        a.visibleText?.length !== (b.visibleText?.length ?? 0) || a.page.title !== b.page.title || a.page.url !== b.page.url);
    });
  return out;
}
