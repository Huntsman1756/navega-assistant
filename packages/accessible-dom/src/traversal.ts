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
export const MAX_CAPTURE_NODES = 10000;

export function* iterElements(root: Document | ShadowRoot | Element): Generator<Element> {
  // Native sibling traversal avoids allocating querySelectorAll over an unbounded DOM.
  const stack: Element[] = [];
  let current: Element | null = root instanceof Element ? root : root.firstElementChild;
  let visited = 0;
  while (current) {
    if (++visited > MAX_CAPTURE_NODES) throw new Error("capture work budget exceeded");
    yield current;
    if (current.nextElementSibling && current !== root) stack.push(current.nextElementSibling);
    if (current.shadowRoot?.firstElementChild) {
      if (current.firstElementChild) stack.push(current.firstElementChild);
      current = current.shadowRoot.firstElementChild;
    } else current = current.firstElementChild ?? stack.pop() ?? null;
  }
}

/** Bounded ordinary + open-shadow host ancestry, including self. */
export function ancestorContext(el: Element): { isInNavigation: boolean; isInDialog: boolean } {
  let isInNavigation = false, isInDialog = false;
  let current: Element | null = el;
  for (let depth = 0; current && depth < 64; depth++) {
    const role = current.getAttribute("role");
    isInNavigation ||= current.localName === "nav" || role === "navigation";
    isInDialog ||= current.localName === "dialog" || role === "dialog" || role === "alertdialog" || current.getAttribute("aria-modal") === "true";
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return { isInNavigation, isInDialog };
}

/** Convenience wrapper returning all traversed elements in order. */
export function collectElements(root: Document | ShadowRoot | Element): Element[] {
  return Array.from(iterElements(root));
}
