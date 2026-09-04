/**
 * Root-aware DOM traversal that crosses OPEN shadow roots.
 *
 * This is the single traversal primitive used by the extractor. Unlike a bare
 * `document.querySelectorAll`, it descends into every OPEN ShadowRoot so that
 * interactive controls and labels inside web components are discovered.
 *
 * Security rules:
 * - CLOSED shadow roots are never bypassed. A closed root exposes no
 *   `shadowRoot` reference, so it is simply not traversed and its contents are
 *   marked UNAVAILABLE_TO_DOM. We never wrap `attachShadow`, never read
 *   internal shadow references, and never inject code to force a closed root
 *   open.
 * - The page's DOM/styles are never mutated. This module is strictly read-only.
 */

/**
 * Yield every element under the root in deterministic document order,
 * descending depth-first into the shadows of each host element encountered.
 *
 * Each element is yielded at most once. Open shadow roots are traversed;
 * closed shadow roots (whose `shadowRoot` is null) are naturally ignored.
 */
export function* iterElements(root: Document | ShadowRoot | Element): Generator<Element> {
  const seen = new Set<Element>();

  function* walk(r: Document | ShadowRoot | Element): Generator<Element> {
    const nodes = (r as Document).querySelectorAll("*");
    for (const el of nodes) {
      if (!(el instanceof Element)) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      yield el;
      const open = (el as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (open) yield* walk(open);
    }
  }

  if (root instanceof Element) {
    if (!seen.has(root)) {
      seen.add(root);
      yield root;
    }
    const open = (root as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (open) yield* walk(open);
  }

  yield* walk(root);
}

/** Convenience wrapper returning all traversed elements in order. */
export function collectElements(root: Document | ShadowRoot | Element): Element[] {
  return Array.from(iterElements(root));
}
