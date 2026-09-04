// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { iterElements, collectElements } from "./traversal";
import { extractAccessibleDOMSnapshot } from "./extractor";
import type { AccessibleDOMSnapshot } from "@guided-web/protocol";

function setHtml(html: string): void {
  document.open();
  document.write(`<html><head><title>Test</title></head><body>${html}</body></html>`);
  document.close();
}

afterEach(() => {
  document.open();
  document.write("");
  document.close();
});

describe("open shadow DOM traversal", () => {
  it("traverses a single open shadow root", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button>Shadow button</button>`;

    const elements = collectElements(document);
    const button = elements.find((e) => e.tagName.toLowerCase() === "button");
    expect(button).toBeDefined();
    expect(button?.textContent?.trim()).toBe("Shadow button");
  });

  it("traverses nested open shadow roots", () => {
    setHtml(`<div id="outer"></div>`);
    const outer = document.getElementById("outer")!;
    const outerShadow = outer.attachShadow({ mode: "open" });
    outerShadow.innerHTML = `<div id="inner"></div><button>Outer button</button>`;
    const inner = outerShadow.getElementById("inner")!;
    const innerShadow = inner.attachShadow({ mode: "open" });
    innerShadow.innerHTML = `<button>Inner button</button>`;

    const elements = collectElements(document);
    expect(elements.some((e) => e.textContent?.trim() === "Outer button")).toBe(true);
    expect(elements.some((e) => e.textContent?.trim() === "Inner button")).toBe(true);
  });

  it("ignores closed shadow roots safely", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const closed = host.attachShadow({ mode: "closed" });
    closed.innerHTML = `<button>Closed secret button</button>`;

    const elements = collectElements(document);
    expect(elements.some((e) => e.textContent?.trim() === "Closed secret button")).toBe(false);
    // The closed shadow is not bypassed; there is no reference to its contents.
    expect(host.shadowRoot).toBeNull();
  });

  it("does not duplicate elements between light DOM and shadow DOM", () => {
    setHtml(`<div id="host"><button>Light</button></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button>Shadow</button>`;

    const elements = collectElements(document);
    // No element reference may appear more than once regardless of how it was
    // reached (light DOM vs shadow DOM).
    expect(new Set(elements).size).toBe(elements.length);
    // Exactly one <button> in light DOM and exactly one <button> in shadow.
    expect(elements.filter((e) => e.tagName.toLowerCase() === "button" && e.textContent?.trim() === "Light")).toHaveLength(1);
    expect(elements.filter((e) => e.tagName.toLowerCase() === "button" && e.textContent?.trim() === "Shadow")).toHaveLength(1);
  });

  it("discovers an interactive control inside a shadow root", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<button id="go" aria-label="Proceed">Go</button>`;

    const s = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    const control = s.elements.find((e) => e.tag === "button");
    expect(control?.accessibleName).toBe("Proceed");
    expect(control?.interactive).toBe(true);
  });

  it("computes ARIA names inside a shadow tree", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<span id="lbl">Email</span><input aria-labelledby="lbl" type="text">`;

    const s = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    const input = s.elements.find((e) => e.tag === "input");
    expect(input?.accessibleName).toBe("Email");
  });

  it("protects a sensitive input inside a shadow root", () => {
    setHtml(`<div id="host"></div>`);
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<input id="pass" type="password" value="shadow-secret-999">`;

    const s = extractAccessibleDOMSnapshot(document, { snapshotId: "s" });
    expect(JSON.stringify(s)).not.toContain("shadow-secret-999");
  });
});

describe("iterElements determinism", () => {
  it("produces deterministic order for identical input", () => {
    setHtml(`<div>1</div><button>2</button><span>3</span>`);
    const a = collectElements(document).map((e) => e.textContent?.trim());
    const b = collectElements(document).map((e) => e.textContent?.trim());
    expect(a).toEqual(b);
  });
});
