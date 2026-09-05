// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { extractAccessibleDOMSnapshot } from "./extractor";
import { buildPageContext, MAX_TOTAL_CONTEXT_CHARACTERS } from "./frames";
import { ancestorContext, MAX_CAPTURE_NODES } from "./traversal";
it("bounds huge metadata and JSON escape-heavy strings exactly", () => {
  document.body.innerHTML = '<button>Continue</button>';
  const s = extractAccessibleDOMSnapshot(document, { snapshotId: "stable" });
  s.page.title = '\u0000'.repeat(20000);
  s.page.url = 'https://example.com/' + 'x'.repeat(20000) + '?secret=yes#secret';
  s.elements = Array.from({ length: 200 }, (_, i) => ({ id: String(i), tag: 'button', interactive: true, accessibleName: '\u0000'.repeat(160) }));
  const input = Array.from({ length: 30 }, (_, frameId) => ({ frameId, accessible: true, snapshot: s, origin: 'x'.repeat(20000) }));
  const ctx = buildPageContext(0, input);
  expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARACTERS);
  expect(ctx.frames.length).toBeLessThanOrEqual(8);
  expect(ctx.truncated).toBe(true);
  expect(ctx).toEqual(buildPageContext(0, input));
});
it("keeps primary CTA after 250 unique navigation links and dialog descendant buttons", () => {
  document.body.innerHTML = '<nav>' + Array.from({ length: 250 }, (_, i) => `<a href="/#${i}">Nav ${i}</a>`).join('') + '</nav><button>Primary CTA</button><div role="dialog"><div><button>Dialog action</button></div></div>';
  const s = extractAccessibleDOMSnapshot(document);
  expect(s.elements.some(e => e.accessibleName === 'Primary CTA')).toBe(true);
  expect(s.elements.findIndex(e => e.accessibleName === 'Dialog action')).toBeLessThan(s.elements.findIndex(e => e.accessibleName === 'Primary CTA'));
  const host = document.createElement('div');
  document.querySelector('nav')!.append(host);
  host.attachShadow({ mode: 'open' }).innerHTML = '<a href="/">Shadow link</a>';
  expect(ancestorContext(host.shadowRoot!.querySelector('a')!).isInNavigation).toBe(true);
});
it("keeps same-name controls with different states", () => {
  document.body.innerHTML = '<button aria-expanded="true">Details</button><button aria-expanded="false">Details</button><button aria-pressed="true" aria-selected="true">Details</button>';
  expect(extractAccessibleDOMSnapshot(document).elements.filter(e => e.accessibleName === 'Details')).toHaveLength(3);
});
it("fails closed when DOM traversal exceeds capture work limit", () => {
  document.body.innerHTML = '<span></span>'.repeat(MAX_CAPTURE_NODES + 1);
  expect(() => extractAccessibleDOMSnapshot(document)).toThrow('capture work budget exceeded');
});
